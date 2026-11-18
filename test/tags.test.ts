import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {fixture} from './tag-fixture.js';
import {
  createTag,
  updateTag,
  assignTag,
  mergeTag,
  deleteTag,
  tagImpact
} from '../src/tags/mutations.js';
import { getTag, queryTags, ensureTagCatalog } from '../src/tags/catalog.js';
import { queryTaggedRecords } from '../src/tags/records.js';
import { exportSnapshot, importSnapshot, pageHash, type SnapshotPage } from '../src/backup.js';
import { normalizeTagKey, tagSimilarity } from '../src/tag-model.js';


const fails = (code: string) => (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);

test('catalog schema migration preserves existing tag IDs and record associations', async () => {
  const f = fixture(true);
  try {
    const record = await f.record('before.md', 'Preserved body');
    const id = crypto.randomUUID();
    f.db.prepare('INSERT INTO tags(id,name) VALUES(?,?)').run(id, 'Existing');
    f.db.prepare('INSERT INTO record_tags(record_id,tag_id) VALUES(?,?)').run(record, id);
    f.db.exec(readFileSync(new URL('../migrations/0024_tag_catalog.sql', import.meta.url), 'utf8'));
    f.db.exec(readFileSync(new URL('../migrations/0025_smart_tags.sql', import.meta.url), 'utf8'));
    assert.equal(f.db.prepare('SELECT tag_id FROM record_tags WHERE record_id=?').get(record)?.tag_id, id);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal((await getTag(f.env, id)).activeCount, 1);
    assert.equal(f.db.prepare('SELECT content FROM record_contents WHERE record_id=?').get(record)?.content, 'Preserved body');
  } finally {
    f.db.close();
  }
});

test('tag normalization reuses aliases, preserves display case and supports legacy IDs', async () => {
  const f = fixture();
  try {
    assert.equal(normalizeTagKey('  ＡＩ   Research '), 'ai research');
    assert.ok(tagSimilarity('research', 'Research') === 1);
    const a = (
      await createTag(f.env, { name: 'ＡＩ Research', color: 'blue', aliases: ['机器学习'] })
    ).item;
    assert.equal((await createTag(f.env, { name: 'ai research' })).item.id, a.id);
    assert.equal((await createTag(f.env, { name: '机器学习' })).item.id, a.id);
    assert.equal(a.name, 'ＡＩ Research');
    assert.equal((await queryTags(f.env, { query: '机器' })).items[0]?.id, a.id);
    await assert.rejects(
      createTag(f.env, { name: 'Other', aliases: ['机器学习'] }),
      fails('TAG_NAME_CONFLICT')
    );
    const legacy = f.db.prepare("SELECT id FROM tags WHERE name='checkpoint'").get()!.id as string;
    assert.match(legacy, /^[a-f0-9]{32}$/);
    assert.equal((await getTag(f.env, legacy)).name, 'checkpoint');
  } finally {
    f.db.close();
  }
});

test('tag catalog migrates normalized duplicates with preserved associations and redirects', async () => {
  const f = fixture();
  try {
    const record = await f.record('legacy.md', 'Original body');
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    f.db.prepare('INSERT INTO tags(id,name,normalized_name) VALUES(?,?,?)').run(a, 'AI', 'AI');
    f.db.prepare('INSERT INTO tags(id,name,normalized_name) VALUES(?,?,?)').run(b, 'ＡＩ', 'ＡＩ');
    for (const id of [a, b])
      f.db.prepare('INSERT INTO record_tags(record_id,tag_id) VALUES(?,?)').run(record, id);
    await ensureTagCatalog(f.env);
    assert.equal((await getTag(f.env, a)).id, (await getTag(f.env, b)).id);
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?').get(record)?.n,
      1
    );
    assert.equal(
      f.db.prepare('SELECT content FROM record_contents WHERE record_id=?').get(record)?.content,
      'Original body'
    );
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    f.db.close();
  }
});

test('record tag writes enforce metadata CAS and 32 associations while preserving legacy removal', async () => {
  const f = fixture();
  try {
    const id = await f.record('limits.md', 'No body revision');
    const a = await assignTag(f.env, id, {
      tag: 'First',
      action: 'add',
      expectedMetadataRevision: 1
    });
    assert.equal(a.metadataRevision, 2);
    await assert.rejects(
      assignTag(f.env, id, { tag: 'Stale', action: 'add', expectedMetadataRevision: 1 }),
      fails('METADATA_CONFLICT')
    );
    for (let index = 1; index < 32; index++)
      await assignTag(f.env, id, {
        tag: 'Tag ' + index,
        action: 'add',
        expectedMetadataRevision: index + 1
      });
    await assert.rejects(
      assignTag(f.env, id, { tag: 'Excess', action: 'add', expectedMetadataRevision: 33 }),
      fails('INVALID_TAG')
    );
    assert.equal(
      (await assignTag(f.env, id, { tag: 'First', action: 'add', expectedMetadataRevision: 33 }))
        .changed,
      false
    );
    const legacy = (await createTag(f.env, { name: 'Legacy excess' })).item;
    f.db.prepare('INSERT INTO record_tags(record_id,tag_id) VALUES(?,?)').run(id, legacy.id);
    await assignTag(f.env, id, {
      tagId: legacy.id,
      action: 'remove',
      expectedMetadataRevision: 33
    });
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?').get(id)?.n,
      32
    );
    assert.equal(
      f.db.prepare('SELECT revision FROM record_contents WHERE record_id=?').get(id)?.revision,
      1
    );
  } finally {
    f.db.close();
  }
});

test('rename keeps old names and merge preview protects counts, revisions and duplicate associations', async () => {
  const f = fixture();
  try {
    const one = await f.record('one.md', 'One'),
      two = await f.record('two.md', 'Two', 'document', 'archived');
    let a = (await createTag(f.env, { name: 'Alpha' })).item;
    const b = (await createTag(f.env, { name: 'Beta' })).item;
    a = (
      await updateTag(f.env, a.id, { name: 'Gamma', expectedMetadataRevision: a.metadataRevision })
    ).item;
    assert.deepEqual(a.aliases, ['Alpha']);
    await assert.rejects(
      updateTag(f.env, a.id, { name: 'Stale', expectedMetadataRevision: 1 }),
      fails('METADATA_CONFLICT')
    );
    await assignTag(f.env, one, { tag: 'Alpha', action: 'add', expectedMetadataRevision: 1 });
    await assignTag(f.env, one, { tagId: b.id, action: 'add', expectedMetadataRevision: 2 });
    await assignTag(f.env, two, { tagId: a.id, action: 'add', expectedMetadataRevision: 1 });
    const preview = await tagImpact(f.env, a.id, b.id);
    assert.deepEqual([preview.activeCount, preview.archivedCount, preview.duplicates], [1, 1, 1]);
    const input = {
      targetId: b.id,
      expectedMetadataRevision: a.metadataRevision,
      expectedTargetRevision: b.metadataRevision,
      expectedCatalogVersion: preview.catalogVersion
    };
    await createTag(f.env, { name: 'Intervening mutation' });
    await assert.rejects(mergeTag(f.env, a.id, input), fails('METADATA_CONFLICT'));
    assert.equal((await getTag(f.env, a.id)).id, a.id);
    const fresh = await tagImpact(f.env, a.id, b.id);
    await mergeTag(f.env, a.id, { ...input, expectedCatalogVersion: fresh.catalogVersion });
    assert.equal((await getTag(f.env, a.id)).id, b.id);
    assert.equal((await getTag(f.env, b.id)).count, 2);
    assert.ok((await getTag(f.env, b.id)).aliases.includes('Alpha'));
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?').get(one)?.n,
      1
    );
    const deletion = await tagImpact(f.env, b.id);
    await deleteTag(f.env, b.id, {
      expectedMetadataRevision: deletion.source.metadataRevision,
      expectedCatalogVersion: deletion.catalogVersion
    });
    await assert.rejects(getTag(f.env, a.id), fails('TAG_NOT_FOUND'));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM record_tags').get()?.n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM records').get()?.n, 2);
  } finally {
    f.db.close();
  }
});

test('tag record browsing supports all/any, archived counts and stable pagination', async () => {
  const f = fixture();
  try {
    const a = (await createTag(f.env, { name: 'A' })).item,
      b = (await createTag(f.env, { name: 'B' })).item;
    const one = await f.record('One.md', 'One'),
      two = await f.record('Two.md', 'Two', 'document', 'archived');
    await assignTag(f.env, one, { tagId: a.id, action: 'add', expectedMetadataRevision: 1 });
    await assignTag(f.env, one, { tagId: b.id, action: 'add', expectedMetadataRevision: 2 });
    await assignTag(f.env, two, { tagId: b.id, action: 'add', expectedMetadataRevision: 1 });
    f.db.prepare("UPDATE record_tags SET source='auto' WHERE record_id=? AND tag_id=?").run(one, b.id);
    const both = await queryTaggedRecords(f.env, { tagIds: [a.id, b.id], match: 'all', status: 'all' });
    assert.equal(both.total, 1);
    assert.equal(both.items[0]?.tagSource, 'mixed');
    assert.equal((await queryTaggedRecords(f.env, { tagIds: [a.id] })).items[0]?.tagSource, 'manual');
    assert.equal((await queryTaggedRecords(f.env, { tagIds: [b.id] })).items[0]?.tagSource, 'auto');
    const page = await queryTaggedRecords(f.env, {
      tagIds: [a.id, b.id],
      match: 'any',
      status: 'all',
      limit: 1
    });
    assert.equal(page.total, 2);
    assert.ok(page.page.nextCursor);
    assert.equal(
      (
        await queryTaggedRecords(f.env, {
          tagIds: [a.id, b.id],
          match: 'any',
          status: 'all',
          limit: 1,
          cursor: page.page.nextCursor!
        })
      ).items.length,
      1
    );
    assert.equal(
      (await queryTaggedRecords(f.env, { tagIds: [b.id], status: 'archived' })).items[0]?.id,
      two
    );
    assert.equal((await queryTags(f.env)).items[0]?.id, b.id);
    assert.equal((await queryTags(f.env, { usage: 'active' })).items[0]?.id, a.id);
    assert.equal((await queryTags(f.env, { usage: 'archived' })).items[0]?.id, b.id);
    assert.ok(
      (await queryTags(f.env, { usage: 'unused' })).items.some((tag) => tag.name === 'checkpoint')
    );
  } finally {
    f.db.close();
  }
});

test('v5 snapshots roundtrip aliases, colors, redirects and legacy IDs, with v3 import support', async () => {
  const source = fixture(),
    target = fixture(),
    legacy = fixture();
  try {
    const id = await source.record('snapshot.md', 'Same body');
    const a = (
      await createTag(source.env, {
        name: 'A',
        aliases: ['Old A'],
        color: 'pink',
        description: 'Description'
      })
    ).item;
    const b = (await createTag(source.env, { name: 'B' })).item;
    await assignTag(source.env, id, { tagId: a.id, action: 'add', expectedMetadataRevision: 1 });
    const impact = await tagImpact(source.env, b.id, a.id);
    await mergeTag(source.env, b.id, {
      targetId: a.id,
      expectedMetadataRevision: b.metadataRevision,
      expectedTargetRevision: a.metadataRevision,
      expectedCatalogVersion: impact.catalogVersion
    });
    const snapshot = await exportSnapshot(source.env, null, 5);
    assert.equal(snapshot.format, 'recalloom-snapshot-v5');
    await importSnapshot(target.env, { pages: [snapshot] }, false);
    const checkpoint = (await queryTags(source.env, { query: 'checkpoint' })).items[0]!;
    assert.equal((await getTag(target.env, checkpoint.id)).name, 'checkpoint');
    assert.equal((await getTag(target.env, b.id)).id, a.id);
    assert.equal((await getTag(target.env, a.id)).color, 'pink');
    assert.ok((await getTag(target.env, a.id)).aliases.includes('Old A'));
    const old = { ...snapshot, format: 'recalloom-snapshot-v3' as const };
    old.pageHash = await pageHash(old);
    await importSnapshot(legacy.env, { pages: [old] }, false);
    assert.equal((await queryTags(legacy.env, { query: 'A' })).items[0]?.count, 1);
  } finally {
    source.db.close();
    target.db.close();
    legacy.db.close();
  }
});
