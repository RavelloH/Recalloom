import type {Env} from './types.js';
import {StorageError} from './types.js';
import {extractWikiReferences} from './wiki-syntax.js';
import {insertProjection,pinPathBindings,resolveNewWikiTarget,type ReferenceRow} from './wiki-references.js';
import {resolvePath} from './storage/folders.js';

type Row=Record<string,unknown>;
/** Resolve against the complete staged library before constructing the import
 * transaction. A saved path pin, including a tombstone, always wins over paths. */
export async function snapshotProjections(env:Env,records:Row[],folders:Row[],bindings:Row[]){
 const directories=new Map(folders.map(row=>[String(row.id),row]));
 const paths=new Map<string,string>();
 async function recordPath(row:Row){
  const parts=[String(row.name)];let parent=row.folder_id as string|null,depth=0;
  const seen=new Set<string>();
  while(parent){
   if(seen.has(parent)||depth++>=64)throw new StorageError('INVALID_FOLDER_HIERARCHY');
   seen.add(parent);
   const folder=directories.get(parent)??await env.DB.prepare('SELECT id,parent_id,name FROM folders WHERE id=?').bind(parent).first<Row>();
   if(!folder)throw new StorageError('FOLDER_NOT_FOUND');
   directories.set(parent,folder);
   parts.unshift(String(folder.name));parent=folder.parent_id as string|null;
  }
  return '/'+parts.join('/');
 }
 for(const row of records)if(row.status!=='archived')paths.set(await recordPath(row),String(row.id));
 const pins=new Map(bindings.map(row=>[JSON.stringify([row.source_id,row.target_expression]),String(row.target_id)]));
 const references:ReferenceRow[]=[];
 const documents=records.filter(row=>row.kind==='document'||row.kind==='checkpoint').map(doc=>({doc,occurrences:extractWikiReferences(String(doc.content))}));
 if(documents.some(({occurrences})=>occurrences.length>2048))throw new StorageError('TOO_MANY_WIKI_REFERENCES');
 const requested=[...new Set([...bindings.map(row=>String(row.target_id)),...documents.flatMap(({occurrences})=>occurrences.filter(ref=>ref.target.startsWith('id:')).map(ref=>ref.target.slice(3)))])];
 const live=new Set(records.map(row=>String(row.id)));
 if(requested.length){
  const existing=await env.DB.prepare('SELECT id FROM records WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(requested)).all<{id:string}>();
  existing.results.forEach(row=>live.add(row.id));
 }
 const resolvedPaths=new Map<string,string|null>(paths);
 for(const {doc,occurrences} of documents){
  const sourceId=String(doc.id);
  const targets=new Map<string,string|null>();
  for(const ref of occurrences){
   if(targets.has(ref.target))continue;
   const pin=pins.get(JSON.stringify([sourceId,ref.target]));
   let targetId:string|null=null;
   if(pin)targetId=live.has(pin)?pin:null;
   else if(ref.target.startsWith('id:'))targetId=live.has(ref.target.slice(3))?ref.target.slice(3):null;
   else if(ref.target.startsWith('/')){
    if(!resolvedPaths.has(ref.target)){
     try{
      const found=await resolvePath(env,ref.target);
      resolvedPaths.set(ref.target,found.kind==='record'?found.id:null);
     }catch(error){
      if(!(error instanceof StorageError&&error.code==='PATH_NOT_FOUND'))throw error;
      resolvedPaths.set(ref.target,null);
     }
    }
    targetId=resolvedPaths.get(ref.target)??null;
   }
   targets.set(ref.target,targetId);
  }
  for(const ref of occurrences){
   const targetId=targets.get(ref.target)??null;
   references.push({sourceId,sourceOffset:ref.offset,sourceRevision:Number(doc.revision),kind:ref.kind,
    targetExpression:ref.target,targetId,anchor:ref.anchor,alias:ref.alias,resolutionStatus:targetId?'resolved':'missing'});
  }
 }
 const statements:D1PreparedStatement[]=[];
 if(bindings.length)statements.push(env.DB.prepare(`INSERT INTO record_path_bindings(source_id,target_expression,target_id)
  SELECT json_extract(value,'$.source_id'),json_extract(value,'$.target_expression'),json_extract(value,'$.target_id') FROM json_each(?)`).bind(JSON.stringify(bindings)));
 if(references.length)statements.push(pinPathBindings(env,references),insertProjection(env,references));
 // Also repair existing documents that had forward references to imported IDs.
 for(const [path,id] of paths)statements.push(...resolveNewWikiTarget(env,id,path));
 return statements;
}
