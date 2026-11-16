import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {processIndexJobs,cleanupIndexVectors,drainIndexJobs} from '../src/indexing.js';
import {indexOverview,storageOverview,retryIndex,previewIndexRebuild,rebuildAllIndexes,pruneIndexRuns} from '../src/index-observability.js';
import {createFolder,createRecord,editRecord,updateMeta,readRecord} from '../src/storage.js';
import {previewDeleteFolder,deleteFolder} from '../src/lifecycle.js';
import type {Env} from '../src/types.js';
import {search} from '../src/search.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
 const prepare=(query:string)=>{let args:unknown[]=[];const statement={query,get args(){return args;},bind(...values:unknown[]){args=values;return statement;},
 async all(){return {results:sql.prepare(query).all(...args as never[]),meta:{changes:0,size_after:4096}};},
 async first(column?:string){const row=sql.prepare(query).get(...args as never[]) as Record<string,unknown>|undefined;return column?row?.[column]??null:row??null;},
 async run(){const result=sql.prepare(query).run(...args as never[]);return {results:[],meta:{changes:Number(result.changes)}};}};return statement;};
 const embeddings:Array<{model:string;input:{input:string[];dimensions:number}}>=[];
 const vectors=new Map<string,unknown>();let beforeEmbed:(()=>Promise<void>)|undefined;
 const env={DB:{prepare,async batch(commands:Array<ReturnType<typeof prepare>>){sql.exec('BEGIN');try{const results=[];for(const command of commands)results.push(await command.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}},AI:{async run(_model:string,input:{input:string[];dimensions:number}){embeddings.push({model:_model,input});await beforeEmbed?.();return {data:input.input.map(()=>({embedding:Array(512).fill(.1)}))};}},VECTORIZE:{async upsert(values:Array<{id:string}>){for(const value of values)vectors.set(value.id,value);return {mutationId:'test'};},async deleteByIds(ids:string[]){ids.forEach(id=>vectors.delete(id));},async describe(){return {vectorCount:vectors.size,dimensions:512};}}} as unknown as Env;
 return {env,sql,vectors,embeddings,onEmbed:(fn?:()=>Promise<void>)=>{beforeEmbed=fn;}};
}

test('transactional enqueues coalesce content and same-revision metadata edits',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'first'});
 await editRecord(f.env,record.id,1,'second');await updateMeta(f.env,record.id,{name:'two.md'});
 const rows=f.sql.prepare('SELECT * FROM index_jobs').all();assert.equal(rows.length,1);assert.equal(rows[0].revision,2);assert.equal(rows[0].generation,3);
 const result=await processIndexJobs(f.env,1);assert.equal(result.results[0].chunks,1);
 assert.deepEqual(f.embeddings[0],{model:'@cf/google/embeddinggemma-2',input:{input:['title: two | text: two.md\nsecond'],dimensions:512}});
 const job=f.sql.prepare('SELECT * FROM index_jobs').get()!;assert.equal(job.state,'done');assert.equal(job.indexed_revision,2);assert.equal(f.vectors.size,1);
 const report=await indexOverview(f.env);assert.equal(report.coverage?.indexed,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM index_runs').get()!.n,1);
 const capacity=await storageOverview(f.env);assert.equal(capacity.remote.count,1);assert.equal(capacity.databaseBytes,4096);assert.equal(capacity.chunks?.count,1);
});

test('new writes during embedding supersede the old lease without publishing stale chunks',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'first'});let changed=false;
 f.onEmbed(async()=>{if(!changed){changed=true;await editRecord(f.env,record.id,1,'new content');}});
 const first=await processIndexJobs(f.env,1);assert.equal(first.results[0].skipped,'superseded');assert.equal(f.vectors.size,0);
 assert.equal(f.sql.prepare('SELECT state FROM index_jobs').get()!.state,'pending');
 f.onEmbed();await processIndexJobs(f.env,1);
 assert.equal(f.sql.prepare('SELECT revision FROM search_chunks').get()!.revision,2);
});

test('a second consumer cannot claim live work; expired leases are recovered',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'first'});
 let unblock!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{unblock=r;});
 f.onEmbed(async()=>{entered();await gate;});const first=processIndexJobs(f.env,1);await started;
 assert.equal((await processIndexJobs(f.env,1)).processed,0);unblock();await first;
 f.sql.prepare("UPDATE index_jobs SET state='running',lease_expires_at='2000-01-01',lease_token='expired' WHERE record_id=?").run(record.id);
 f.onEmbed();assert.equal((await processIndexJobs(f.env,1)).results[0].chunks,1);
});

test('failed work backs off, manual retry resets attempts, and old attempt vectors are cleaned',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'first'});
 f.onEmbed(async()=>{throw Error('model unavailable');});await processIndexJobs(f.env,1);
 assert.equal(f.sql.prepare('SELECT state FROM index_jobs').get()!.state,'retry');assert.equal((await processIndexJobs(f.env,1)).processed,0);
 await retryIndex(f.env,record.id);f.onEmbed();await processIndexJobs(f.env,1);
 const valid=[...f.vectors.keys()];f.sql.prepare("UPDATE index_vector_garbage SET not_before='2000-01-01'").run();await cleanupIndexVectors(f.env);
 assert.deepEqual([...f.vectors.keys()],valid);assert.equal(f.sql.prepare('SELECT attempts FROM index_jobs').get()!.attempts,1);
});

test('archive reindex removes searchable chunks and schedules old vector deletion',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'first'});await processIndexJobs(f.env,1);
 await updateMeta(f.env,record.id,{status:'archived'});await processIndexJobs(f.env,1);await cleanupIndexVectors(f.env);
 assert.equal(f.vectors.size,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM search_chunks').get()!.count,0);
});

test('bulk folder archive coalesces every record, not just the first row',async()=>{
 const f=fixture(),folder=await createFolder(f.env,'folder',null);
 await createRecord(f.env,{name:'one.md',content:'first',folderId:folder.id});await createRecord(f.env,{name:'two.md',content:'second',folderId:folder.id});
 await processIndexJobs(f.env,10);const preview=await previewDeleteFolder(f.env,folder.id,1);
 await deleteFolder(f.env,folder.id,1,preview.previewToken);
 const rows=f.sql.prepare('SELECT state,generation FROM index_jobs').all();assert.equal(rows.length,2);assert.ok(rows.every(row=>row.state==='pending'&&row.generation===2));
 await processIndexJobs(f.env,10);await cleanupIndexVectors(f.env);assert.equal(f.vectors.size,0);
});

test('background drain finishes queued records without waiting for a scheduled trigger',async()=>{
 const f=fixture();await createRecord(f.env,{name:'one.md',content:'first'});await createRecord(f.env,{name:'two.md',content:'second'});
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM index_jobs WHERE state='pending'").get()!.n,2);
 await drainIndexJobs(f.env);assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM index_jobs WHERE state='done'").get()!.n,2);
});

test('background drain leaves the next document pending when its budget is nearly exhausted',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=fixture();await createRecord(f.env,{name:'first.md',content:'first'});await createRecord(f.env,{name:'next.md',content:'next'});
 f.onEmbed(async()=>{t.mock.timers.tick(23_000);});
 await drainIndexJobs(f.env);
 const jobs=f.sql.prepare('SELECT state,attempts,last_error FROM index_jobs ORDER BY state').all();
 assert.deepEqual(jobs.map(job=>[job.state,job.attempts,job.last_error]),[['done',1,null],['pending',0,null]]);
 assert.equal(f.embeddings.length,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM index_runs').get()!.n,1);
});

test('scheduled batches reserve processing time before claiming another document',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=fixture();await createRecord(f.env,{name:'first.md',content:'first'});await createRecord(f.env,{name:'next.md',content:'next'});
 f.onEmbed(async()=>{t.mock.timers.tick(74_000);});
 const result=await processIndexJobs(f.env,5);
 assert.equal(result.processed,1);assert.equal(result.results[0].chunks,1);
 const pending=f.sql.prepare("SELECT attempts,last_error FROM index_jobs WHERE state='pending'").get()!;
 assert.equal(pending.attempts,0);assert.equal(pending.last_error,null);
});

test('upgrade coalesces legacy revisions without changing document content',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')&&n<'0020').sort())db.exec(readFileSync('migrations/'+file,'utf8'));
 db.exec("INSERT INTO records(id,name,kind,status,created_at,updated_at) VALUES('r','old.md','document','active','2026-11-01','2026-11-02'); INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES('r','preserved body',2,'hash'); INSERT INTO index_jobs(id,record_id,revision,created_at,state) VALUES('j1','r',1,'2026-11-01','done'),('j2','r',2,'2026-11-02','pending');");
 db.exec("INSERT INTO records(id,name,kind,status,created_at,updated_at) VALUES('ready','ready.md','document','active','2026-11-01','2026-11-01'); INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES('ready','ready body',1,'hash'); INSERT INTO index_jobs(id,record_id,revision,created_at,state) VALUES('ready-job','ready',1,'2026-11-01','done'); INSERT INTO search_chunks(chunk_id,record_id,revision,chunk_index,content) VALUES('ready:0','ready',1,0,'ready body');");
 db.exec(readFileSync('migrations/0020_index_workspace.sql','utf8'));
 db.exec("INSERT INTO index_samples(hour,pending,running,failed,documents,chunks,text_bytes,sampled_at) VALUES('old',0,0,0,0,0,0,'2026-11-01')");
 db.exec(readFileSync('migrations/0021_retire_index_samples.sql','utf8'));
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='index_samples'").get()!.n,0);
 const completed=db.prepare("SELECT * FROM index_jobs WHERE record_id='ready'").get()!;assert.equal(completed.state,'done');assert.equal(completed.indexed_revision,1);
 const jobs=db.prepare("SELECT * FROM index_jobs WHERE record_id='r'").all();assert.equal(jobs.length,1);assert.equal(jobs[0].revision,2);assert.equal(jobs[0].state,'pending');assert.equal(db.prepare("SELECT content FROM record_contents WHERE record_id='r'").get()!.content,'preserved body');
});

test('bulk rebuild requires a current preview and updates all eligible records atomically',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'one'});await createRecord(f.env,{name:'two.md',content:'two'});
 const stale=await previewIndexRebuild(f.env);await editRecord(f.env,record.id,1,'changed');
 await assert.rejects(()=>rebuildAllIndexes(f.env,stale.token),/VERSION_CONFLICT|预览/);
 const current=await previewIndexRebuild(f.env);assert.equal((await rebuildAllIndexes(f.env,current.token)).queued,2);
 assert.ok(f.sql.prepare('SELECT generation FROM index_jobs').all().every(row=>Number(row.generation)>=2));
});

test('background execution budget releases the lease before platform termination',async()=>{
 const f=fixture();await createRecord(f.env,{name:'one.md',content:'one'});f.onEmbed(()=>new Promise<void>(()=>{}));
 await processIndexJobs(f.env,1,undefined,Date.now()+100);
 const job=f.sql.prepare('SELECT state,last_error,lease_token FROM index_jobs').get()!;
 assert.equal(job.state,'retry');assert.equal(job.lease_token,null);assert.match(String(job.last_error),/budget expired/);
});

test('exhausted tasks stop advertising a retry time and new writes clear obsolete progress',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'one'});
 f.sql.prepare("UPDATE index_jobs SET attempts=4,total_chunks=10,completed_chunks=5").run();f.onEmbed(async()=>{throw Error('model unavailable');});await processIndexJobs(f.env,1);
 const failed=f.sql.prepare('SELECT * FROM index_jobs').get()!;assert.equal(failed.state,'failed');assert.equal(failed.next_retry_at,null);
 await editRecord(f.env,record.id,1,'new version');const pending=f.sql.prepare('SELECT * FROM index_jobs').get()!;assert.equal(pending.state,'pending');assert.equal(pending.attempts,0);assert.equal(pending.total_chunks,0);assert.equal(pending.completed_chunks,0);
});

test('on-demand reports aggregate current data without writing snapshots',async()=>{
 const f=fixture(),now=Date.now();
 for(const [index,seconds] of [30,120,600,3600].entries()){
  const record=await createRecord(f.env,{name:'age-'+index+'.md',content:index===0?'小文稿':'x'.repeat(index===1?10241:102401)});
  f.sql.prepare('UPDATE index_jobs SET state=?,updated_at=? WHERE record_id=?').run(index%2?'retry':'pending',new Date(now-seconds*1000).toISOString(),record.id);
 }
 f.vectors.set('remote',{});
 const before=f.sql.prepare('SELECT total_changes() AS n').get()!.n;
 const summary=await indexOverview(f.env,now),storage=await storageOverview(f.env);
 assert.deepEqual(summary.ageBuckets.map(b=>[b.pending,b.retry]),[[1,0],[0,1],[1,0],[0,1]]);
 assert.deepEqual(storage.sizeBuckets.map(b=>b.count),[1,1,2]);assert.equal(storage.remote.count,1);
 assert.equal(f.sql.prepare('SELECT total_changes() AS n').get()!.n,before,'Reading reports must not write to D1');
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='index_samples'").get()!.n,0);
 Object.assign(f.env.VECTORIZE,{describe:async()=>{throw Error('unavailable');}});
 assert.equal((await storageOverview(f.env)).remote.count,null);
});

test('daily retention removes old execution diagnostics without touching live tasks',async()=>{
 const f=fixture(),record=await createRecord(f.env,{name:'one.md',content:'one'});await processIndexJobs(f.env,1);
 f.sql.prepare("INSERT INTO index_runs(id,record_id,revision,outcome,chunks,duration_ms,created_at) VALUES('old',?,1,'done',1,1,'2000-01-01')").run(record.id);
 await pruneIndexRuns(f.env);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM index_runs').get()!.n,1);
 assert.equal(f.sql.prepare('SELECT state FROM index_jobs').get()!.state,'done');
});

test('search prioritizes a README folder alias over newer body references even at limit one',async()=>{
 const f=fixture(),folder=await createFolder(f.env,'向量模型迁移研究',null);
 const primary=await createRecord(f.env,{name:'README.md',folderId:folder.id,content:'# 嵌入模型实测\n\n实际研究结论。'});
 for(let i=0;i<35;i++)await createRecord(f.env,{name:'引用-'+i+'.md',content:'参见向量模型迁移研究，本文仅记录引用。'});
 Object.assign(f.env.VECTORIZE,{query:async()=>({matches:[]})});
 for(const mode of ['metadata','hybrid','auto'] as const){
  const result=await search(f.env,{query:'向量模型迁移研究',mode,limit:1});
  assert.equal(result.results[0]?.id,primary.id,mode);
 }
 assert.equal((await search(f.env,{query:'向量模型迁移研究',mode:'literal',limit:30})).results.some(row=>row.id===primary.id),false);
 assert.equal((await search(f.env,{query:'向量模型迁移研究',mode:'hybrid',folderId:'missing',limit:1})).count,0);
 await updateMeta(f.env,primary.id,{status:'archived'});
 assert.equal((await search(f.env,{query:'向量模型迁移研究',mode:'hybrid',limit:30})).results.some(row=>row.id===primary.id),false);
});

test('own H1 titles outrank citations and snippets expose late evidence through real D1 queries',async()=>{
 const f=fixture(),title='独立检索回归方案';
 const primary=await createRecord(f.env,{name:'方案.md',content:'# '+title+'\n\n'+'背景资料。'.repeat(90)+'\nEVIDENCE512 使用当前正文修订。'});
 await createRecord(f.env,{name:'引用.md',content:'```md\n# '+title+'\n```\n\n这是代码里的标题引用。'});
 Object.assign(f.env.VECTORIZE,{query:async()=>({matches:[]})});
 assert.equal((await search(f.env,{query:title,mode:'hybrid',limit:1})).results[0]?.id,primary.id);
 const literal=await search(f.env,{query:'EVIDENCE512',mode:'literal'});
 assert.ok(literal.results[0]?.snippet.includes('EVIDENCE512 使用当前正文修订'));
 assert.ok(literal.results[0]!.snippet.length<=350);
});

test('semantic and hybrid summaries expose readable evidence with usable pinned source lines',async()=>{
 const f=fixture(),body='# 证据定位\n\n'+('背景内容。\n'.repeat(180))+'\n**EVIDENCE512** [模型指南](https://example.com/reference)\n\n$P=UI$';
 const record=await createRecord(f.env,{name:'source.md',content:body});await processIndexJobs(f.env,1);
 const chunks=f.sql.prepare('SELECT * FROM search_chunks WHERE record_id=? ORDER BY chunk_index').all(record.id);
 const hit=chunks.find(chunk=>String(chunk.content).includes('EVIDENCE512'))!;
 Object.assign(f.env.VECTORIZE,{query:async()=>({matches:[{id:hit.chunk_id,score:.9,metadata:{record_id:record.id,revision:1}}]})});
 for(const mode of ['semantic','hybrid','literal'] as const){
  const result=await search(f.env,{query:'EVIDENCE512',mode,limit:1}),row=result.results[0]!;
  assert.equal(row.snippetFormat,'text');assert.equal(row.revision,1);
  assert.ok(row.snippet.includes('EVIDENCE512 模型指南'));
  assert.equal(row.snippet.includes('**'),false);assert.equal(row.snippet.includes('https://'),false);
  assert.equal('sourceText' in row,false);
  if(mode==='semantic')assert.equal(row.chunkIndex,hit.chunk_index);
  const raw=await readRecord(f.env,row.id,{revision:row.revision,lineStart:row.lineStart,maxLines:row.lineEnd!-row.lineStart!+1});
  assert.ok('content' in raw&&raw.content.includes('**EVIDENCE512** [模型指南](https://example.com/reference)'));
 }
});

test('literal excerpts focus on body evidence even when the indexed name also matches',async()=>{
 const f=fixture();
 const record=await createRecord(f.env,{name:'😀 EVIDENCE512.md',content:'# 正文\n\n'+('背景段落。\n'.repeat(500))+'\n**EVIDENCE512** 正文末尾的实际证据'});
 await processIndexJobs(f.env,1);
 const row=(await search(f.env,{query:'EVIDENCE512',mode:'literal',limit:1})).results[0]!;
 assert.equal(row.id,record.id);assert.ok(row.snippet.includes('正文末尾的实际证据'));
 assert.ok(row.lineStart!>1);assert.equal(row.snippet.includes('**'),false);
});
