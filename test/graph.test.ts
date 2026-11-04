import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {joinEdges,relatedSemantic,type KnowledgeNode} from '../src/graph.js';
import type {Env} from '../src/types.js';

const source:KnowledgeNode={
 id:'aaa',name:'A',kind:'document',status:'active',folderId:null,folderName:null,updatedAt:'',revision:2
};
const rows=[
 {chunk_id:'bbb:0',record_id:'bbb',revision:3,current_revision:3,status:'active',content:'B text is relevant to A'},
 {chunk_id:'ccc:0',record_id:'ccc',revision:2,current_revision:3,status:'active',content:'Stale C'},
 {chunk_id:'ddd:0',record_id:'ddd',revision:2,current_revision:2,status:'archived',content:'Archived D'},
 {chunk_id:'eee:0',record_id:'eee',revision:1,current_revision:1,status:'active',content:'Metadata ID disagrees'},
 {chunk_id:'fff:0',record_id:'fff',revision:1,current_revision:1,status:'active',content:'F is also related'}
];
function fake(matches:Array<{id:string;score:number;metadata:Record<string,string|number>}>,options:{
 index?:boolean;legacy?:boolean;fail?:boolean
}={}){
 let requests=0;
 const db={
  prepare:(sql:string)=>({
   bind:(...params:unknown[])=>({
    all:async()=>{
     if(sql.includes('SELECT chunk_id AS chunkId'))return {results:options.index===false?[]:[{chunkId:'aaa:0'},{chunkId:'aaa:1'}]};
     if(sql.includes('SELECT s.chunk_id,s.content,s.revision'))return {results:rows.filter(r=>params.includes(r.chunk_id))};
     throw Error('Unexpected SQL '+sql.slice(0,100));
    }
   })
  })
 };
 const vector={
  ...(options.legacy?{}:{queryById:async()=>{
   requests++;
   if(options.fail)throw Error('index outage');
   return {matches};
  }}),
  getByIds:async(ids:string[])=>ids.map(()=>({values:[0.1,0.2]})),
  query:async()=>{
   requests++;
   if(options.fail)throw Error('index outage');
   return {matches};
  }
 };
 return {env:{DB:db,VECTORIZE:vector} as unknown as Env,count:()=>requests};
}
describe('knowledge graph semantic suggestions',()=>{
 it('preserves both link direction and relation type',()=>{
  const e=joinEdges([
   {sourceId:'x',targetId:'y',relation:'references'},
   {sourceId:'y',targetId:'x',relation:'supports'}
  ]);
  assert.equal(e.length,2);
  assert.equal(e[0]!.type,'explicit');
  assert.equal(e[0]!.sourceId,'x');
  assert.equal(e[1]!.sourceId,'y');
  assert.notEqual(e[0]!.id,e[1]!.id);
 });
 it('does not include archived documents or stale and inconsistent vector hits',async()=>{
  const matches=[
   {id:'bbb:0',score:0.92,metadata:{record_id:'bbb',revision:3}},
   {id:'ccc:0',score:0.99,metadata:{record_id:'ccc',revision:2}},
   {id:'ddd:0',score:0.99,metadata:{record_id:'ddd',revision:2}},
   {id:'eee:0',score:0.98,metadata:{record_id:'WRONG',revision:1}},
   {id:'fff:0',score:0.74,metadata:{record_id:'fff',revision:1}},
   {id:'aaa:0',score:1,metadata:{record_id:'aaa',revision:2}},
   {id:'no-D1-row',score:0.95,metadata:{record_id:'ghost',revision:1}},
   {id:'bbb:0',score:0.3,metadata:{record_id:'bbb',revision:3}}
  ];
  const {env,count}=fake(matches);
  const result=await relatedSemantic(env,source,20);
  assert.equal(result.status,'ready');
  assert.equal(count(),2,'one query for each representative source chunk');
  assert.deepEqual(result.edges.map(x=>x.targetId),['bbb','fff']);
  assert.equal(result.edges[0]!.score,0.92);
  assert.equal(result.edges[0]!.support,2);
  assert.equal(result.edges[0]!.snippet,'B text is relevant to A');
  assert.ok(result.edges.every(x=>x.type==='semantic'));
 });
 it('supports index bindings without queryById',async()=>{
  const {env,count}=fake([{id:'bbb:0',score:0.87,metadata:{record_id:'bbb',revision:3}}],{legacy:true});
  const result=await relatedSemantic(env,source,1);
  assert.equal(result.status,'ready');
  assert.equal(count(),2);
  assert.equal(result.edges[0]!.targetId,'bbb');
 });
 it('does not call Vectorize for archived records or unindexed sources',async()=>{
  const {env,count}=fake([],{index:false});
  assert.equal((await relatedSemantic(env,source)).status,'indexing');
  assert.equal((await relatedSemantic(env,{...source,status:'archived'})).status,'archived');
  assert.equal(count(),0);
 });
 it('degrades gracefully when Vectorize is unavailable',async()=>{
  const {env}=fake([],{fail:true});
  const result=await relatedSemantic(env,source);
  assert.equal(result.status,'unavailable');
  assert.deepEqual(result.edges,[]);
 });
});
