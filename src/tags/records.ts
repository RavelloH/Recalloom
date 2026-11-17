import type { Env } from '../types.js';
import { StorageError } from '../types.js';
import { ensureTagCatalog, tagRow } from './catalog.js';

export type TaggedRecordsQuery = {
  tagIds: string[];
  match?: 'all' | 'any';
  status?: 'active' | 'archived' | 'all';
  kind?: 'document' | 'task_list';
  query?: string;
  limit?: number;
  cursor?: string;
};
export async function queryTaggedRecords(env: Env, input: TaggedRecordsQuery) {
  await ensureTagCatalog(env);
  if (!input.tagIds.length || input.tagIds.length > 32) throw new StorageError('INVALID_TAG');
  const tags = await Promise.all(input.tagIds.map((id) => tagRow(env, id))),
    ids = [...new Set(tags.map((tag) => tag.id))];
  const status = input.status ?? 'active',
    match = input.match ?? 'all',
    query = (input.query ?? '').trim().toLowerCase(),
    scope = JSON.stringify([ids.sort(), status, match, input.kind ?? '', query]);
  const watermark = Number(
    (
      await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM change_events').first<{
        n: number;
      }>()
    )?.n ?? 0
  );
  let after: { updatedAt: string; id: string } | null = null;
  if (input.cursor) {
    try {
      const cursor = JSON.parse(input.cursor);
      if (
        cursor.scope !== scope ||
        cursor.watermark !== watermark ||
        typeof cursor.updatedAt !== 'string' ||
        typeof cursor.id !== 'string'
      )
        throw Error();
      after = cursor;
    } catch {
      throw new StorageError('INVALID_CURSOR', '内容列表已改变，请重新加载');
    }
  }
  const tagClause =
    'r.id IN (SELECT record_id FROM record_tags WHERE tag_id IN (SELECT value FROM json_each(?)) GROUP BY record_id HAVING COUNT(DISTINCT tag_id)>=?)';
  const conditions = [tagClause];
  const values: unknown[] = [JSON.stringify(ids), match === 'all' ? ids.length : 1];
  if (status !== 'all') {
    conditions.push(status === 'archived' ? "r.status='archived'" : "r.status<>'archived'");
  }
  if (input.kind) {
    conditions.push('r.kind=?');
    values.push(input.kind);
  }
  if (query) {
    conditions.push(
      "(instr(lower(r.name),?)>0 OR instr(lower(r.description),?)>0 OR instr(lower(COALESCE(r.archived_from_path,p.path||'/'||r.name,'/'||r.name)),?)>0)"
    );
    values.push(query, query, query);
  }
  const paths =
    "WITH RECURSIVE paths(id,path) AS (SELECT id,'/'||name FROM folders WHERE parent_id IS NULL UNION ALL SELECT f.id,p.path||'/'||f.name FROM folders f JOIN paths p ON f.parent_id=p.id) ";
  const from =
    'FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN paths p ON p.id=r.folder_id WHERE ' +
    conditions.join(' AND ');
  const count = await env.DB.prepare(paths + 'SELECT COUNT(*) AS total ' + from)
    .bind(...values)
    .first<{ total: number }>();
  const pageConditions = after ? ' AND (r.updated_at<? OR (r.updated_at=? AND r.id>?))' : '';
  const limit = Math.max(1, Math.min(200, input.limit ?? 40));
  const rows = (
    await env.DB.prepare(
      paths +
        "SELECT r.id,r.name,r.kind,r.status,r.description,r.metadata_revision AS metadataRevision,c.revision,r.updated_at AS updatedAt,COALESCE(r.archived_from_path,p.path||'/'||r.name,'/'||r.name) AS path " +
        from +
        pageConditions +
        ' ORDER BY r.updated_at DESC,r.id LIMIT ?'
    )
      .bind(...values, ...(after ? [after.updatedAt, after.updatedAt, after.id] : []), limit + 1)
      .all<{
        id: string;
        name: string;
        kind: string;
        status: string;
        description: string;
        metadataRevision: number;
        revision: number;
        updatedAt: string;
        path: string;
      }>()
  ).results;
  const items = rows.slice(0, limit),
    hasMore = rows.length > limit,
    last = items.at(-1);
  if (
    Number(
      (
        await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM change_events').first<{
          n: number;
        }>()
      )?.n
    ) !== watermark
  )
    throw new StorageError('METADATA_CONFLICT', '内容已改变，请重新加载');
  return {
    items,
    total: count?.total ?? 0,
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      metadataRevision: tag.metadata_revision
    })),
    page: {
      hasMore,
      nextCursor: hasMore
        ? JSON.stringify({ scope, watermark, updatedAt: last!.updatedAt, id: last!.id })
        : null
    }
  };
}
