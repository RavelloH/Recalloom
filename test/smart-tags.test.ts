import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './tag-fixture.js';
import { createTag, assignTag, mergeTag, tagImpact } from '../src/tags/mutations.js';
import { processSmartTagJobs } from '../src/tags/smart-jobs.js';
import {
  smartTagStatus,
  refreshSmartTags,
  restoreIgnoredTag,
  acceptAutoTags,
  configureSmartTags
} from '../src/tags/smart.js';
import { exportSnapshot, importSnapshot } from '../src/backup.js';
import type { Env } from '../src/types.js';

function model(f: ReturnType<typeof fixture>, during?: (id: string) => void) {
  let calls = 0;
  f.env.AI = {
    run: async (_model: unknown, input: { messages: Array<{ content: string }> }) => {
      calls++;
      const data = JSON.parse(input.messages[1]!.content);
      during?.(data.title);
      const tag = data.candidates.find((item: { name: string }) => item.name === 'Physics');
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                tags: tag ? [{ tagId: tag.id, reason: '讨论力学', evidence: '力学' }] : []
              })
            }
          }
        ]
      };
    }
  } as unknown as Env['AI'];
  f.env.VECTORIZE = {
    getByIds: async (ids: string[]) => ids.map((id) => ({ id })),
    queryById: async () => ({ matches: [] })
  } as unknown as Env['VECTORIZE'];
  return () => calls;
}
function indexed(f: ReturnType<typeof fixture>, id: string) {
  f.db
    .prepare('INSERT OR IGNORE INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,1,?)')
    .run(crypto.randomUUID(), id, new Date().toISOString());
  f.db
    .prepare(
      'INSERT OR IGNORE INTO search_chunks(chunk_id,record_id,revision,chunk_index,content) VALUES(?,?,1,0,?)'
    )
    .run('chunk-' + id, id, '力学');
  f.db.prepare("UPDATE index_jobs SET state='done',indexed_revision=1 WHERE record_id=?").run(id);
}

test('smart tags wait for the current index, then apply bounded automatic labels', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env, { name: 'Physics' })).item;
    const id = await f.record('力学笔记.md', '研究力学与运动');
    const calls = model(f);
    await refreshSmartTags(f.env, id);
    assert.equal((await processSmartTagJobs(f.env)).processed, 0);
    assert.equal(calls(), 0);
    indexed(f, id);
    await processSmartTagJobs(f.env);
    assert.equal(calls(), 1);
    const row = f.db.prepare('SELECT * FROM record_tags WHERE record_id=?').get(id)!;
    assert.equal(row.tag_id, tag.id);
    assert.equal(row.source, 'auto');
    assert.equal(row.evidence, '力学');
    assert.equal(
      f.db.prepare('SELECT revision FROM record_contents WHERE record_id=?').get(id)?.revision,
      1
    );
    const status = await smartTagStatus(f.env, id);
    assert.equal(status.job?.state, 'done');
    assert.equal(
      f.db.prepare('SELECT propagate FROM smart_tag_jobs WHERE record_id=?').get(id)?.propagate,
      0
    );
  } finally {
    f.db.close();
  }
});

test('manual confirmation wins, ignore survives regeneration, and restore allows recommendations again', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env, { name: 'Physics' })).item,
      id = await f.record('力学.md', '力学研究');
    model(f);
    indexed(f, id);
    await processSmartTagJobs(f.env);
    await assignTag(f.env, id, { tagId: tag.id, action: 'remove', expectedMetadataRevision: 2 });
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM record_tag_suppressions').get()?.n, 1);
    await refreshSmartTags(f.env, id);
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?').get(id)?.n,
      0
    );
    await restoreIgnoredTag(f.env, id, tag.id, 3);
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(id)?.source,
      'auto'
    );
    const revision = Number(
      f.db.prepare('SELECT metadata_revision FROM records WHERE id=?').get(id)?.metadata_revision
    );
    await assignTag(f.env, id, {
      tagId: tag.id,
      action: 'add',
      expectedMetadataRevision: revision
    });
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(id)?.source,
      'manual'
    );
    await refreshSmartTags(f.env, id);
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(id)?.source,
      'manual'
    );
  } finally {
    f.db.close();
  }
});

test('propagation reevaluates neighbours once using their own content and preserves old neighbourhood evidence', async () => {
  const f = fixture();
  try {
    await createTag(f.env, { name: 'Physics' });
    const a = await f.record('A.md', '力学 A'),
      b = await f.record('B.md', '力学 B');
    model(f);
    indexed(f, a);
    indexed(f, b);
    f.db.exec('DELETE FROM smart_tag_jobs');
    indexed(f, a);
    f.db
      .prepare("UPDATE smart_tag_jobs SET updated_at='2020-01-01T00:00:00.000Z' WHERE record_id=?")
      .run(a);
    f.env.VECTORIZE = {
      ...f.env.VECTORIZE,
      queryById: async (id: string) => ({
        matches: [
          {
            id: id === 'chunk-' + a ? 'chunk-' + b : 'chunk-' + a,
            score: 0.9,
            metadata: { record_id: id === 'chunk-' + a ? b : a, revision: 1 }
          }
        ]
      })
    } as unknown as Env['VECTORIZE'];
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(a)?.state,
      'done'
    );
    assert.equal(
      f.db.prepare('SELECT propagate FROM smart_tag_jobs WHERE record_id=?').get(b)?.propagate,
      0
    );
    const generation = f.db
      .prepare('SELECT generation FROM smart_tag_jobs WHERE record_id=?')
      .get(a)?.generation;
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(b)?.state,
      'done'
    );
    assert.equal(
      f.db.prepare('SELECT generation FROM smart_tag_jobs WHERE record_id=?').get(a)?.generation,
      generation
    );
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM smart_tag_evidence').get()?.n, 2);
  } finally {
    f.db.close();
  }
});

test('in-flight stale model results cannot overwrite newer content or user decisions', async () => {
  const f = fixture();
  try {
    await createTag(f.env, { name: 'Physics' });
    const id = await f.record('力学.md', '力学');
    indexed(f, id);
    model(f, () => {
      f.db
        .prepare('UPDATE record_contents SET revision=2,content=? WHERE record_id=?')
        .run('New unrelated content', id);
      f.db
        .prepare(
          "UPDATE index_jobs SET state='pending',revision=2,generation=generation+1 WHERE record_id=?"
        )
        .run(id);
    });
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?').get(id)?.n,
      0
    );
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(id)?.state,
      'pending'
    );
  } finally {
    f.db.close();
  }
});

test('automatic recommendation failures preserve existing tags and record their retry state', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env, { name: 'Physics' })).item,
      id = await f.record('力学.md', '力学');
    indexed(f, id);
    f.db
      .prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'auto')")
      .run(id, tag.id);
    model(f);
    f.env.AI.run = async () => {
      throw Error('Model unavailable');
    };
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(id)?.source,
      'auto'
    );
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(id)?.state,
      'retry'
    );
  } finally {
    f.db.close();
  }
});

test('definition versions exclude usage changes, and snapshots retain automatic provenance and ignored labels', async () => {
  const f = fixture(),
    target = fixture();
  try {
    const tag = (await createTag(f.env, { name: 'Physics', propagate: false })).item;
    const ignored = (await createTag(f.env, { name: 'Ignored', smartEnabled: false })).item;
    const id = await f.record('力学.md', '力学');
    model(f);
    indexed(f, id);
    const version = f.db
      .prepare('SELECT definition_version FROM smart_tag_settings')
      .get()?.definition_version;
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT definition_version FROM smart_tag_settings').get()?.definition_version,
      version
    );
    f.db
      .prepare('INSERT INTO record_tag_suppressions(record_id,tag_id,created_at) VALUES(?,?,?)')
      .run(id, ignored.id, new Date().toISOString());
    const snapshot = await exportSnapshot(f.env);
    await importSnapshot(target.env, { pages: [snapshot] }, false);
    assert.equal(
      target.db
        .prepare('SELECT source FROM record_tags WHERE record_id=? AND tag_id=?')
        .get(id, tag.id)?.source,
      'auto'
    );
    assert.equal(
      target.db.prepare('SELECT tag_id FROM record_tag_suppressions WHERE record_id=?').get(id)
        ?.tag_id,
      ignored.id
    );
    assert.equal(
      target.db.prepare('SELECT smart_enabled FROM tags WHERE id=?').get(ignored.id)?.smart_enabled,
      0
    );
    assert.equal(
      target.db.prepare('SELECT propagate FROM tags WHERE id=?').get(tag.id)?.propagate,
      0
    );
  } finally {
    f.db.close();
    target.db.close();
  }
});

test('merge retains automatic sources and manual priority with canonical ignore decisions', async () => {
  const f = fixture();
  try {
    const a = (await createTag(f.env, { name: 'Physics' })).item,
      b = (await createTag(f.env, { name: 'Science' })).item;
    const id = await f.record('力学.md', '力学'),
      other = await f.record('Other.md', '力学');
    f.db
      .prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'auto')")
      .run(id, a.id);
    f.db
      .prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'auto')")
      .run(other, b.id);
    f.db
      .prepare('INSERT INTO record_tag_suppressions(record_id,tag_id,created_at) VALUES(?,?,?)')
      .run(other, a.id, new Date().toISOString());
    const impact = await tagImpact(f.env, a.id, b.id);
    await mergeTag(f.env, a.id, {
      targetId: b.id,
      expectedMetadataRevision: a.metadataRevision,
      expectedTargetRevision: b.metadataRevision,
      expectedCatalogVersion: impact.catalogVersion
    });
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(id)?.source,
      'auto'
    );
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?').get(other)?.n,
      0
    );
    assert.equal(
      f.db.prepare('SELECT tag_id FROM record_tag_suppressions WHERE record_id=?').get(other)
        ?.tag_id,
      b.id
    );
    assert.equal(
      f.db.prepare('SELECT metadata_revision FROM records WHERE id=?').get(other)
        ?.metadata_revision,
      2
    );
    await acceptAutoTags(f.env, id, 2);
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(id)?.source,
      'manual'
    );
  } finally {
    f.db.close();
  }
});

test('vector visibility delays analysis and generation fences newer manual choices', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env, { name: 'Physics' })).item;
    const id = await f.record('力学.md', '力学');
    indexed(f, id);
    const calls = model(f);
    f.env.VECTORIZE.getByIds = async () => [];
    await processSmartTagJobs(f.env);
    assert.equal(calls(), 0);
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(id)?.state,
      'retry'
    );
    await refreshSmartTags(f.env, id);
    model(f, () => {
      f.db
        .prepare("INSERT INTO record_tags(record_id,tag_id,source) VALUES(?,?,'manual')")
        .run(id, tag.id);
      f.db.prepare('UPDATE records SET metadata_revision=metadata_revision+1 WHERE id=?').run(id);
    });
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(id)?.source,
      'manual'
    );
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(id)?.state,
      'pending'
    );
  } finally {
    f.db.close();
  }
});

test('exhausted failures stop until definitions or model settings change', async () => {
  const f = fixture();
  try {
    await createTag(f.env, { name: 'Physics' });
    const id = await f.record('力学.md', '力学');
    indexed(f, id);
    model(f);
    f.db.prepare('UPDATE smart_tag_jobs SET attempts=4 WHERE record_id=?').run(id);
    f.env.AI.run = async () => {
      throw Error('Model unavailable');
    };
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(id)?.state,
      'failed'
    );
    assert.equal((await processSmartTagJobs(f.env)).processed, 0);
    await configureSmartTags(f.env, {
      enabled: true,
      model: '@cf/google/gemma-4-26b-a4b-it',
      expectedRevision: 1
    });
    model(f);
    await processSmartTagJobs(f.env);
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(id)?.state,
      'done'
    );
  } finally {
    f.db.close();
  }
});

test('manual-only tag changes update related documents in the same urgent drain without classifying the source', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env, { name: 'Physics' })).item;
    const retained = (await createTag(f.env, { name: 'Retained auto' })).item;
    const source = await f.record('Source.md', '力学来源'),
      target = await f.record('Target.md', '力学目标');
    const untouched = await f.record('Old backlog.md', '力学旧任务');
    f.db
      .prepare(
        "INSERT INTO record_tags(record_id,tag_id,source,reason) VALUES(?,?,'auto','保留原推荐')"
      )
      .run(source, retained.id);
    indexed(f, source);
    indexed(f, target);
    indexed(f, untouched);
    f.db
      .prepare(
        "UPDATE smart_tag_jobs SET state='done',analyze=0,propagate=0,definition_version=(SELECT definition_version FROM smart_tag_settings)"
      )
      .run();
    f.db
      .prepare("UPDATE smart_tag_jobs SET state='pending',analyze=1 WHERE record_id=?")
      .run(untouched);
    const calls: string[] = [],
      trusted: Array<unknown[]> = [];
    model(f, (title) => calls.push(title));
    const run = f.env.AI.run;
    f.env.AI.run = (async (modelName: never, input: any) => {
      trusted.push(JSON.parse(input.messages[1].content).trustedRelatedTags);
      return run(modelName, input);
    }) as Env['AI']['run'];
    (
      f.env.VECTORIZE as Env['VECTORIZE'] & { queryById: (id: string) => Promise<unknown> }
    ).queryById = async (id: string) => ({
      count: 1,
      matches: [
        {
          id: 'chunk-' + (id === 'chunk-' + source ? target : source),
          score: 0.9,
          metadata: { record_id: id === 'chunk-' + source ? target : source, revision: 1 }
        }
      ]
    });
    await assignTag(f.env, source, { tagId: tag.id, action: 'add', expectedMetadataRevision: 1 });
    const result = await processSmartTagJobs(f.env, 1, Date.now() + 24_000, true);
    assert.equal(result.processed, 2);
    assert.deepEqual(calls, ['Target.md']);
    assert.ok(trusted[0]?.some((value: any) => value.recordId === source && value.id === tag.id));
    assert.equal(
      f.db.prepare('SELECT metadata_revision FROM records WHERE id=?').get(source)
        ?.metadata_revision,
      2
    );
    assert.equal(
      f.db
        .prepare('SELECT source FROM record_tags WHERE record_id=? AND tag_id=?')
        .get(source, tag.id)?.source,
      'manual'
    );
    assert.equal(
      f.db
        .prepare('SELECT reason FROM record_tags WHERE record_id=? AND tag_id=?')
        .get(source, retained.id)?.reason,
      '保留原推荐'
    );
    assert.equal(
      f.db.prepare('SELECT source FROM record_tags WHERE record_id=?').get(target)?.source,
      'auto'
    );
    assert.equal(
      f.db.prepare('SELECT state FROM smart_tag_jobs WHERE record_id=?').get(untouched)?.state,
      'pending'
    );
    await assignTag(f.env, source, {
      tagId: tag.id,
      action: 'remove',
      expectedMetadataRevision: 2
    });
    calls.length = 0;
    await processSmartTagJobs(f.env, 1, Date.now() + 24_000, true);
    assert.deepEqual(calls, ['Target.md']);
  } finally {
    f.db.close();
  }
});

test('manual propagation uses the last index while a newer source body waits, and the new body is analysed only after its index completes', async () => {
  const f = fixture();
  try {
    const tag = (await createTag(f.env, { name: 'Physics' })).item;
    const source = await f.record('Source.md', '力学来源'),
      target = await f.record('Target.md', '力学目标');
    indexed(f, source);
    indexed(f, target);
    f.db
      .prepare(
        "UPDATE smart_tag_jobs SET state='done',analyze=0,propagate=0,definition_version=(SELECT definition_version FROM smart_tag_settings)"
      )
      .run();
    f.db
      .prepare("UPDATE record_contents SET revision=2,content='力学新正文' WHERE record_id=?")
      .run(source);
    f.db.prepare("UPDATE index_jobs SET state='pending',revision=2 WHERE record_id=?").run(source);
    const calls: string[] = [];
    model(f, (title) => calls.push(title));
    (
      f.env.VECTORIZE as Env['VECTORIZE'] & { queryById: (id: string) => Promise<unknown> }
    ).queryById = async (id: string) => ({
      count: 1,
      matches: [
        {
          id: 'chunk-' + (id === 'chunk-' + source ? target : source),
          score: 0.9,
          metadata: { record_id: id === 'chunk-' + source ? target : source, revision: 1 }
        }
      ]
    });
    await assignTag(f.env, source, { tagId: tag.id, action: 'add', expectedMetadataRevision: 1 });
    await processSmartTagJobs(f.env, 1, Date.now() + 24_000, true);
    assert.deepEqual(calls, ['Target.md']);
    assert.equal(
      f.db.prepare('SELECT indexed_revision FROM index_jobs WHERE record_id=?').get(source)
        ?.indexed_revision,
      1
    );
    f.db.prepare('UPDATE search_chunks SET revision=2 WHERE record_id=?').run(source);
    f.db
      .prepare("UPDATE index_jobs SET state='done',indexed_revision=2 WHERE record_id=?")
      .run(source);
    await processSmartTagJobs(f.env);
    assert.deepEqual(calls, ['Target.md', 'Source.md']);
  } finally {
    f.db.close();
  }
});
