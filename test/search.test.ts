import test from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.js';
import {embed,EMBEDDING_MODEL,EMBEDDING_DIMENSIONS} from '../src/indexing.js';
import {StorageError,type Env} from '../src/types.js';

for (const limit of [1, 10, 11, 15, 30]) {
  test('semantic search with limit=' + limit + ' respects Vectorize full-metadata topK cap', async () => {
    let actualTopK=0;
    const env={
      AI: {
        run: async (model:string,input:{input:string[];dimensions:number}) => {
          assert.equal(model,'@cf/google/embeddinggemma-2');
          assert.deepEqual(input,{input:['task: search result | query: 测试关键词'],dimensions:512});
          return {data:[{embedding:new Array<number>(512).fill(0)}]};
        }
      },
      VECTORIZE: {
        query: async (_vector:number[], options:{topK:number;returnMetadata:string}) => {
          assert.equal(_vector.length,512);
          actualTopK=options.topK;
          assert.equal(options.returnMetadata,'all');
          assert.ok(options.topK<=50,'Vectorize full metadata queries must cap topK at 50');
          return {matches:[]};
        }
      }
    } as unknown as Env;
    const result=await search(env,{query:'测试关键词',mode:'semantic',limit});
    assert.equal(result.count,0);
    assert.equal(actualTopK,Math.min(50,Math.max(20,limit*5)));
  });
}


test('Gemma batches preserve order and reject malformed responses before Vectorize writes',async()=>{
 const calls:unknown[]=[];
 const valid=[{embedding:Array(EMBEDDING_DIMENSIONS).fill(.1)},{embedding:Array(EMBEDDING_DIMENSIONS).fill(.2)}];
 let response:unknown={data:valid};
 const env={AI:{run:async(model:string,input:unknown)=>{calls.push({model,input});return response;}}} as unknown as Env;
 assert.deepEqual(await embed(env,[]),[]);assert.equal(calls.length,0);
 const vectors=await embed(env,['first','second']);assert.equal(vectors[0]![0],.1);assert.equal(vectors[1]![0],.2);
 assert.deepEqual(calls[0],{model:EMBEDDING_MODEL,input:{input:['first','second'],dimensions:512}});
 for(const data of [undefined,[],[valid[0]],[null,valid[1]],[{embedding:Array(768).fill(.1)},valid[1]],[{embedding:Array(512).fill(NaN)},valid[1]],[{embedding:Array(512).fill('bad')},valid[1]]]){
  response={data};await assert.rejects(()=>embed(env,['first','second']),(error:unknown)=>error instanceof StorageError&&['EMBEDDING_FAILED','VECTOR_DIMENSION_MISMATCH'].includes(error.code));
 }
});
