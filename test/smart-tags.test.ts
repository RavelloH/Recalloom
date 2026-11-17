import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './tag-fixture.js';
import { createTag, assignTag, updateTag } from '../src/tags/mutations.js';
import { prepareDocumentTags, TAG_THRESHOLD, CLEF_MODEL, CLEF_ACCURATE_MODEL } from '../src/tags/engine.js';
import { processIndexJobs } from '../src/indexing.js';
import { smartTagStatus } from '../src/tags/smart.js';
import type { Env } from '../src/types.js';

const vector = () => Array(512).fill(0.125) as number[];
type F = ReturnType<typeof fixture>;

function indexed(f: F, recordId: string) {
  const chunkId = 'chunk-' + recordId;
  f.db.prepare(
    'INSERT OR IGNORE INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,1,?)'
  ).run(crypto.randomUUID(), recordId, new Date().toISOString());
  f.db.prepare(
    `INSERT OR IGNORE INTO search_chunks
     (chunk_id,record_id,revision,chunk_index,content) VALUES(?,?,1,0,'内容')`
  ).run(chunkId, recordId);
  f.db.prepare(
    "UPDATE index_jobs SET state='done',indexed_revision=1 WHERE record_id=?"
  ).run(recordId);
  return chunkId;
}
function fakeAI(f: F, decisions: (tagName: string, docName: string) => number, fail = false) {
  let embedCalls = 0, clefCalls = 0, uploadCalls = 0;
  const models: string[] = [];
  const vectors = new Map<string, number[]>();
  f.env.AI = {
    run: async (name: string, input: any) => {
      if (name !== CLEF_MODEL && name !== CLEF_ACCURATE_MODEL) {
        embedCalls++;
        return { data: input.input.map(() => ({ embedding: vector() })) };
      }
      clefCalls++;
      models.push(name);
      if (fail) throw Error('Clef temporarily unavailable');
      const data = typeof input.state === 'string' ? JSON.parse(input.state) : input.state;
      const questions = Object.entries(input.questions) as Array<[string, {instructions:string}]>;
      return { answers: Object.fromEntries(questions.map(([key,q]) => {
        const tag = /智能标签「([^」]+)」/.exec(q.instructions)?.[1] ?? '';
        const docId = /仅判断文稿 ([^。]+)\。/.exec(q.instructions)?.[1];
        const doc = docId
          ? data.documents?.find((d:{id:string}) => d.id === docId)
          : data.document;
        const probability = decisions(tag, doc?.title ?? '');
        return [key, { noul: probability }];
      })) };
    }
  } as unknown as Env['AI'];
  f.env.VECTORIZE = {
    upsert: async (items: Array<{ id: string; values: number[] }>) => {
      uploadCalls++;
      items.forEach(x => vectors.set(x.id, x.values));
      return { mutationId: crypto.randomUUID() };
    },
    query: async () => ({ matches: [] }),
    getByIds: async (ids: string[]) => ids.map(id => ({id,values:vectors.get(id)??vector()}))
  } as unknown as Env['VECTORIZE'];
  return {
    vectors,
    calls: () => ({ embedCalls, clefCalls, uploadCalls, models: [...models] }),
    fail: () => { fail = true; },
    recover: () => { fail = false; }
  };
}

test('smart and fixed are tag definition kinds independent from manual/auto association', async () => {
  const f = fixture();
  try {
    const smart = (await createTag(f.env, { name: '技术' })).item;
    const fixed = (await createTag(f.env, { name: '重要', kind: 'fixed' })).item;
    assert.equal(smart.kind, 'smart');
    assert.equal(fixed.kind, 'fixed');
    const record = await f.record('笔记.md', '一段文字');
    fakeAI(f, () => 0.99, true);
    await assignTag(f.env, record, {
      action: 'add', tagId: fixed.id, expectedMetadataRevision: 1
    });
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(record, fixed.id)?.source, 'manual');
    const before = await smartTagStatus(f.env, record);
    assert.ok(Array.isArray(before.ignored));
    assert.ok(!('job' in before));
  } finally { f.db.close(); }
});

test('a manual smart tag change synchronously classifies only that label on related records', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env, { name: '向量检索' })).item;
    const a = await f.record('甲.md','检索方案'), b = await f.record('乙.md','检索实践');
    indexed(f,a); const bChunk = indexed(f,b);
    const ai = fakeAI(f, (label) => label === '向量检索' ? 0.96 : 0.01);
    f.env.VECTORIZE.query = async () => ({matches:[{
      id:bChunk,score:0.95,metadata:{record_id:b,revision:1}
    }]}) as never;
    const before = f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(b);
    assert.equal(before,undefined);
    await assignTag(f.env, a, {tagId:tag.id,action:'add',expectedMetadataRevision:1});
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(a,tag.id)?.source,'manual');
    const found = f.db.prepare(
      'SELECT source,confidence FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(b,tag.id);
    assert.equal(found?.source,'auto');
    assert.ok(Number(found?.confidence)>=TAG_THRESHOLD);
    assert.equal(ai.calls().clefCalls,1);
  } finally { f.db.close(); }
});

test('failed synchronous Clef classification rolls back the manual change', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env,{name:'搜索'})).item;
    const source = await f.record('源.md','内容'), target = await f.record('目标.md','内容');
    indexed(f,source);const targetChunk=indexed(f,target);
    fakeAI(f,()=>0.99,true);
    f.env.VECTORIZE.query=async()=>({matches:[{
      id:targetChunk,score:0.9,metadata:{record_id:target,revision:1}
    }]}) as never;
    await assert.rejects(assignTag(f.env,source,{
      tagId:tag.id,action:'add',expectedMetadataRevision:1
    }),/Clef temporarily unavailable/);
    assert.equal(f.db.prepare(
      'SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?'
    ).get(source)?.n,0);
    assert.equal(f.db.prepare(
      'SELECT metadata_revision FROM records WHERE id=?'
    ).get(source)?.metadata_revision,1);
  } finally { f.db.close(); }
});

test('two passes: new document gathers neighbours tags, then spreads only newly introduced tag', async () => {
  const f=fixture();
  try {
    const A=(await createTag(f.env,{name:'A'})).item;
    const B=(await createTag(f.env,{name:'B'})).item;
    const C=(await createTag(f.env,{name:'C'})).item;
    const D=(await createTag(f.env,{name:'D'})).item;
    const a=await f.record('甲.md','甲'),b=await f.record('乙.md','乙'),
      c=await f.record('丙.md','丙'),d=await f.record('丁.md','丁');
    const chunkMap=new Map([[a,indexed(f,a)],[b,indexed(f,b)],[c,indexed(f,c)]]);
    for(const [record,tagIds] of [
      [a,[A.id,B.id]],[b,[B.id,C.id]],[c,[A.id,C.id]],[d,[A.id,D.id]]
    ] as Array<[string,string[]]>) {
      for(const id of tagIds) f.db.prepare(
        "INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'manual')"
      ).run(record,id);
    }
    const ai=fakeAI(f,(tag,document)=> {
      if (document==='丁') return tag==='B'?0.94:0.04;
      return tag==='D' && document==='甲' ?0.96:
        tag==='D' && document==='丙' ?0.93:0.05;
    });
    f.env.VECTORIZE.query=async()=>({matches:[...chunkMap].map(([id,chunk])=>({
      id:chunk,score:0.9,metadata:{record_id:id,revision:1}
    }))}) as never;
    const plan=await prepareDocumentTags(f.env,d,[vector()]);
    assert.equal(ai.calls().clefCalls,2);
    assert.deepEqual(ai.calls().models, [CLEF_ACCURATE_MODEL, CLEF_MODEL]);
    assert.equal(plan.decisions,5);
    await f.env.DB.batch([...plan.guards,...plan.statements]);
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(d,B.id)?.source,'auto');
    const sourceEvidence = f.db.prepare(
      'SELECT evidence FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(d,B.id)?.evidence as string;
    assert.equal(JSON.parse(sourceEvidence).model, CLEF_ACCURATE_MODEL);
    const propagatedEvidence = f.db.prepare(
      'SELECT evidence FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(a,D.id)?.evidence as string;
    assert.equal(JSON.parse(propagatedEvidence).model, CLEF_MODEL);
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(d,C.id),undefined);
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(a,D.id)?.source,'auto');
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(c,D.id)?.source,'auto');
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(b,D.id),undefined);
  } finally { f.db.close(); }
});

test('the index stays retry when Clef fails, then retries tagging without embedding or upload', async () => {
  const f=fixture();
  try {
    const tag=(await createTag(f.env,{name:'搜索'})).item;
    const source=await f.record('源.md','测试查询'),other=await f.record('参考.md','搜索');
    const otherChunk=indexed(f,other);
    f.db.prepare(
      "INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'manual')"
    ).run(other,tag.id);
    f.db.prepare(
      'INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,1,?)'
    ).run(crypto.randomUUID(),source,new Date().toISOString());
    const ai=fakeAI(f,()=>0.96,true);
    f.env.VECTORIZE.query=async()=>({matches:[{
      id:otherChunk,score:0.9,metadata:{record_id:other,revision:1}
    }]}) as never;
    const one=await processIndexJobs(f.env,1);
    assert.equal(one.results[0]?.error,'Clef temporarily unavailable');
    assert.equal(f.db.prepare(
      'SELECT state FROM index_jobs WHERE record_id=?'
    ).get(source)?.state,'retry');
    assert.equal(f.db.prepare(
      'SELECT stage FROM index_jobs WHERE record_id=?'
    ).get(source)?.stage,'tagging');
    const calls=ai.calls();
    assert.equal(calls.embedCalls,1);
    assert.equal(calls.uploadCalls,1);
    ai.recover();
    f.db.prepare(
      "UPDATE index_jobs SET next_retry_at='2000-01-01' WHERE record_id=?"
    ).run(source);
    const two=await processIndexJobs(f.env,1);
    assert.equal(two.results[0]?.error,undefined);
    assert.equal(f.db.prepare(
      'SELECT state FROM index_jobs WHERE record_id=?'
    ).get(source)?.state,'done');
    assert.equal(ai.calls().embedCalls,1);
    assert.equal(ai.calls().uploadCalls,1);
  } finally { f.db.close(); }
});

test('editing only the description performs synchronous classification without new embeddings', async () => {
  const f=fixture();
  try {
    const tag=(await createTag(f.env,{name:'检索'})).item;
    const target=await f.record('参考.md','搜索'),source=await f.record('待改.md','检索实现');
    const chunk=indexed(f,target);
    indexed(f,source);
    f.db.prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'manual')")
      .run(target,tag.id);
    const ai=fakeAI(f,()=>0.96);
    f.env.VECTORIZE.query=async()=>({matches:[{
      id:chunk,score:0.94,metadata:{record_id:target,revision:1}
    }]}) as never;
    const {updateMeta}=await import('../src/storage/record-metadata.js');
    const result=await updateMeta(f.env,source,{
      description:'搜索技术',expectedMetadataRevision:1
    });
    assert.equal(result.changed,true);
    assert.equal(ai.calls().embedCalls,0);
    assert.equal(ai.calls().clefCalls,1);
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(source,tag.id)?.source,'auto');
    assert.equal(f.db.prepare(
      'SELECT revision FROM record_contents WHERE record_id=?'
    ).get(source)?.revision,1);
  } finally {f.db.close();}
});

test('changing a smart label definition synchronously updates its known neighbourhood', async()=>{
  const f=fixture();
  try {
    const tag=(await createTag(f.env,{name:'旧概念'})).item;
    const source=await f.record('甲.md','技术'),target=await f.record('乙.md','语义主题');
    f.db.prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'manual')")
      .run(source,tag.id);
    f.db.prepare('INSERT INTO smart_tag_evidence(record_id,related_id) VALUES(?,?)')
      .run(source,target);
    const ai=fakeAI(f,()=>0.93);
    const result=await updateTag(f.env,tag.id,{
      name:'新概念',description:'一种技术主题',expectedMetadataRevision:tag.metadataRevision
    });
    assert.equal(result.item.name,'新概念');
    assert.equal(ai.calls().clefCalls,1);
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(target,tag.id)?.source,'auto');
  } finally {f.db.close();}
});

test('fixed label conversion removes only automatic associations, preserving manual ones', async()=>{
  const f=fixture();
  try {
    const tag=(await createTag(f.env,{name:'重要主题'})).item;
    const a=await f.record('甲.md','正文'),b=await f.record('乙.md','正文');
    f.db.prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'auto')")
      .run(a,tag.id);
    f.db.prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'manual')")
      .run(b,tag.id);
    const result=await updateTag(f.env,tag.id,{
      name:tag.name,kind:'fixed',expectedMetadataRevision:tag.metadataRevision
    });
    assert.equal(result.item.kind,'fixed');
    assert.equal(f.db.prepare(
      'SELECT metadata_revision FROM records WHERE id=?'
    ).get(a)?.metadata_revision,2);
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(a,tag.id),undefined);
    assert.equal(f.db.prepare(
      'SELECT source FROM record_tags WHERE record_id=? AND tag_id=?'
    ).get(b,tag.id)?.source,'manual');
    assert.throws(()=>f.db.prepare(
      "INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'auto')"
    ).run(a,tag.id),/FIXED_TAG_AUTOMATIC_FORBIDDEN/);
  } finally {f.db.close();}
});
