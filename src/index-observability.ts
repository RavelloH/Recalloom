import type {Env} from './types.js';
import {StorageError} from './types.js';
import {EMBEDDING_DIMENSIONS,EMBEDDING_MODEL} from './indexing.js';
import {INDEX_JOB_UPSERT} from './index-queue.js';
import {sha256} from './version.js';

export async function indexOverview(env:Env,days=7){
 const [counts,coverage,runs,samples,cleanup]=await Promise.all([
  env.DB.prepare('SELECT state,COUNT(*) AS count FROM index_jobs GROUP BY state').all(),
  env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN j.state='done' AND j.indexed_revision=c.revision THEN 1 ELSE 0 END) AS indexed FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN index_jobs j ON j.record_id=r.id WHERE r.status<>'archived'").first(),
  env.DB.prepare("SELECT strftime(?,created_at) AS time,SUM(outcome='done') AS completed,SUM(outcome='failed') AS failed,AVG(CASE WHEN outcome='done' THEN duration_ms END) AS durationMs FROM index_runs WHERE created_at>=? GROUP BY time ORDER BY time").bind(days===1?'%Y-%m-%dT%H:00:00Z':'%Y-%m-%d',new Date(Date.now()-days*86400_000).toISOString()).all(),
  env.DB.prepare('SELECT hour AS time,pending,running,failed,sampled_at AS sampledAt FROM index_samples WHERE hour>=? ORDER BY hour').bind(new Date(Date.now()-days*86400_000).toISOString()).all(),
  env.DB.prepare("SELECT (SELECT COUNT(*) FROM vector_delete_jobs) AS records,(SELECT COUNT(*) FROM index_vector_garbage) AS batches").first()
 ]);
 const last=await env.DB.prepare("SELECT MAX(finished_at) AS completedAt,MIN(CASE WHEN state IN ('pending','retry') THEN COALESCE(updated_at,created_at) END) AS waitingSince FROM index_jobs").first();
 const durations=(await env.DB.prepare("SELECT duration_ms AS ms FROM index_runs WHERE outcome='done' ORDER BY created_at DESC LIMIT 1000").all<{ms:number}>()).results.map(r=>r.ms).sort((a,b)=>a-b);
 const performance={samples:durations.length,meanMs:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,p95Ms:durations.length?durations[Math.ceil(durations.length*.95)-1]:null};
 return {counts:counts.results,coverage,runs:runs.results,samples:samples.results,cleanup,last,performance,model:EMBEDDING_MODEL,dimensions:EMBEDDING_DIMENSIONS,sampledAt:new Date().toISOString()};
}

type RemoteIndexInfo={status:string;count:number|null;dimensions:number|null;processedAt:string|null;sampledAt:string};
async function readRemoteIndex(env:Env):Promise<RemoteIndexInfo>{
 let remote:RemoteIndexInfo={status:'unavailable',count:null,dimensions:null,processedAt:null,sampledAt:new Date().toISOString()};
 try{
  const index=env.VECTORIZE as unknown as {describe:()=>Promise<{vectorCount?:number;vectorsCount?:number;dimensions?:number;config?:{dimensions:number};processedUpToDatetime?:string}>};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const info=await Promise.race([index.describe(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Remote metrics timeout')),4000);})]).finally(()=>clearTimeout(timer));
  const count=info.vectorCount??info.vectorsCount;
  remote={...remote,status:typeof count==='number'?'ready':'unavailable',count:count??null,dimensions:info.dimensions??info.config?.dimensions??null,processedAt:info.processedUpToDatetime??null,sampledAt:new Date().toISOString()};
 }catch{/* Unavailable remote metrics do not fail the local storage report. */}
 return remote;
}

export async function storageOverview(env:Env){
 const [documents,chunks,histories]=await Promise.all([
  env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(status='archived'),0) AS archived,COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM records JOIN record_contents ON record_id=records.id").all(),
  env.DB.prepare('SELECT COUNT(*) AS count,COUNT(DISTINCT record_id) AS documents,COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM search_chunks').first(),
  env.DB.prepare('SELECT (SELECT COUNT(*) FROM revisions) AS revisions,COALESCE(SUM(length(CAST(history_metadata AS BLOB))),0) AS bytes FROM record_histories').first()
 ]);
 const remote=await readRemoteIndex(env);
 await sampleIndexState(env,remote);
 const samples=await env.DB.prepare('SELECT hour AS time,documents,chunks,text_bytes AS textBytes,vector_count AS vectorCount,database_bytes AS databaseBytes FROM index_samples ORDER BY hour DESC LIMIT 720').all();
 return {documents:documents.results[0],chunks,histories,databaseBytes:documents.meta.size_after??null,remote,samples:samples.results.reverse(),sampledAt:new Date().toISOString()};
}

export async function sampleIndexState(env:Env,remoteInfo?:RemoteIndexInfo|true){
 const remote=remoteInfo===true?await readRemoteIndex(env):remoteInfo;
 const [counts,size]=await Promise.all([
  env.DB.prepare("SELECT SUM(state IN ('pending','retry')) AS pending,SUM(state='running') AS running,SUM(state='failed') AS failed FROM index_jobs").first<{pending:number;running:number;failed:number}>(),
  env.DB.prepare('SELECT (SELECT COUNT(*) FROM records) AS documents,COUNT(*) AS chunks,COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM search_chunks').all<{documents:number;chunks:number;bytes:number}>()
 ]);
 const at=new Date().toISOString(),row=size.results[0];
 await env.DB.prepare('INSERT INTO index_samples(hour,pending,running,failed,documents,chunks,text_bytes,database_bytes,vector_count,sampled_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(hour) DO UPDATE SET pending=excluded.pending,running=excluded.running,failed=excluded.failed,documents=excluded.documents,chunks=excluded.chunks,text_bytes=excluded.text_bytes,database_bytes=excluded.database_bytes,vector_count=COALESCE(excluded.vector_count,index_samples.vector_count),sampled_at=excluded.sampled_at')
  .bind(at.slice(0,13)+':00:00.000Z',counts?.pending??0,counts?.running??0,counts?.failed??0,row.documents,row.chunks,row.bytes,size.meta.size_after??null,remote?.count??null,at).run();
 await env.DB.batch([
  env.DB.prepare('DELETE FROM index_runs WHERE created_at<?').bind(new Date(Date.now()-30*86400_000).toISOString()),
  env.DB.prepare('DELETE FROM index_samples WHERE hour<?').bind(new Date(Date.now()-90*86400_000).toISOString())
 ]);
}

export async function indexTasks(env:Env,state?:string,query='',offset=0){
 const rows=await env.DB.prepare("SELECT j.*,r.name,r.status AS record_status,c.revision AS current_revision FROM index_jobs j JOIN records r ON r.id=j.record_id JOIN record_contents c ON c.record_id=r.id WHERE (? IS NULL OR j.state=? OR (?='waiting' AND j.state IN ('pending','retry'))) AND instr(lower(r.name),lower(?))>0 ORDER BY CASE j.state WHEN 'failed' THEN 0 WHEN 'running' THEN 1 WHEN 'retry' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END,COALESCE(j.updated_at,j.created_at) DESC,j.id LIMIT 41 OFFSET ?").bind(state??null,state??null,state??null,query,offset).all();
 return {items:rows.results.slice(0,40),nextOffset:rows.results.length>40?offset+40:null};
}

export async function retryIndex(env:Env,id:string,rebuild=false){
 const job=await env.DB.prepare('SELECT state FROM index_jobs WHERE record_id=?').bind(id).first<{state:string}>();
 if(!job)throw new StorageError('RECORD_NOT_FOUND');
 if(job.state==='running')throw new StorageError('INDEX_BUSY','任务正在执行，请等待完成或租约到期');
 if(job.state==='done'&&!rebuild)throw new StorageError('INDEX_ALREADY_DONE');
 const result=await env.DB.prepare("UPDATE index_jobs SET state='pending',stage='queued',generation=generation+1,attempts=0,completed_chunks=0,total_chunks=0,next_retry_at=NULL,last_error=NULL,updated_at=?,finished_at=NULL WHERE record_id=? AND state<>'running'").bind(new Date().toISOString(),id).run();
 if(!result.meta.changes)throw new StorageError('INDEX_BUSY');
 return {queued:true};
}

async function rebuildRecords(env:Env){
 return (await env.DB.prepare("SELECT r.id,c.revision,r.metadata_revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.status<>'archived' ORDER BY r.id").all()).results;
}
export async function previewIndexRebuild(env:Env){
 const records=await rebuildRecords(env);
 return {count:records.length,token:await sha256(JSON.stringify(records))};
}
export async function rebuildAllIndexes(env:Env,token:string){
 const records=await rebuildRecords(env);
 if(await sha256(JSON.stringify(records))!==token)throw new StorageError('VERSION_CONFLICT','文稿范围已变化，请重新预览');
 if(!records.length)return {queued:0};
 const result=await env.DB.prepare("INSERT INTO index_jobs(id,record_id,revision,created_at) SELECT lower(hex(randomblob(16))),r.id,c.revision,? FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.status<>'archived' AND (SELECT COUNT(*) FROM records WHERE status<>'archived')=? AND NOT EXISTS(SELECT 1 FROM json_each(?) s LEFT JOIN records r2 ON r2.id=json_extract(s.value,'$.id') LEFT JOIN record_contents c2 ON c2.record_id=r2.id WHERE r2.id IS NULL OR r2.status='archived' OR c2.revision<>json_extract(s.value,'$.revision') OR r2.metadata_revision<>json_extract(s.value,'$.metadata_revision'))"+INDEX_JOB_UPSERT).bind(new Date().toISOString(),records.length,JSON.stringify(records)).run();
 if(!result.meta.changes)throw new StorageError('VERSION_CONFLICT','文稿范围已变化，请重新预览');
 return {queued:result.meta.changes??0};
}
