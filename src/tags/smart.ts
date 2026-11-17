import type { Env } from '../types.js';
import { StorageError } from '../types.js';
import { tagBatch, tagGuard } from './catalog.js';
import { prepareManualTagSpread } from './engine.js';

/** Evidence and ignore controls only: automatic labels do not have their own job queue. */
export async function smartTagStatus(env: Env, id: string) {
  const record = await env.DB.prepare(
    `SELECT r.metadata_revision AS metadataRevision,c.revision,i.state AS indexState,
     i.indexed_revision AS indexedRevision FROM records r
     JOIN record_contents c ON c.record_id=r.id
     LEFT JOIN index_jobs i ON i.record_id=r.id WHERE r.id=?`
  ).bind(id).first<{
    metadataRevision: number; revision: number; indexState: string;
    indexedRevision: number | null;
  }>();
  if (!record) throw new StorageError('RECORD_NOT_FOUND');
  const [ignored, references] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id,t.name FROM record_tag_suppressions s
       JOIN tags t ON t.id=s.tag_id WHERE s.record_id=? ORDER BY t.name`
    ).bind(id).all(),
    env.DB.prepare(
      `SELECT r.id,r.name FROM smart_tag_evidence e
       JOIN records r ON r.id=e.related_id WHERE e.record_id=? ORDER BY r.name`
    ).bind(id).all()
  ]);
  return {
    metadataRevision: record.metadataRevision, revision: record.revision,
    indexReady: record.indexState === 'done' &&
      record.indexedRevision === record.revision,
    ignored: ignored.results, references: references.results
  };
}

/** Removing the suppression is an explicit user decision, not a scan/requeue request. */
export async function restoreIgnoredTag(
  env: Env, id: string, tagId: string, expectedMetadataRevision: number,
  actor = 'agent'
) {
  const ts = new Date().toISOString();
  await tagBatch(env, [
    tagGuard(env,
      'EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)',
      [id, expectedMetadataRevision]),
    env.DB.prepare('DELETE FROM record_tag_suppressions WHERE record_id=? AND tag_id=?')
      .bind(id, tagId),
    env.DB.prepare(
      'UPDATE records SET metadata_revision=metadata_revision+1,updated_at=? WHERE id=?'
    ).bind(ts, id),
    env.DB.prepare(
      `INSERT INTO change_events(record_id,event_type,actor,created_at,entity_type,entity_id)
       VALUES(?,'tag_restore_suggestion',?,?,'record',?)`
    ).bind(id, actor, ts, id)
  ]);
  return { metadataRevision: expectedMetadataRevision + 1 };
}

/** Convert up to five automatic labels into manual evidence and synchronously
 * propagate those specific tags, never launching a full background analysis. */
export async function acceptAutoTags(
  env: Env, id: string, expectedMetadataRevision: number, actor = 'agent'
) {
  const rows = (await env.DB.prepare(
    `SELECT t.id,t.name,t.description,t.kind FROM record_tags rt JOIN tags t
     ON t.id=rt.tag_id WHERE rt.record_id=? AND rt.source='auto'`
  ).bind(id).all<{
    id: string; name: string; description: string; kind: 'fixed' | 'smart';
  }>()).results;
  const plans = await Promise.all(rows.map(tag =>
    prepareManualTagSpread(env, id, tag, true)));
  const ts = new Date().toISOString();
  await tagBatch(env, [
    tagGuard(env,
      'EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)',
      [id, expectedMetadataRevision]),
    ...plans.flatMap(plan => plan.guards),
    env.DB.prepare(
      `UPDATE record_tags SET source='manual',reason='',evidence='',
       source_revision=NULL,generated_at=NULL,confidence=NULL
       WHERE record_id=? AND source='auto'`
    ).bind(id),
    env.DB.prepare(
      'UPDATE records SET metadata_revision=metadata_revision+1,updated_at=? WHERE id=?'
    ).bind(ts, id),
    ...plans.flatMap(plan => plan.statements),
    env.DB.prepare(
      `INSERT INTO change_events(record_id,event_type,actor,created_at,entity_type,entity_id)
       VALUES(?,'tag_accept_all',?,?,'record',?)`
    ).bind(id, actor, ts, id)
  ]);
  return { metadataRevision: expectedMetadataRevision + 1 };
}
