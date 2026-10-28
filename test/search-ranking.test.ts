import test from 'node:test';
import assert from 'node:assert/strict';
import { paragraphChunks, semanticIntentScore, reciprocalRankFusion } from '../src/search-ranking.js';
import { search } from '../src/search.js';
import type { Env } from '../src/types.js';

test('paragraph-aware chunking respects boundaries and a bounded overlap',()=>{
  const input=Array.from({length:25},(_,i)=>'段落 '+i+'：'+('文字内容'.repeat(8))).join('\n\n');
  const parts=paragraphChunks(input,200);
  assert.ok(parts.length>1);
  assert.ok(parts.every(part=>part.length<=200));
  assert.ok(parts[0]!.endsWith('\n\n'),'use nearby paragraph boundary');
  assert.ok(parts.some((part,i)=>i>0&&part.includes('文字内容')));
  assert.deepEqual(paragraphChunks(''),[]);
  assert.equal(paragraphChunks('短文').join(''),'短文');
});

test('short chunk boundaries do not loop and very long paragraphs remain bounded',()=>{
  const chunks=paragraphChunks('汉'.repeat(900),160);
  assert.ok(chunks.length>=6);
  assert.ok(chunks.every(chunk=>chunk.length<=160));
});

test('intent-aware reranking penalizes negated topics while rewarding desired topics',()=>{
  const q='要用 PID 控制左右驱动轮直线运动，而不是丝杆定位';
  const stepper=semanticIntentScore(q,'步进电机丝杆定位：通过微步调整机械定位',0.611);
  const robot=semanticIntentScore(q,'双轮差速机器人 PID 控制直线运动，左右电机 PWM 调整',0.604);
  assert.ok(robot>stepper,JSON.stringify({robot,stepper}));
  assert.ok(semanticIntentScore('OAuth code verifier','授权服务器认证',0.3)<0.43);
});

test('reciprocal rank fusion is bounded, rewards agreement and avoids raw-score bias',()=>{
  const one=reciprocalRankFusion(1,undefined);
  const both=reciprocalRankFusion(1,1);
  assert.ok(one>0&&one<both);
  assert.equal(both,1);
  assert.ok(reciprocalRankFusion(undefined,2)<both);
});

const docs=[
  {id:'robot',name:'机器人差速控制',content:'双轮差速机器人 PID 控制直线运动，左右电机 PWM 调整'},
  {id:'motor',name:'步进电机丝杆定位',content:'步进电机丝杆定位：通过微步调整机械定位'}
];

function fixture(similarities:Record<string,number>,lexicalMatches:string[]=[]){
  let dbCalls=0;
  const env={
    AI:{run:async()=>({data:[Array(1024).fill(0)]})},
    VECTORIZE:{query:async()=>({
      matches:Object.entries(similarities).map(([id,score])=>({
        id:id+':0',score,metadata:{record_id:id,revision:1,chunk_index:0}
      }))
    })},
    DB:{
      prepare:(sql:string)=>({
        bind:(..._args:unknown[])=>({
          all:async()=>{
            dbCalls++;
            if(sql.includes('SELECT s.chunk_id')) return {results:docs.filter(d=>Object.hasOwn(similarities,d.id)).map(d=>({
              chunk_id:d.id+':0',content:d.content,id:d.id,name:d.name,kind:'document',status:'active',revision:1
            }))};
            if(sql.includes('SELECT r.id,r.name,r.kind')) return {results:docs.filter(d=>lexicalMatches.includes(d.id)).map(d=>({
              ...d,kind:'document',status:'active',revision:1
            }))};
            throw Error('Unexpected SQL: '+sql);
          }
        })
      })
    }
  } as unknown as Env;
  return {env,calls:()=>dbCalls};
}

test('semantic results reject irrelevant vectors but allow caller threshold override',async()=>{
  const data=fixture({robot:0.36,motor:0.34});
  const empty=await search(data.env,{query:'查询一个完全无关的话题',mode:'semantic'});
  assert.equal(empty.count,0);
  assert.equal(data.calls(),0,'skip D1 for below-threshold vectors');
  const override=await search(data.env,{query:'查询一个完全无关的话题',mode:'semantic',minScore:0.2});
  assert.equal(override.count,2);
});

test('semantic reranking resolves robot vs stepper negation ambiguity in search',async()=>{
  const data=fixture({motor:0.611,robot:0.604});
  const result=await search(data.env,{query:'要用 PID 控制左右驱动轮直线运动，而不是丝杆定位',mode:'semantic'});
  assert.equal(result.count,2);
  assert.equal(result.results[0]?.id,'robot');
  assert.ok(result.results[0]?.semanticScore!==undefined);
  assert.equal(data.calls(),1,'batch read of semantic results');
});

test('hybrid mode uses rank fusion instead of literal score 1 vs cosine score',async()=>{
  const data=fixture({motor:0.64,robot:0.65},['motor']);
  const result=await search(data.env,{query:'丝杆定位',mode:'hybrid'});
  assert.equal(result.count,2);
  assert.equal(result.results[0]?.id,'motor','a document found by both methods should rank ahead');
  assert.equal(result.results[0]?.source,'hybrid');
  assert.ok(result.results[0]!.score>result.results[1]!.score);
});

test('metadata and literal search skip embedding and preserve literal source',async()=>{
  const data=fixture({},['robot']);
  const result=await search(data.env,{query:'PID',mode:'literal'});
  assert.equal(result.count,1);
  assert.equal(result.results[0]?.id,'robot');
  assert.equal(result.results[0]?.source,'literal');
});
