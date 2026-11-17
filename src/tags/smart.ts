import type { Env } from '../types.js';
import { StorageError } from '../types.js';
import { tagBatch, tagGuard, tagRow } from './catalog.js';

import type { SmartSettings } from '../tag-model.js';
export type { SmartSettings } from '../tag-model.js';
export const smartJobUpsert = ` ON CONFLICT(record_id) DO UPDATE SET
 generation=smart_tag_jobs.generation+1,
 state=CASE WHEN smart_tag_jobs.state='running' THEN 'running' ELSE 'pending' END,
 propagate=MAX(smart_tag_jobs.propagate,excluded.propagate),attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at`;

export async function smartSettings(env: Env): Promise<SmartSettings> {
  const row = await env.DB.prepare('SELECT * FROM smart_tag_settings WHERE id=1').first<{
    enabled: number;
    model: string;
    revision: number;
    definition_version: number;
  }>();
  if (!row) throw new StorageError('SMART_TAG_SETTINGS_MISSING');
  return {
    enabled: Boolean(row.enabled),
    model: row.model,
    revision: row.revision,
    definitionVersion: row.definition_version
  };
}

export async function configureSmartTags(
  env: Env,
  input: { enabled: boolean; model: string; expectedRevision: number }
) {
  if (!/^@cf\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(input.model))
    throw new StorageError('INVALID_MODEL');
  await tagBatch(env, [
    tagGuard(env, 'EXISTS(SELECT 1 FROM smart_tag_settings WHERE id=1 AND revision=?)', [
      input.expectedRevision
    ]),
    env.DB.prepare(
      'UPDATE smart_tag_settings SET enabled=?,model=?,revision=revision+1,definition_version=definition_version+1 WHERE id=1'
    ).bind(Number(input.enabled), input.model)
  ]);
  return smartSettings(env);
}

export async function smartTagStatus(env: Env, id?: string) {
  const settings = await smartSettings(env);
  if (!id) {
    const counts = (
      await env.DB.prepare(
        'SELECT state,COUNT(*) AS count FROM smart_tag_jobs GROUP BY state'
      ).all<{ state: string; count: number }>()
    ).results;
    return { settings, counts };
  }
  const record = await env.DB.prepare(
    'SELECT r.metadata_revision,c.revision,i.state AS index_state,i.indexed_revision FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN index_jobs i ON i.record_id=r.id WHERE r.id=?'
  )
    .bind(id)
    .first<{
      metadata_revision: number;
      revision: number;
      index_state: string;
      indexed_revision: number;
    }>();
  if (!record) throw new StorageError('RECORD_NOT_FOUND');
  const [job, ignored, references] = await Promise.all([
    env.DB.prepare(
      'SELECT generation,state,attempts,last_error AS lastError,updated_at AS updatedAt,finished_at AS finishedAt,revision FROM smart_tag_jobs WHERE record_id=?'
    )
      .bind(id)
      .first(),
    env.DB.prepare(
      'SELECT t.id,t.name,t.color FROM record_tag_suppressions s JOIN tags t ON t.id=s.tag_id WHERE s.record_id=? ORDER BY t.name'
    )
      .bind(id)
      .all(),
    env.DB.prepare(
      'SELECT r.id,r.name FROM smart_tag_evidence e JOIN records r ON r.id=e.related_id WHERE e.record_id=? ORDER BY r.name'
    )
      .bind(id)
      .all()
  ]);
  return {
    settings,
    job,
    ignored: ignored.results,
    references: references.results,
    metadataRevision: record.metadata_revision,
    revision: record.revision,
    waitingForIndex: record.index_state !== 'done' || record.indexed_revision !== record.revision
  };
}

export async function refreshSmartTags(env: Env, id?: string) {
  if (id && !(await env.DB.prepare('SELECT id FROM records WHERE id=?').bind(id).first()))
    throw new StorageError('RECORD_NOT_FOUND');
  const result = await env.DB.prepare(
    "INSERT INTO smart_tag_jobs(record_id,propagate,updated_at) SELECT id,0,? FROM records WHERE status<>'archived' AND (? IS NULL OR id=?)" +
      smartJobUpsert
  )
    .bind(new Date().toISOString(), id ?? null, id ?? null)
    .run();
  return { queued: result.meta.changes };
}

export async function restoreIgnoredTag(
  env: Env,
  id: string,
  tagId: string,
  expectedMetadataRevision: number,
  actor = 'agent'
) {
  const tag = await tagRow(env, tagId),
    ts = new Date().toISOString();
  await tagBatch(env, [
    tagGuard(env, 'EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)', [
      id,
      expectedMetadataRevision
    ]),
    env.DB.prepare('DELETE FROM record_tag_suppressions WHERE record_id=? AND tag_id=?').bind(
      id,
      tag.id
    ),
    env.DB.prepare(
      'UPDATE records SET metadata_revision=metadata_revision+1,updated_at=? WHERE id=?'
    ).bind(ts, id),
    env.DB.prepare(
      'INSERT INTO smart_tag_jobs(record_id,propagate,updated_at) VALUES(?,0,?)' + smartJobUpsert
    ).bind(id, ts),
    env.DB.prepare(
      "INSERT INTO change_events(record_id,event_type,actor,created_at,entity_type,entity_id,details_json) VALUES(?,'tag_restore_suggestion',?,?,'record',?,?)"
    ).bind(id, actor, ts, id, JSON.stringify({ tag: tag.name }))
  ]);
  return { metadataRevision: expectedMetadataRevision + 1 };
}

export async function acceptAutoTags(
  env: Env,
  id: string,
  expectedMetadataRevision: number,
  actor = 'agent'
) {
  const ts = new Date().toISOString();
  await tagBatch(env, [
    tagGuard(env, 'EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)', [
      id,
      expectedMetadataRevision
    ]),
    env.DB.prepare(
      "UPDATE record_tags SET source='manual',reason='',evidence='',source_revision=NULL,generated_at=NULL WHERE record_id=? AND source='auto'"
    ).bind(id),
    env.DB.prepare(
      'UPDATE records SET metadata_revision=metadata_revision+1,updated_at=? WHERE id=?'
    ).bind(ts, id),
    env.DB.prepare(
      "INSERT INTO change_events(record_id,event_type,actor,created_at,entity_type,entity_id) VALUES(?,'tag_accept_all',?,?,'record',?)"
    ).bind(id, actor, ts, id)
  ]);
  return { metadataRevision: expectedMetadataRevision + 1 };
}
