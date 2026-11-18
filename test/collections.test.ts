import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionDraftSchema, collectionRuleSchema } from '../src/collection-model.js';
import { COLLECTION_MODEL, parseCollectionDescription } from '../src/collection-parser.js';
import { collectionResults, deleteCollection, getCollection, listCollections, resolveCollectionDraft, saveCollection } from '../src/collections.js';
import { createFolder, manageFolder } from '../src/storage/folders.js';
import { assignTag, createTag } from '../src/tags/mutations.js';
import { fixture } from './tag-fixture.js';
import type { Env } from '../src/types.js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../src/indexing.js';

const fails = (code: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);

test('collection parsing makes one short Gemma call and rejects invalid output without retry', async () => {
  const requests: Array<{model: string; input: { messages: Array<{role: string; content: string}>; max_completion_tokens: number; chat_template_kwargs: unknown }}> = [];
  let response: unknown = { choices: [{ message: { content: '{"draft":{"target":"document","tags":["性能"],"updatedWithinDays":30,"topic":"编辑器"},"issues":[]}' } }] };
  const env = { AI: { run: async (model: string, input: typeof requests[number]['input']) => { requests.push({ model, input }); return response; } } } as unknown as Env;
  const description = '最近 30 天更新且带性能标签的编辑器文稿';
  assert.deepEqual((await parseCollectionDescription(env, description)).draft, { target: 'document', tags: ['性能'], updatedWithinDays: 30, topic: '编辑器', archive: 'active', tagMatch: 'all' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, COLLECTION_MODEL);
  assert.equal(requests[0].input.max_completion_tokens, 256);
  assert.deepEqual(requests[0].input.chat_template_kwargs, { enable_thinking: false });
  assert.equal(requests[0].input.messages.length, 2);
  assert.equal(requests[0].input.messages[1].content, description);
  response = { response: '{"draft":{"target":"task","dueToday":true}}' };
  await assert.rejects(parseCollectionDescription(env, '今天到期的任务'), fails('COLLECTION_PARSE_INVALID'));
  assert.equal(requests.length, 2);
  response = { response: '{"draft":null,"issues":["没有截止日期条件。"]}' };
  assert.deepEqual(await parseCollectionDescription(env, '今天到期的任务'), { draft: null, issues: ['没有截止日期条件。'] });
});

test('saved document rules use stable IDs, apply combined filters and return current paged results', async () => {
  const data = fixture();
  try {
    const folder = await createFolder(data.env, '项目', null), sub = await createFolder(data.env, '计划', folder.id);
    const stable = (await createTag(data.env, { name: '性能', aliases: ['速度'], kind: 'fixed' })).item;
    const wanted = await data.record('编辑器.md', '编辑器内存'), second = await data.record('索引.md', '编辑器之外的说明');
    const archived = await data.record('旧文.md', '编辑器历史', 'document', 'archived');
    const unrelated = await data.record('其它.md', '编辑器');
    for (const recordId of [wanted, second, archived]) {
      data.db.prepare('UPDATE records SET folder_id=? WHERE id=?').run(sub.id, recordId);
      await assignTag(data.env, recordId, { tagId: stable.id, action: 'add', expectedMetadataRevision: 1 });
    }
    await assignTag(data.env, unrelated, { tagId: stable.id, action: 'add', expectedMetadataRevision: 1 });
    for (const scope of [undefined, ' ', '/']) {
      const global = await resolveCollectionDraft(data.env, collectionDraftSchema.parse({ target: 'document', folder: scope, tags: ['速度'] }));
      assert.deepEqual(global.issues, []);
      assert.ok(global.rule);
      assert.equal(global.rule.folder, undefined);
      assert.deepEqual(new Set((await collectionResults(data.env, global.rule)).items.map(hit => hit.id)), new Set([wanted, second, unrelated]));
    }
    const draft = collectionDraftSchema.parse({ target: 'document', folder: '/项目', tags: ['速度'], keyword: '编辑器' });
    const { rule, issues } = await resolveCollectionDraft(data.env, draft);
    assert.deepEqual(issues, []);
    assert.equal(rule?.target === 'document' && rule.tags?.[0].id, stable.id);
    assert.ok(rule);
    const item = await saveCollection(data.env, { name: '编辑器研究', description: '编辑器的性能文稿', rule });
    await manageFolder(data.env, folder.id, { name: '已改名', expectedMetadataRevision: 1 });
    const reloaded = await getCollection(data.env, item.id);
    assert.equal(reloaded.rule.folder?.id, folder.id);
    assert.equal((await resolveCollectionDraft(data.env, draft, reloaded.rule)).rule?.folder?.id, folder.id);
    const first = await collectionResults(data.env, reloaded.rule, undefined, 1);
    assert.ok(first.page.nextCursor);
    const next = await collectionResults(data.env, reloaded.rule, first.page.nextCursor!, 1);
    assert.deepEqual(new Set([...first.items, ...next.items].map(hit => hit.id)), new Set([wanted, second]));
    assert.equal(next.page.nextCursor, null);
    data.db.prepare("UPDATE records SET status='archived' WHERE id=?").run(second);
    assert.deepEqual((await collectionResults(data.env, reloaded.rule)).items.map(hit => hit.id), [wanted]);
    assert.equal((await listCollections(data.env)).items[0].id, item.id);
    const updated = await saveCollection(data.env, { name: '新名字', description: '', rule }, { id: item.id, revision: item.revision });
    await assert.rejects(deleteCollection(data.env, item.id, item.revision), fails('METADATA_CONFLICT'));
    await deleteCollection(data.env, item.id, updated.revision);
    assert.equal((await listCollections(data.env)).items.length, 0);
    assert.equal((await collectionResults(data.env, rule)).items[0].id, wanted);
  } finally { data.db.close(); }
});

test('collection preview rejects unknown references and finds individual tasks by list path', async () => {
  const data = fixture();
  try {
    const folder = await createFolder(data.env, '工作', null), list = await data.list('开发', ['优化搜索', '修复编辑器']);
    data.db.prepare('UPDATE records SET folder_id=? WHERE id=?').run(folder.id, list.id);
    const doc = await data.record('同名说明', '不是任务列表');
    data.db.prepare('UPDATE records SET folder_id=? WHERE id=?').run(folder.id, doc);
    for (const name of ['/工作/同名说明', '不存在']) {
      const unresolved = await resolveCollectionDraft(data.env, { target: 'task', taskList: name });
      assert.equal(unresolved.rule, null);
      assert.match(unresolved.issues[0], /找不到任务列表/);
    }
    const preview = await resolveCollectionDraft(data.env, { target: 'task', taskList: '/工作/开发', statuses: ['todo'], keyword: '编辑器' });
    assert.ok(preview.rule);
    assert.deepEqual((await collectionResults(data.env, preview.rule)).items.map(hit => hit.taskId), [list.tasks[1].id]);
    const missingTag = await resolveCollectionDraft(data.env, collectionDraftSchema.parse({ target: 'document', tags: ['不存在'] }));
    assert.equal(missingTag.rule, null);
    assert.match(missingTag.issues[0], /找不到标签/);
    assert.equal(collectionRuleSchema.safeParse({ version: 1, target: 'document', topic: '编辑器', archive: 'all' }).success, false);
  } finally { data.db.close(); }
});

test('semantic collections reuse embeddings and obey hard filters when the vector results contain other matches', async () => {
  const data = fixture();
  try {
    const wanted = await data.record('匹配.md', '编辑器性能研究'), unwanted = await data.record('无标签.md', '编辑器性能研究');
    const tag = (await createTag(data.env, { name: '性能', kind: 'fixed' })).item;
    await assignTag(data.env, wanted, { tagId: tag.id, action: 'add', expectedMetadataRevision: 1 });
    for (const id of [wanted, unwanted]) data.db.prepare('INSERT INTO search_chunks(chunk_id,record_id,revision,chunk_index,content) VALUES(?,?,1,0,?)').run(id, id, '编辑器性能研究');
    let calls = 0;
    data.env.AI = { run: async (model: string) => {
      assert.equal(model, EMBEDDING_MODEL); calls++;
      return { data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill(1) }] };
    } } as unknown as Env['AI'];
    data.env.VECTORIZE = { query: async () => ({ matches: [unwanted, wanted].map(id => ({ id, score: .99, metadata: { record_id: id, revision: 1 } })) }) } as unknown as Env['VECTORIZE'];
    const rule = collectionRuleSchema.parse({ version: 1, target: 'document', topic: '编辑器性能', tags: [{ id: tag.id, name: tag.name }] });
    const results = await collectionResults(data.env, rule);
    assert.equal(results.mode, 'semantic');
    assert.deepEqual(results.items.map(hit => hit.id), [wanted]);
    assert.equal(calls, 1);
    data.env.AI = { run: async () => { throw Error('Unavailable'); } } as unknown as Env['AI'];
    assert.equal((await collectionResults(data.env, rule)).mode, 'unavailable');
  } finally { data.db.close(); }
});
