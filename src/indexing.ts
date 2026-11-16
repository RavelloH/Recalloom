import type {Env} from './types.js';
import {StorageError} from './types.js';
import {paragraphChunks} from './search-ranking.js';
import {sha256} from './version.js';
export const EMBEDDING_MODEL = '@cf/google/embeddinggemma-2';
export const EMBEDDING_DIMENSIONS = 512;
// Preserves natural paragraph and line boundaries while retaining overlap.
export const splitText = paragraphChunks;
export async function embed(env:Env,texts:string[]):Promise<number[][]> {
  if(!texts.length)return [];
  const result = await env.AI.run(EMBEDDING_MODEL,{input:texts,dimensions:EMBEDDING_DIMENSIONS}) as unknown as {data?:Array<{embedding?:unknown}>};
  if(!Array.isArray(result.data)||result.data.length!==texts.length)
    throw new StorageError('EMBEDDING_FAILED','Embedding model returned unexpected output');
  return result.data.map(item=>{
    const vector=item?.embedding;
    if(!Array.isArray(vector)||vector.length!==EMBEDDING_DIMENSIONS)
      throw new StorageError('VECTOR_DIMENSION_MISMATCH');
    if(!vector.every(value=>typeof value==='number'&&Number.isFinite(value)))
      throw new StorageError('EMBEDDING_FAILED','Embedding model returned invalid vector values');
    return vector as number[];
  });
}
type Job={id:string;record_id:string;revision:number;generation:number;attempts:number};
const iso=()=>new Date().toISOString();
// Reserve useful processing time before claiming another document. A drain may
// otherwise spend an attempt on a large document with milliseconds remaining.
const MIN_NEXT_JOB_BUDGET_MS=20_000;
export async function cleanupIndexVectors(env:Env){
 const rows=(await env.DB.prepare('SELECT id,chunk_ids FROM index_vector_garbage WHERE not_before<=? LIMIT 10').bind(iso()).all<{id:string;chunk_ids:string}>()).results;
 for(const row of rows)try{
  const ids=JSON.parse(row.chunk_ids) as string[];
  for(let i=0;i<ids.length;i+=100)await env.VECTORIZE.deleteByIds(ids.slice(i,i+100));
  await env.DB.prepare('DELETE FROM index_vector_garbage WHERE id=?').bind(row.id).run();
 }catch(e){await env.DB.prepare('UPDATE index_vector_garbage SET last_error=? WHERE id=?').bind(String(e).slice(0,800),row.id).run();}
}

export async function processIndexJobs(env:Env,limit=3,recordId?:string,deadline=Date.now()+75_000){
 const now=iso();
 await env.DB.prepare("UPDATE index_jobs SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'retry' END,stage='queued',lease_token=NULL,lease_expires_at=NULL,next_retry_at=CASE WHEN attempts>=5 THEN NULL ELSE ? END,last_error='Background execution timed out' WHERE state='running' AND lease_expires_at<?").bind(now,now).run();
 const jobs=(await env.DB.prepare("SELECT id,record_id,revision,generation,attempts FROM index_jobs WHERE (state='pending' OR (state='retry' AND next_retry_at<=?)) AND (? IS NULL OR record_id=?) ORDER BY updated_at,created_at LIMIT ?").bind(now,recordId??null,recordId??null,Math.max(1,Math.min(10,limit))).all<Job>()).results;
 const results:Array<{id:string;chunks?:number;skipped?:string;error?:string}>=[];
 for(const job of jobs){
  if(Date.now()>=deadline||(results.length>0&&deadline-Date.now()<MIN_NEXT_JOB_BUDGET_MS))break;
  const token=crypto.randomUUID(),start=Date.now(),expires=new Date(start+90_000).toISOString();
  const claimed=await env.DB.prepare("UPDATE index_jobs SET state='running',stage='preparing',started_at=?,lease_token=?,lease_expires_at=?,attempts=attempts+1 WHERE id=? AND generation=? AND state IN ('pending','retry')").bind(iso(),token,expires,job.id,job.generation).run();
  if(!claimed.meta.changes){results.push({id:job.id,skipped:'claimed_elsewhere'});continue;}
  let total=0;
  const withinBudget=async<T>(promise:Promise<T>)=>{
   let timer:ReturnType<typeof setTimeout>|undefined;
   return Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Index execution budget expired')),Math.max(1,deadline-Date.now()));})]).finally(()=>clearTimeout(timer));
  };
  const current=async()=>Boolean(await env.DB.prepare("SELECT id FROM index_jobs WHERE id=? AND generation=? AND lease_token=? AND lease_expires_at>? AND state='running'").bind(job.id,job.generation,token,iso()).first());
  const progress=async(stage:string,completed:number)=>{
   if(!await current())throw new StorageError('INDEX_SUPERSEDED');
   await env.DB.prepare('UPDATE index_jobs SET stage=?,completed_chunks=?,total_chunks=? WHERE id=? AND lease_token=?').bind(stage,completed,total,job.id,token).run();
  };
  try{
   const record=await env.DB.prepare('SELECT r.id,r.name,r.status,c.content,c.revision,r.metadata_revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=?').bind(job.record_id).first<{id:string;name:string;status:string;content:string;revision:number;metadata_revision:number}>();
   if(!record||record.revision!==job.revision)throw new StorageError('INDEX_SUPERSEDED');
   const old=(await env.DB.prepare('SELECT chunk_id FROM search_chunks WHERE record_id=?').bind(record.id).all<{chunk_id:string}>()).results.map(row=>row.chunk_id);
   const chunks=record.status==='archived'?[]:splitText(record.name+'\n'+record.content);total=chunks.length;
   // Attempt-scoped IDs prevent late writers or cleanup from touching a newer index.
   const prefix=(await sha256(record.id+':'+job.generation+':'+token)).slice(0,40);
   const ids=chunks.map((_,i)=>prefix+':'+i);
   if(ids.length)await env.DB.prepare('INSERT INTO index_vector_garbage(id,chunk_ids,not_before) VALUES(?,?,?)').bind(token,JSON.stringify(ids),new Date(start+3600_000).toISOString()).run();
   for(let i=0;i<chunks.length;i+=8){
    await progress('embedding',i);
    const vectors=await withinBudget(embed(env,chunks.slice(i,i+8).map(chunk=>'title: '+record.name.replace(/\.md$/i,'')+' | text: '+chunk)));
    await progress('uploading',i);
    await withinBudget(env.VECTORIZE.upsert(vectors.map((values,j)=>({id:ids[i+j],values,metadata:{record_id:record.id,revision:record.revision,chunk_index:i+j}}))));
    await progress('embedding',Math.min(i+8,total));
   }
   await progress('committing',total);
   // D1 batch is atomic; all projection writes are fenced by the leased generation.
   const guard="EXISTS(SELECT 1 FROM index_jobs WHERE id=? AND generation=? AND lease_token=? AND lease_expires_at>? AND state='running') AND EXISTS(SELECT 1 FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=? AND r.metadata_revision=? AND c.revision=?)";
   const args=[job.id,job.generation,token,iso(),record.id,record.metadata_revision,record.revision];
   const statements=[env.DB.prepare('DELETE FROM search_chunks WHERE record_id=? AND '+guard).bind(record.id,...args)];
   for(let i=0;i<chunks.length;i++)statements.push(env.DB.prepare('INSERT INTO search_chunks(chunk_id,record_id,revision,chunk_index,content) SELECT ?,?,?,?,? WHERE '+guard).bind(ids[i],record.id,record.revision,i,chunks[i],...args));
   if(old.length)statements.push(env.DB.prepare('INSERT INTO index_vector_garbage(id,chunk_ids,not_before) SELECT ?,?,? WHERE '+guard).bind(token+'-old',JSON.stringify(old),iso(),...args));
   statements.push(env.DB.prepare('DELETE FROM index_vector_garbage WHERE id=? AND '+guard).bind(token,...args));
   statements.push(env.DB.prepare("UPDATE index_jobs SET state='done',stage='submitted',indexed_revision=?,completed_chunks=?,total_chunks=?,finished_at=?,last_error=NULL,lease_token=NULL,lease_expires_at=NULL WHERE "+guard+' AND id=?').bind(job.revision,total,total,iso(),...args,job.id));
   const committed=await env.DB.batch(statements);
   if(!committed.at(-1)?.meta.changes)throw new StorageError('INDEX_SUPERSEDED');
   await logRun(env,token,job,'done',total,Date.now()-start,null);
   results.push({id:job.id,chunks:total});
  }catch(error){
   const superseded=error instanceof StorageError&&error.code==='INDEX_SUPERSEDED';
   const message=error instanceof Error?error.message:String(error);
   await env.DB.prepare("UPDATE index_jobs SET state=CASE WHEN generation<>? THEN 'pending' WHEN attempts>=5 THEN 'failed' ELSE 'retry' END,attempts=CASE WHEN generation<>? THEN 0 ELSE attempts END,stage='queued',next_retry_at=CASE WHEN generation<>? OR attempts>=5 THEN NULL ELSE ? END,last_error=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?").bind(job.generation,job.generation,job.generation,new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString(),superseded?null:message.slice(0,800),job.id,token).run();
   await logRun(env,token,job,superseded?'superseded':'failed',total,Date.now()-start,superseded?null:message.slice(0,800));
   results.push({id:job.id,...(superseded?{skipped:'superseded'}:{error:message})});
  }
 }
 return {processed:results.length,results};
}

async function logRun(env:Env,id:string,job:Job,outcome:string,chunks:number,duration:number,error:string|null){
 await env.DB.prepare('INSERT OR IGNORE INTO index_runs(id,record_id,revision,outcome,chunks,duration_ms,created_at,error) VALUES(?,?,?,?,?,?,?,?)').bind(id,job.record_id,job.revision,outcome,chunks,duration,iso(),error).run();
}

/** One bounded background drain; persistent rows survive the HTTP lifetime. */
export async function drainIndexJobs(env:Env){
 if(env.INDEX_BACKGROUND_ENABLED==='false')return;
 const deadline=Date.now()+24_000;
 do{const result=await processIndexJobs(env,1,undefined,deadline);if(!result.processed)break;}while(deadline-Date.now()>=MIN_NEXT_JOB_BUDGET_MS);
}
