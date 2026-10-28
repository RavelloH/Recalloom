import test from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.js';
import type { Env } from '../src/types.js';

for (const limit of [1, 10, 11, 15, 30]) {
  test('semantic search with limit=' + limit + ' respects Vectorize full-metadata topK cap', async () => {
    let actualTopK=0;
    const env={
      AI: {
        run: async () => ({data:[new Array<number>(1024).fill(0)]})
      },
      VECTORIZE: {
        query: async (_vector:number[], options:{topK:number;returnMetadata:string}) => {
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
