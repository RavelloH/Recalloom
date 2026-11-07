import test from 'node:test';
import assert from 'node:assert/strict';
import {processVectorDeleteJobs} from '../src/lifecycle.js';
import type {Env} from '../src/types.js';

test('permanent-deletion outbox chunks Vectorize deletes into bounded requests',async()=>{
 const recordId='11111111-1111-4111-8111-111111111111';
 const ids=Array.from({length:205},(_,i)=>recordId+':'+i);
 const batches:string[][]=[];
 let state:'pending'|'running'|'failed'|'deleted'='pending';
 let claims=0;
 const db={
  prepare:(sql:string)=>({
   bind:(..._args:unknown[])=>({
    all:async()=>{
     if(sql.startsWith('SELECT record_id AS recordId,chunk_ids AS chunkIds'))
      return {results:state==='deleted'?[]:[{recordId,chunkIds:JSON.stringify(ids)}]};
     throw Error('Unexpected all query: '+sql);
    },
    run:async()=>{
     if(sql.startsWith('UPDATE vector_delete_jobs SET state=')){
      assert.ok(state==='pending'||state==='failed');
      state='running';claims++;return {meta:{changes:1}};
     }
     if(sql.startsWith('DELETE FROM vector_delete_jobs')){state='deleted';return {meta:{changes:1}};}
     if(sql.includes("SET state='failed'")){state='failed';return {meta:{changes:1}};}
     throw Error('Unexpected run query: '+sql);
    }
   })
  })
 };
 const env={DB:db,VECTORIZE:{deleteByIds:async(batch:string[])=>{batches.push(batch);}}} as unknown as Env;
 const first=await processVectorDeleteJobs(env,1);
 assert.equal(first.processed,1);
 assert.equal(first.results[0]?.deleted,true);
 assert.equal(claims,1);
 assert.deepEqual(batches.map(batch=>batch.length),[100,100,5]);
 assert.deepEqual(batches.flat(),ids);
 assert.equal((await processVectorDeleteJobs(env,1)).processed,0,'completed cleanup must not replay');
});

test('failed external vector deletion remains retryable in durable outbox',async()=>{
 const recordId='22222222-2222-4222-8222-222222222222';
 let state:'pending'|'running'|'failed'|'deleted'='pending';
 let failures=0;
 const db={
  prepare:(sql:string)=>({
   bind:(..._args:unknown[])=>({
    all:async()=>({results:state==='deleted'?[]:[{recordId,chunkIds:JSON.stringify([recordId+':0'])}]}),
    run:async()=>{
     if(sql.includes("SET state='failed'")){state='failed';return {meta:{changes:1}};}
     if(sql.startsWith('UPDATE vector_delete_jobs SET state=')){
      state='running';return {meta:{changes:1}};
     }
     if(sql.startsWith('DELETE FROM vector_delete_jobs')){state='deleted';return {meta:{changes:1}};}
     throw Error(sql);
    }
   })
  })
 };
 const env={DB:db,VECTORIZE:{deleteByIds:async()=>{if(failures++===0)throw Error('Temporary Vectorize outage');}}} as unknown as Env;
 const first=await processVectorDeleteJobs(env,1);
 assert.equal(state,'failed');
 assert.match(first.results[0]?.error??'',/outage/);
 const second=await processVectorDeleteJobs(env,1);
 assert.equal(second.results[0]?.deleted,true);
 assert.equal(state,'deleted');
});
