import test from 'node:test';
import assert from 'node:assert/strict';
import { processIndexJobs } from '../src/search.js';
import type { Env } from '../src/types.js';

function fixture(claimed=true,stale=true){
  let claims=0,completed=0;
  const job={id:'job1',record_id:'record1',revision:1,attempts:1};
  const db={
    prepare:(sql:string)=>({
      bind:(..._args:unknown[])=>({
        all:async()=>{
          if(sql.includes('SELECT id,record_id,revision,attempts FROM index_jobs'))return {results:stale?[job]:[]};
          if(sql.includes('SELECT chunk_id FROM search_chunks'))return {results:[]};
          throw Error('Unexpected all '+sql);
        },
        first:async()=>{
          if(sql.includes('SELECT r.id,r.name,r.status'))return {id:'record1',name:'archived',status:'archived',content:'',revision:1};
          if(sql.includes('SELECT revision FROM record_contents'))return {revision:1};
          throw Error('Unexpected first '+sql);
        },
        run:async()=>{
          if(sql.includes("SET state='running'")){
            claims++;
            return {meta:{changes:claimed?1:0}};
          }
          if(sql.includes("SET state='failed'"))return {meta:{changes:0}};
          return {meta:{changes:1}};
        }
      })
    }),
    batch:async(_commands:unknown[])=>{completed++;return [];}
  };
  return {env:{DB:db} as unknown as Env,stats:()=>({claims,completed})};
}
test('expired running index task can be claimed again after a crashed invocation',async()=>{
  const state=fixture();
  const result=await processIndexJobs(state.env,1);
  assert.equal(result.processed,1);
  assert.equal(result.results[0]?.chunks,0);
  assert.deepEqual(state.stats(),{claims:1,completed:1});
});
test('concurrently claimed index task is skipped without doing any work',async()=>{
  const state=fixture(false);
  const result=await processIndexJobs(state.env,1);
  assert.equal(result.results[0]?.skipped,'claimed_elsewhere');
  assert.equal(state.stats().completed,0);
});
test('nonexpired running work is not reprocessed',async()=>{
  const state=fixture(true,false);
  const result=await processIndexJobs(state.env,1);
  assert.equal(result.processed,0);
  assert.equal(state.stats().claims,0);
});
