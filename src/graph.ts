import type {Env} from './types.js';
import {StorageError} from './types.js';

/** D1 holds authoritative edges; Vectorize supplies non-persistent candidates.
 * Nothing here inserts semantic similarity into record_links automatically.
 */
export type KnowledgeNode={
 id:string;name:string;kind:string;status:string;folderId:string|null;
 folderName:string|null;updatedAt:string;revision:number
};
export type KnowledgeEdge={
 id:string;sourceId:string;targetId:string;type:'explicit'|'semantic'|'folder';
 relation:string;score?:number;snippet?:string;support?:number
};
type ExplicitEdge=KnowledgeEdge & {type:'explicit'};
export type SemanticState='ready'|'indexing'|'unavailable'|'archived'|'disabled';
type IndexedChunk={chunk_id:string;record_id:string;revision:number;content:string};
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const nodeFields='r.id,r.name,r.kind,r.status,r.folder_id AS folderId,f.name AS folderName,r.updated_at AS updatedAt,c.revision';

async function node(env:Env,id:string):Promise<KnowledgeNode>{
 const row=await env.DB.prepare('SELECT '+nodeFields+' FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN folders f ON f.id=r.folder_id WHERE r.id=?')
  .bind(id).first<KnowledgeNode>();
 if(!row)throw new StorageError('RECORD_NOT_FOUND');
 return row;
}

export function joinEdges(rows:Array<{sourceId:string;targetId:string;relation:string}>):ExplicitEdge[]{
 return rows.map(row=>({
  id:'explicit:'+row.sourceId+':'+row.targetId+':'+row.relation,
  sourceId:row.sourceId,targetId:row.targetId,type:'explicit',
  relation:row.relation
 }));
}

async function linksFor(env:Env,id:string,limit=120):Promise<ExplicitEdge[]>{
 const rows=(await env.DB.prepare(
  'SELECT source_id AS sourceId,target_id AS targetId,relation FROM record_links WHERE source_id=? OR target_id=? ORDER BY relation,source_id,target_id LIMIT ?'
 ).bind(id,id,clamp(limit,1,200)).all()).results as Array<{sourceId:string;targetId:string;relation:string}>;
 return joinEdges(rows);
}

/** Vectorize queryById uses existing embeddings: no new Workers AI calls.
 * Query at most 3 distinct chunks, verify both candidate and current source revisions
 * against D1, then collapse multiple chunk hits into document-level candidates.
 */
export async function relatedSemantic(env:Env,source:KnowledgeNode,limit=10):Promise<{status:SemanticState;edges:KnowledgeEdge[]}>{
 if(source.status==='archived')return {status:'archived',edges:[]};
 const current=(await env.DB.prepare(
  'SELECT chunk_id AS chunkId FROM search_chunks WHERE record_id=? AND revision=? ORDER BY chunk_index LIMIT 3'
 ).bind(source.id,source.revision).all()).results as Array<{chunkId:string}>;
 if(!current.length)return {status:'indexing',edges:[]};
 try{
  // Workers types expose queryById on newer Vectorize indexes, while the
  // Env binding is typed as the legacy VectorizeIndex. Support both safely.
  const index=env.VECTORIZE as VectorizeIndex & {queryById?:(id:string,options?:VectorizeQueryOptions)=>Promise<VectorizeMatches>};
  const options:VectorizeQueryOptions={topK:50,returnMetadata:'all'};
  const matched=await Promise.all(current.map(async row=>{
   if(index.queryById)return index.queryById(row.chunkId,options);
   const vector=(await index.getByIds([row.chunkId]))[0];
   if(!vector)return {count:0,matches:[]};
   return index.query(vector.values,options);
  }));
  const all=matched.flatMap((batch,ix)=>(batch.matches??[]).map(hit=>({
   id:hit.id,score:hit.score,metadata:hit.metadata,queryIndex:ix
  })));
  // Reserve no space for the source's own chunks, and never trust Vectorize metadata alone.
  const candidates=all.filter(m=>m.score>=0.5 && m.metadata &&
   typeof m.metadata.record_id==='string'&&m.metadata.record_id!==source.id &&
   typeof m.metadata.revision==='number');
  const ids=[...new Set(candidates.map(c=>c.id))].slice(0,120);
  if(!ids.length)return {status:'ready',edges:[]};
  const rows=(await env.DB.prepare(
   'SELECT s.chunk_id,s.content,s.revision,r.id AS record_id,c.revision AS current_revision,r.status FROM search_chunks s JOIN records r ON r.id=s.record_id JOIN record_contents c ON c.record_id=r.id WHERE s.chunk_id IN ('+ids.map(()=>'?').join(',')+')'
  ).bind(...ids).all()).results as Array<IndexedChunk&{current_revision:number;status:string}>;
  const byChunk=new Map(rows.map(row=>[row.chunk_id,row]));
  const grouped=new Map<string,{score:number;support:Set<number>;snippet:string}>();
  for(const hit of candidates){
   const chunk=byChunk.get(hit.id);
   if(!chunk || chunk.status==='archived'||chunk.revision!==chunk.current_revision||
    chunk.revision!==Number(hit.metadata?.revision)||chunk.record_id!==hit.metadata?.record_id)continue;
   const score=clamp(hit.score,0,1);
   const existing=grouped.get(chunk.record_id);
   if(!existing){grouped.set(chunk.record_id,{score,support:new Set([hit.queryIndex]),snippet:chunk.content.slice(0,240)});}
   else{existing.support.add(hit.queryIndex);if(score>existing.score){existing.score=score;existing.snippet=chunk.content.slice(0,240);}}
  }
  const edges=[...grouped.entries()].map(([targetId,item])=>({
   id:'semantic:'+source.id+':'+targetId,sourceId:source.id,targetId,type:'semantic' as const,
   relation:'语义相似',score:Math.round(item.score*1000)/1000,
   snippet:item.snippet,support:item.support.size
  })).sort((a,b)=>(b.score!-a.score!)||(b.support!-a.support!)).slice(0,clamp(limit,1,25));
  return {status:'ready',edges};
 }catch(e){
  console.warn('Recalloom semantic relations unavailable',e instanceof Error?e.name:'unknown');
  // A local Wrangler session usually has no Workers AI/Vectorize data;
  // explicit relations must remain available even if semantic lookup fails.
  return {status:'unavailable',edges:[]};
 }
}

async function nodesByIds(env:Env,ids:string[]):Promise<KnowledgeNode[]>{
 if(!ids.length)return [];
 return (await env.DB.prepare(
  'SELECT '+nodeFields+' FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN folders f ON f.id=r.folder_id WHERE r.id IN ('+ids.map(()=>'?').join(',')+')'
 ).bind(...ids).all()).results as KnowledgeNode[];
}

export async function recordRelations(env:Env,id:string,options:{semantic?:boolean;limit?:number}={}){
 const source=await node(env,id);
 const explicit=await linksFor(env,id,160);
 const semantic=options.semantic===false?{status:'disabled' as const,edges:[] as KnowledgeEdge[]}:
  await relatedSemantic(env,source,clamp(options.limit??10,1,25));
 const allIds=[...new Set(explicit.flatMap(e=>[e.sourceId,e.targetId]).concat(semantic.edges.map(e=>e.targetId)))].filter(id=>id!==source.id);
 const peers=await nodesByIds(env,allIds.slice(0,200));
 const byId=new Map(peers.map(p=>[p.id,p]));
 const links=explicit.filter(e=>byId.has(e.sourceId===id?e.targetId:e.sourceId)).map(edge=>({
  ...edge,direction:edge.sourceId===id?'outgoing' as const:'incoming' as const,
  other:byId.get(edge.sourceId===id?edge.targetId:edge.sourceId)!
 }));
 const suggestions=semantic.edges.filter(e=>byId.has(e.targetId)&&
  !links.some(link=>link.other.id===e.targetId))
  .map(edge=>({...edge,other:byId.get(edge.targetId)!}));
 return {source,links,suggestions,semanticStatus:semantic.status,
  indexingMayLag:semantic.status==='indexing'||semantic.status==='unavailable'};
}

export async function graphView(env:Env,options:{focusId?:string;limit?:number;semantic?:boolean}={}){
 const limit=clamp(options.limit??70,10,100),focusId=options.focusId;
 const nodes=new Map<string,KnowledgeNode>();
 const edges:KnowledgeEdge[]=[];
 let status:SemanticState='disabled';
 if(focusId){
  const relations=await recordRelations(env,focusId,{semantic:options.semantic,limit:16});
  status=relations.semanticStatus;
  nodes.set(focusId,relations.source);
  // Explicit links come first, then approximate candidates.
  for(const link of relations.links){
   if(nodes.size>=limit&&!nodes.has(link.other.id))break;
   nodes.set(link.other.id,link.other);
   edges.push({id:link.id,sourceId:link.sourceId,targetId:link.targetId,type:'explicit',relation:link.relation});
  }
  for(const candidate of relations.suggestions){
   if(nodes.size>=limit)break;
   nodes.set(candidate.other.id,candidate.other);
   edges.push({id:candidate.id,sourceId:candidate.sourceId,targetId:candidate.targetId,type:'semantic',
    relation:candidate.relation,score:candidate.score,support:candidate.support,snippet:candidate.snippet});
  }
  if(relations.source.folderId){
   const peers=(await env.DB.prepare(
    'SELECT '+nodeFields+' FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN folders f ON f.id=r.folder_id WHERE r.folder_id=? AND r.id!=? AND r.status!=\'archived\' ORDER BY r.updated_at DESC LIMIT 8'
   ).bind(relations.source.folderId,focusId).all()).results as KnowledgeNode[];
   for(const peer of peers){
    if(nodes.size>=limit&&!nodes.has(peer.id))break;
    nodes.set(peer.id,peer);
    if(!edges.some(e=>(e.sourceId===focusId&&e.targetId===peer.id)||(e.targetId===focusId&&e.sourceId===peer.id)))
     edges.push({id:'folder:'+focusId+':'+peer.id,sourceId:focusId,targetId:peer.id,type:'folder',relation:'同目录'});
   }
  }
 }else{
  const rows=(await env.DB.prepare(
   'SELECT '+nodeFields+' FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN folders f ON f.id=r.folder_id WHERE r.status!=\'archived\' ORDER BY r.updated_at DESC LIMIT ?'
  ).bind(limit).all()).results as KnowledgeNode[];
  for(const item of rows)nodes.set(item.id,item);
  if(rows.length){
   const ids=rows.map(r=>r.id);
   const linked=(await env.DB.prepare(
    'SELECT source_id AS sourceId,target_id AS targetId,relation FROM record_links WHERE source_id IN ('+ids.map(()=>'?').join(',')+') AND target_id IN ('+ids.map(()=>'?').join(',')+') LIMIT 220'
   ).bind(...ids,...ids).all()).results as Array<{sourceId:string;targetId:string;relation:string}>;
   edges.push(...joinEdges(linked));
   // Only sparse folder links. Never build an N² clique for a large folder.
   const lastByFolder=new Map<string,string>();
   for(const item of rows){
    if(!item.folderId)continue;
    const previous=lastByFolder.get(item.folderId);
    if(previous&&!edges.some(e=>(e.sourceId===item.id&&e.targetId===previous)||(e.sourceId===previous&&e.targetId===item.id))){
     edges.push({id:'folder:'+previous+':'+item.id,sourceId:previous,targetId:item.id,type:'folder',relation:'同目录'});
    }
    lastByFolder.set(item.folderId,item.id);
   }
  }
 }
 return {nodes:[...nodes.values()],edges:edges.filter(e=>nodes.has(e.sourceId)&&nodes.has(e.targetId)),
  focusId:focusId??null,semanticStatus:status,limit,scope:focusId?'local':'recent'};
}
