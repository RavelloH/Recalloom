import type {Env} from './types.js';
import {StorageError} from './types.js';
import {extractWikiReferences,parseWikiTarget,wikiUuid,type WikiKind} from './wiki-syntax.js';

export type ReferenceRow={
 sourceId:string;sourceOffset:number;sourceRevision:number;kind:WikiKind;
 targetExpression:string;targetId:string|null;anchor:string|null;alias:string|null;
 resolutionStatus:'resolved'|'missing'
};
export type ResolvedWiki={
 target:string;targetId:string|null;status:'resolved'|'missing'|'path_changed';
 name?:string;path?:string;kind?:string;revision?:number
};
export type PathResolver=(env:Env,path:string)=>Promise<{kind:string;id:string|null}>;

/** Build the complete projection BEFORE the content CAS transaction.
 * UUID bindings for path references survive edits, removal and restoration.
 * A renamed/moved target and an old path collision never redirect identity. */
export async function prepareWikiProjection(
 env:Env,sourceId:string,content:string,revision:number,resolvePath:PathResolver
):Promise<ReferenceRow[]>{
 const occurrences=extractWikiReferences(content);
 if(occurrences.length>2048)throw new StorageError('TOO_MANY_WIKI_REFERENCES');
 if(!occurrences.length)return [];
 const previous=(await env.DB.prepare(
  'SELECT target_expression AS targetExpression,target_id AS targetId FROM record_path_bindings WHERE source_id=?'
 ).bind(sourceId).all()).results as Array<{targetExpression:string;targetId:string}>;
 const preserved=new Map(previous.map(row=>[row.targetExpression,row.targetId]));
 const discovered=new Map<string,string|null>();
 const unique=[...new Set(occurrences.map(ref=>ref.target))];
 // UUIDs are the default editor output: one JSON bind for thousands of
 // references, rather than exceeding D1's 100-variable cap or query budget.
 const requested=unique.filter(target=>target.startsWith('id:')).map(target=>target.slice(3));
 if(requested.length){
  const rows=(await env.DB.prepare(
   'SELECT id FROM records WHERE id IN (SELECT value FROM json_each(?))'
  ).bind(JSON.stringify(requested)).all<{id:string}>()).results;
  const live=new Set(rows.map(row=>row.id));
  for(const target of unique)if(target.startsWith('id:'))
   discovered.set(target,live.has(target.slice(3))?target.slice(3):null);
 }
 const pinnedIds=[...new Set(unique.filter(target=>target.startsWith('/')&&preserved.has(target))
  .map(target=>preserved.get(target)!).filter(Boolean))];
 if(pinnedIds.length){
  const livePins=(await env.DB.prepare(
   'SELECT id FROM records WHERE id IN (SELECT value FROM json_each(?))'
  ).bind(JSON.stringify(pinnedIds)).all<{id:string}>()).results;
  const live=new Set(livePins.map(row=>row.id));
  for(const target of unique){
   const pinned=preserved.get(target);
   if(pinned)discovered.set(target,live.has(pinned)?pinned:null);
  }
 }
 for(const target of unique){
  if(!target.startsWith('/')||preserved.has(target))continue;
  try{
   const item=await resolvePath(env,target);
   discovered.set(target,item.kind==='record'?item.id:null);
  }catch(error){
   if(error instanceof StorageError&&error.code==='PATH_NOT_FOUND'){discovered.set(target,null);continue;}
   throw error;
  }
 }
 return occurrences.map(r=>{
  // A tombstoned path pin is deliberately unresolved, even if the path has
  // been reused. Never insert a dangling FK into the current projection.
  const targetId=discovered.get(r.target)??null;
  return {sourceId,sourceOffset:r.offset,sourceRevision:revision,kind:r.kind,
   targetExpression:r.target,targetId,anchor:r.anchor,alias:r.alias,
   resolutionStatus:targetId?'resolved':'missing'};
 });
}
/** A path can be initially resolved exactly once per source, independent of
 * whether its syntax is a link or embed. Do not delete pins with the projection.
 * Using one json_each parameter avoids the D1 100-parameter ceiling. */
export const pinPathBindings=(env:Env,rows:ReferenceRow[])=>env.DB.prepare(
 "INSERT OR IGNORE INTO record_path_bindings(source_id,target_expression,target_id)"+
 " SELECT DISTINCT json_extract(value,'$.sourceId'),json_extract(value,'$.targetExpression'),"+
 " json_extract(value,'$.targetId') FROM json_each(?)"+
 " WHERE json_extract(value,'$.targetExpression') LIKE '/%' AND json_extract(value,'$.targetId') IS NOT NULL"
).bind(JSON.stringify(rows));
export const deleteProjection=(env:Env,sourceId:string)=>env.DB.prepare(
 'DELETE FROM record_references WHERE source_id=?'
).bind(sourceId);
/** One D1 bound parameter and one statement regardless of reference count. */
export const insertProjection=(env:Env,rows:ReferenceRow[])=>env.DB.prepare(
 "INSERT INTO record_references(source_id,source_offset,source_revision,kind,target_expression,target_id,anchor,alias,resolution_status)"+
 " SELECT json_extract(value,'$.sourceId'),json_extract(value,'$.sourceOffset'),"+
 " json_extract(value,'$.sourceRevision'),json_extract(value,'$.kind'),"+
 " json_extract(value,'$.targetExpression'),json_extract(value,'$.targetId'),"+
 " json_extract(value,'$.anchor'),json_extract(value,'$.alias'),"+
 " json_extract(value,'$.resolutionStatus') FROM json_each(?)"
).bind(JSON.stringify(rows));

/** Optional sourceId pins path bindings. A moved target stays the same UUID
 * rather than silently redirecting to whatever now occupies the old path. */
export async function resolveWikiReference(
 env:Env,expression:string,resolvePath:PathResolver,sourceId?:string
):Promise<ResolvedWiki>{
 const parsed=parseWikiTarget(expression,false);
 if(!parsed)return {target:expression,targetId:null,status:'missing'};
 const target=parsed.target;
 let targetId:string|null=null;
 if(sourceId&&wikiUuid.test(sourceId)){
  const existing=target.startsWith('/')?await env.DB.prepare(
   'SELECT target_id AS targetId FROM record_path_bindings WHERE source_id=? AND target_expression=?'
  ).bind(sourceId,target).first<{targetId:string}>():null;
  targetId=existing?.targetId??null;
 }
 if(!targetId){
  if(target.startsWith('id:'))targetId=target.slice(3);
  else{
   try{
    const result=await resolvePath(env,target);
    if(result.kind==='record')targetId=result.id;
   }catch(error){if(!(error instanceof StorageError&&error.code==='PATH_NOT_FOUND'))throw error;}
  }
 }
 if(!targetId)return {target,targetId:null,status:'missing'};
 const row=await env.DB.prepare(
  'SELECT r.id,r.name,r.kind,c.revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=?'
 ).bind(targetId).first<{id:string;name:string;kind:string;revision:number}>();
 if(!row)return {target,targetId:null,status:'missing'};
 let path:string|undefined;
 let status:ResolvedWiki['status']='resolved';
 if(target.startsWith('/')){
  const parts:string[]=[row.name];
  const containing=await env.DB.prepare('SELECT folder_id AS folderId FROM records WHERE id=?')
   .bind(targetId).first<{folderId:string|null}>();
  let current:string|null=containing?.folderId??null;
  let depth=0;
  while(current&&depth++<32){
   const folder=await env.DB.prepare('SELECT name,parent_id AS parentId FROM folders WHERE id=?').bind(current)
    .first<{name:string;parentId:string|null}>();
   if(!folder)break;
   parts.unshift(folder.name);current=folder.parentId;
  }
  path='/'+parts.join('/');
  if(path!==target)status='path_changed';
 }
 return {target,targetId:row.id,name:row.name,kind:row.kind,revision:row.revision,path,status};
}
export async function listWikiReferences(env:Env,id:string){
 const exists=await env.DB.prepare('SELECT id FROM records WHERE id=?').bind(id).first();
 if(!exists)throw new StorageError('RECORD_NOT_FOUND');
 const rows=(await env.DB.prepare(
  "SELECT wr.source_id AS sourceId,wr.source_offset AS sourceOffset,wr.source_revision AS sourceRevision,"+
  " wr.kind,wr.target_expression AS targetExpression,wr.target_id AS targetId,wr.anchor,wr.alias,"+
  " wr.resolution_status AS resolutionStatus,s.name AS sourceName,t.name AS targetName"+
  " FROM record_references wr JOIN records s ON s.id=wr.source_id"+
  " LEFT JOIN records t ON t.id=wr.target_id"+
  " WHERE wr.source_id=? OR wr.target_id=?"+
  " ORDER BY wr.source_id,wr.source_offset,wr.kind LIMIT 301"
 ).bind(id,id).all()).results as Array<ReferenceRow&{sourceName:string;targetName:string|null}>;
 return {items:rows.slice(0,300),truncated:rows.length>300};
}


/** Rebuild derived Wiki references for existing Markdown without changing
 * content, revisions, manual links or vector embeddings. Safe against a
 * concurrent editor: both inserts are guarded by the snapshot revision and
 * committed in one D1 batch. An editing transaction before us makes our
 * inserts no-ops; an edit after us replaces the projection. */
export async function backfillWikiReferences(env:Env,resolvePath:PathResolver,options:{
 cursor?:string;limit?:number
}={}){
 const limit=Math.min(10,Math.max(1,options.limit??6));
 const after=options.cursor??'';
 const docs=(await env.DB.prepare(
  "SELECT r.id,c.content,c.revision FROM records r"+
  " JOIN record_contents c ON c.record_id=r.id"+
  " WHERE r.id>? AND r.kind='document' ORDER BY r.id LIMIT ?"
 ).bind(after,limit).all<{id:string;content:string;revision:number}>()).results;
 let matched=0,inserted=0;
 for(const doc of docs){
  if(!doc.content.includes('[[')&&!doc.content.includes('::: embed '))continue;
  const refs=await prepareWikiProjection(env,doc.id,doc.content,doc.revision,resolvePath);
  if(!refs.length)continue;
  matched++;
  const payload=JSON.stringify(refs);
  const safe="EXISTS(SELECT 1 FROM record_contents WHERE record_id=? AND revision=?)";
  const pins=env.DB.prepare(
   "INSERT OR IGNORE INTO record_path_bindings(source_id,target_expression,target_id)"+
   " SELECT DISTINCT json_extract(value,'$.sourceId'),json_extract(value,'$.targetExpression'),"+
   " json_extract(value,'$.targetId') FROM json_each(?)"+
   " WHERE json_extract(value,'$.targetExpression') LIKE '/%'"+
   " AND json_extract(value,'$.targetId') IS NOT NULL AND "+safe
  ).bind(payload,doc.id,doc.revision);
  const current=env.DB.prepare(
   "INSERT OR IGNORE INTO record_references(source_id,source_offset,source_revision,kind,target_expression,target_id,anchor,alias,resolution_status)"+
   " SELECT json_extract(value,'$.sourceId'),json_extract(value,'$.sourceOffset'),"+
   " json_extract(value,'$.sourceRevision'),json_extract(value,'$.kind'),"+
   " json_extract(value,'$.targetExpression'),json_extract(value,'$.targetId'),"+
   " json_extract(value,'$.anchor'),json_extract(value,'$.alias'),"+
   " json_extract(value,'$.resolutionStatus') FROM json_each(?) WHERE "+safe
  ).bind(payload,doc.id,doc.revision);
  // A pending path may become valid after a folder rename/move. Reconcile
  // current unresolved rows as well as inserting records absent before v0011.
  const repaired=env.DB.prepare(
   "UPDATE record_references SET target_id=(SELECT json_extract(j.value,'$.targetId')"+
   " FROM json_each(?) j WHERE json_extract(j.value,'$.sourceOffset')=record_references.source_offset"+
   " AND json_extract(j.value,'$.kind')=record_references.kind LIMIT 1),"+
   " resolution_status='resolved'"+
   " WHERE source_id=? AND source_revision=? AND target_id IS NULL AND "+safe+
   " AND EXISTS (SELECT 1 FROM json_each(?) j"+
   " WHERE json_extract(j.value,'$.sourceOffset')=record_references.source_offset"+
   " AND json_extract(j.value,'$.kind')=record_references.kind"+
   " AND json_extract(j.value,'$.targetId') IS NOT NULL)"
  ).bind(payload,doc.id,doc.revision,doc.id,doc.revision,payload);
  const result=await env.DB.batch([pins,current,repaired]);
  inserted+=(result[1]?.meta?.changes??0)+(result[2]?.meta?.changes??0);
 }
 const nextCursor=docs.at(-1)?.id??null;
 return {scanned:docs.length,matched,inserted,
  hasMore:docs.length===limit,nextCursor:docs.length===limit?nextCursor:null};
}


/** Once a previously missing record is created, reconcile forward references
 * without touching any source document, its revision, or manual edges.
 * The two statements must be in the SAME D1 transaction after inserting the
 * new record. A path already pinned to another UUID is never rebound. */
export function resolveNewWikiTarget(env:Env,targetId:string,path:string|null){
 const expressions=['id:'+targetId,path].filter((v):v is string=>Boolean(v));
 const pins=path?env.DB.prepare(
  "INSERT OR IGNORE INTO record_path_bindings(source_id,target_expression,target_id)"+
  " SELECT source_id,target_expression,? FROM record_references"+
  " WHERE target_id IS NULL AND target_expression=?"+
  " GROUP BY source_id,target_expression"
 ).bind(targetId,path):null;
 const updated=env.DB.prepare(
  "UPDATE record_references SET target_id=?,resolution_status='resolved'"+
  " WHERE target_id IS NULL AND target_expression IN (SELECT value FROM json_each(?))"+
  " AND (target_expression=? OR EXISTS ("+
  " SELECT 1 FROM record_path_bindings b WHERE b.source_id=record_references.source_id"+
  " AND b.target_expression=record_references.target_expression AND b.target_id=?))"
 ).bind(targetId,JSON.stringify(expressions),'id:'+targetId,targetId);
 return pins?[pins,updated]:[updated];
}
