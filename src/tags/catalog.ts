import type { Env } from '../types.js';
import { StorageError } from '../types.js';
import { displayTagName, normalizeTagKey, type Tag, type TagColor } from '../tag-model.js';

export type TagRow = {
  id: string;
  name: string;
  normalized_name: string;
  smart_enabled: number;
  propagate: number;
  description: string;
  color: TagColor;
  metadata_revision: number;
  created_at: string;
  updated_at: string;
  merged_into: string | null;
};
export const tagFields =
  't.id,t.name,t.normalized_name,t.description,t.color,t.metadata_revision,t.created_at,t.updated_at,t.merged_into,t.smart_enabled,t.propagate';
export const validTagName = (value: string) => {
  const name = displayTagName(value),
    key = normalizeTagKey(name);
  if (!name || name.length > 64 || !key || key.length > 128)
    throw new StorageError('INVALID_TAG', '标签名称需要 1–64 个字符');
  return { name, key };
};
export const tagEvent = (
  env: Env,
  id: string,
  operation: string,
  actor: string,
  details: unknown
) =>
  env.DB.prepare(
    "INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(NULL,?,NULL,?,?,'tag',?,?)"
  ).bind(operation, actor, new Date().toISOString(), id, JSON.stringify(details));
export const tagGuard = (env: Env, condition: string, values: unknown[]) =>
  env.DB.prepare('INSERT INTO tag_write_guard(id) SELECT 0 WHERE NOT (' + condition + ')').bind(
    ...values
  );
export const catalogVersion = async (env: Env) =>
  Number(
    (await env.DB.prepare('SELECT version FROM tag_catalog_state WHERE id=1').first<{
      version: number;
    }>())!.version
  );
export const catalogGuard = (env: Env, version: number) =>
  tagGuard(env, 'EXISTS(SELECT 1 FROM tag_catalog_state WHERE id=1 AND version=?)', [version]);
export async function tagBatch(env: Env, statements: D1PreparedStatement[]) {
  try {
    return await env.DB.batch(statements);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (
      /CHECK constraint failed|tag_write_guard|tags_canonical_key|UNIQUE constraint failed: (tag_names|tags)/i.test(
        message
      )
    )
      throw new StorageError('METADATA_CONFLICT', '标签已发生变化，请刷新后重试');
    throw error;
  }
}

const initialized = new WeakSet<object>();
export async function ensureTagCatalog(env: Env) {
  if (initialized.has(env.DB)) return;
  const state = await env.DB.prepare(
    'SELECT version,normalized FROM tag_catalog_state WHERE id=1'
  ).first<{ version: number; normalized: number }>();
  if (state?.normalized) {
    initialized.add(env.DB);
    return;
  }
  const rows = (await env.DB.prepare('SELECT * FROM tags ORDER BY created_at,id').all<TagRow>())
    .results;
  const groups = new Map<string, TagRow[]>();
  for (const row of rows) {
    const key = validTagName(row.name).key;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const statements = [catalogGuard(env, state!.version)];
  for (const [key, [target, ...sources]] of groups) {
    for (const source of sources) {
      statements.push(
        env.DB.prepare(
          'UPDATE records SET metadata_revision=metadata_revision+1 WHERE id IN (SELECT record_id FROM record_tags WHERE tag_id=?)'
        ).bind(source.id),
        env.DB.prepare(
          'INSERT OR IGNORE INTO record_tags(record_id,tag_id) SELECT record_id,? FROM record_tags WHERE tag_id=?'
        ).bind(target!.id, source.id),
        env.DB.prepare('DELETE FROM record_tags WHERE tag_id=?').bind(source.id),
        env.DB.prepare(
          'UPDATE tags SET merged_into=?,metadata_revision=metadata_revision+1 WHERE id=?'
        ).bind(target!.id, source.id),
        tagEvent(env, target!.id, 'tag_merge', 'system:tag-normalization', {
          name: target!.name,
          sourceId: source.id,
          sourceName: source.name
        })
      );
    }
    statements.push(
      env.DB.prepare('UPDATE tags SET normalized_name=? WHERE id=?').bind(key, target!.id)
    );
  }
  statements.push(env.DB.prepare('DELETE FROM tag_names'));
  for (const [key, [target]] of groups)
    statements.push(
      env.DB.prepare('INSERT INTO tag_names(normalized_name,name,tag_id) VALUES(?,?,?)').bind(
        key,
        target!.name,
        target!.id
      )
    );
  statements.push(env.DB.prepare('UPDATE tag_catalog_state SET normalized=1 WHERE id=1'));
  try {
    await tagBatch(env, statements);
    initialized.add(env.DB);
  } catch (error) {
    if (
      (
        await env.DB.prepare('SELECT normalized FROM tag_catalog_state WHERE id=1').first<{
          normalized: number;
        }>()
      )?.normalized
    ) {
      initialized.add(env.DB);
      return;
    }
    throw error;
  }
}

export async function tagRow(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT * FROM tags WHERE id=?').bind(id).first<TagRow>();
  if (!row) throw new StorageError('TAG_NOT_FOUND');
  if (row.merged_into) return tagRow(env, row.merged_into);
  return row;
}
export async function getTag(env: Env, id: string): Promise<Tag & { requestedId: string }> {
  await ensureTagCatalog(env);
  const row = await tagRow(env, id);
  const [names, counts] = await Promise.all([
    env.DB.prepare('SELECT name FROM tag_names WHERE tag_id=? AND normalized_name<>? ORDER BY name')
      .bind(row.id, row.normalized_name)
      .all<{ name: string }>(),
    env.DB.prepare(
      "SELECT SUM(r.status<>'archived') AS activeCount,SUM(r.status='archived') AS archivedCount FROM record_tags rt JOIN records r ON r.id=rt.record_id WHERE rt.tag_id=?"
    )
      .bind(row.id)
      .first<{ activeCount: number; archivedCount: number }>()
  ]);
  const activeCount = Number(counts?.activeCount ?? 0),
    archivedCount = Number(counts?.archivedCount ?? 0);
  return {
    id: row.id,
    requestedId: id,
    smartEnabled: Boolean(row.smart_enabled),
    propagate: Boolean(row.propagate),
    name: row.name,
    color: row.color,
    description: row.description,
    metadataRevision: row.metadata_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    aliases: names.results.map((item) => item.name),
    activeCount,
    archivedCount,
    count: activeCount + archivedCount
  };
}

export type TagQuery = {
  query?: string;
  usage?: 'all' | 'active' | 'archived' | 'unused';
  sort?: 'name' | 'count' | 'updated';
  limit?: number;
  cursor?: string;
};
export async function queryTags(env: Env, input: TagQuery = {}) {
  await ensureTagCatalog(env);
  const version = await catalogVersion(env),
    query = normalizeTagKey(input.query ?? ''),
    usage = input.usage ?? 'all',
    sort = input.sort ?? 'count';
  const countColumn = {
    all: 'count',
    active: 'activeCount',
    archived: 'archivedCount',
    unused: 'count'
  }[usage];
  const scope = JSON.stringify([query, usage, sort, sort === 'count' ? countColumn : sort]);
  let offset = 0;
  if (input.cursor) {
    try {
      const state = JSON.parse(input.cursor);
      if (
        state.scope !== scope ||
        state.version !== version ||
        !Number.isInteger(state.offset) ||
        state.offset < 0
      )
        throw Error();
      offset = state.offset;
    } catch {
      throw new StorageError('INVALID_CURSOR', '标签列表已改变，请重新加载');
    }
  }
  const counts =
    "COUNT(CASE WHEN r.status<>'archived' THEN 1 END) AS activeCount,COUNT(CASE WHEN r.status='archived' THEN 1 END) AS archivedCount,COUNT(rt.record_id) AS count";
  const clause =
    usage === 'active'
      ? 'activeCount>0'
      : usage === 'archived'
        ? 'archivedCount>0'
        : usage === 'unused'
          ? 'count=0'
          : '1';
  const order =
    sort === 'count'
      ? countColumn + ' DESC,t.normalized_name,t.id'
      : sort === 'updated'
        ? 't.updated_at DESC,t.id'
        : 't.normalized_name,t.id';
  const size = Math.max(1, Math.min(200, input.limit ?? 50));
  const rows = (
    await env.DB.prepare(
      `SELECT ${tagFields},${counts},(SELECT json_group_array(n.name) FROM tag_names n WHERE n.tag_id=t.id AND n.normalized_name<>t.normalized_name) AS aliases FROM tags t LEFT JOIN record_tags rt ON rt.tag_id=t.id LEFT JOIN records r ON r.id=rt.record_id WHERE t.merged_into IS NULL AND (?='' OR EXISTS(SELECT 1 FROM tag_names n WHERE n.tag_id=t.id AND instr(n.normalized_name,?)>0)) GROUP BY t.id HAVING ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`
    )
      .bind(query, query, size + 1, offset)
      .all<
        TagRow & { activeCount: number; archivedCount: number; count: number; aliases: string }
      >()
  ).results;
  const hasMore = rows.length > size;
  const items = rows.slice(0, size).map((row) => ({
    id: row.id,
    smartEnabled: Boolean(row.smart_enabled),
    propagate: Boolean(row.propagate),
    name: row.name,
    description: row.description,
    color: row.color,
    metadataRevision: row.metadata_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activeCount: row.activeCount,
    archivedCount: row.archivedCount,
    count: row.count,
    aliases: JSON.parse(row.aliases) as string[]
  }));
  return {
    items,
    version,
    page: {
      hasMore,
      nextCursor: hasMore ? JSON.stringify({ scope, version, offset: offset + size }) : null
    }
  };
}
