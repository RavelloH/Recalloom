import { collectionRuleSchema, type CollectionDraft, type CollectionHit, type CollectionInput, type CollectionItem, type CollectionResults, type CollectionRule } from './collection-model.js';
import { documentCollectionScope } from './collection-filters.js';
import { resolvePath } from './storage/folders.js';
import { getTaskView } from './storage/tasks.js';
import { ensureTagCatalog } from './tags/catalog.js';
import { normalizeTagKey } from './tag-model.js';
import { search } from './search.js';
import { StorageError, type Env } from './types.js';

type Ref = { id: string; name: string };
type ItemRow = Omit<CollectionItem, 'rule'> & { ruleJson: string };
const columns = 'id,name,description,rule_json AS ruleJson,revision,updated_at AS updatedAt';
const itemFromRow = ({ ruleJson, ...row }: ItemRow): CollectionItem => ({ ...row, rule: collectionRuleSchema.parse(JSON.parse(ruleJson)) });

function cursorFrom(input?: string) {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input) as { id?: unknown; updatedAt?: unknown; anchor?: unknown };
    if (typeof parsed.id !== 'string' || typeof parsed.updatedAt !== 'string' || !Number.isFinite(Date.parse(parsed.updatedAt)) ||
        (parsed.anchor !== undefined && (typeof parsed.anchor !== 'string' || !Number.isFinite(Date.parse(parsed.anchor))))) throw Error();
    return { id: parsed.id, updatedAt: parsed.updatedAt, anchor: parsed.anchor as string | undefined };
  } catch { throw new StorageError('INVALID_CURSOR'); }
}

function pageFrom<T extends { id: string; updatedAt: string }>(rows: T[], limit: number, anchor?: string) {
  const last = rows[limit - 1];
  return { nextCursor: last && rows.length > limit ? JSON.stringify({ id: last.id, updatedAt: last.updatedAt, anchor }) : null };
}

export async function listCollections(env: Env, cursor?: string) {
  const after = cursorFrom(cursor), limit = 40;
  const rows = (await env.DB.prepare(`SELECT ${columns} FROM smart_collections ${after ? 'WHERE (updated_at<? OR (updated_at=? AND id>?))' : ''} ORDER BY updated_at DESC,id LIMIT ?`)
    .bind(...(after ? [after.updatedAt, after.updatedAt, after.id] : []), limit + 1).all<ItemRow>()).results;
  return { items: rows.slice(0, limit).map(itemFromRow), page: pageFrom(rows, limit) };
}

export async function getCollection(env: Env, id: string) {
  const row = await env.DB.prepare(`SELECT ${columns} FROM smart_collections WHERE id=?`).bind(id).first<ItemRow>();
  if (!row) throw new StorageError('COLLECTION_NOT_FOUND', '集合不存在');
  return itemFromRow(row);
}

export async function saveCollection(env: Env, input: CollectionInput, previous?: { id: string; revision: number }) {
  const updatedAt = new Date().toISOString(), ruleJson = JSON.stringify(input.rule);
  if (!previous) {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO smart_collections(id,name,description,rule_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .bind(id, input.name, input.description, ruleJson, updatedAt, updatedAt).run();
    return { ...input, id, updatedAt, revision: 1 };
  }
  const result = await env.DB.prepare('UPDATE smart_collections SET name=?,description=?,rule_json=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?')
    .bind(input.name, input.description, ruleJson, updatedAt, previous.id, previous.revision).run();
  if (!result.meta.changes) throw new StorageError('METADATA_CONFLICT');
  return { ...input, id: previous.id, updatedAt, revision: previous.revision + 1 };
}

export async function deleteCollection(env: Env, id: string, revision: number) {
  const result = await env.DB.prepare('DELETE FROM smart_collections WHERE id=? AND revision=?').bind(id, revision).run();
  if (!result.meta.changes) throw new StorageError('METADATA_CONFLICT');
}

async function resolveScope(env: Env, name: string, kind: 'folder' | 'task_list', prior?: Ref): Promise<Ref | string> {
  const label = kind === 'folder' ? '目录' : '任务列表';
  const table = kind === 'folder' ? 'folders' : 'records', filter = kind === 'task_list' ? " AND kind='task_list' AND status!='archived'" : '';
  if (prior?.name === name && await env.DB.prepare(`SELECT id FROM ${table} WHERE id=?${filter}`).bind(prior.id).first()) return prior;
  if (name.startsWith('/')) {
    try {
      const item = await resolvePath(env, name);
      if (kind === 'folder' && item.kind === 'folder' && item.id) return { id: item.id, name };
      if (kind === 'task_list' && item.kind === 'record' &&
          await env.DB.prepare(`SELECT id FROM records WHERE id=?${filter}`).bind(item.id).first()) return { id: item.id!, name };
    } catch (error) { if (!(error instanceof StorageError) || error.code !== 'PATH_NOT_FOUND') throw error; }
  } else {
    const { results } = await env.DB.prepare(`SELECT id,name FROM ${table} WHERE lower(name)=lower(?)${filter} LIMIT 2`).bind(name).all<Ref>();
    if (results.length === 1) return results[0];
    if (results.length > 1) return `有多个${label}叫「${name}」，请输入完整路径。`;
  }
  return `找不到${label}「${name}」。`;
}

export async function resolveCollectionDraft(env: Env, draft: CollectionDraft, previous?: CollectionRule) {
  const { folder, ...fields } = draft;
  const folderResult = folder ? await resolveScope(env, folder, 'folder', previous?.folder) : undefined;
  const issues: string[] = typeof folderResult === 'string' ? [folderResult] : [];
  const resolvedFolder = typeof folderResult === 'string' ? undefined : folderResult;
  let candidate: unknown;
  if (fields.target === 'document') {
    const { tags, ...document } = fields;
    let refs: Ref[] | undefined;
    if (tags?.length) {
      await ensureTagCatalog(env);
      const keys = [...new Set(tags.map(normalizeTagKey))];
      const rows = (await env.DB.prepare('SELECT n.normalized_name AS key,t.id,t.name FROM tag_names n JOIN tags t ON t.id=n.tag_id WHERE n.normalized_name IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all<Ref & { key: string }>()).results;
      const byKey = new Map(rows.map(row => [row.key, row]));
      for (const name of tags) if (!byKey.has(normalizeTagKey(name))) issues.push(`找不到标签「${name}」。`);
      refs = [...new Map(rows.map(({ id, name }) => [id, { id, name }])).values()];
    }
    candidate = { version: 1, ...document, folder: resolvedFolder, tags: refs };
  } else {
    const { taskList, ...task } = fields;
    const result = taskList ? await resolveScope(env, taskList, 'task_list', previous?.target === 'task' ? previous.taskList : undefined) : undefined;
    if (typeof result === 'string') issues.push(result);
    candidate = { version: 1, ...task, folder: resolvedFolder, taskList: typeof result === 'string' ? undefined : result };
  }
  const parsed = collectionRuleSchema.safeParse(candidate);
  if (!parsed.success) issues.push(...parsed.error.issues.map(issue => issue.message));
  return { rule: !issues.length && parsed.success ? parsed.data : null, issues };
}

export async function collectionResults(env: Env, rule: CollectionRule, cursor?: string, limit = 30): Promise<CollectionResults> {
  if (rule.target === 'task') {
    try {
      const { items, page } = await getTaskView(env, { recordId: rule.taskList?.id, folderId: rule.folder?.id, statuses: rule.statuses, query: rule.keyword, limit, cursor });
      return { items: items.map(task => ({ id: task.recordId, taskId: task.id, name: task.title, location: task.list.path, status: task.status, updatedAt: task.updatedAt })), mode: 'filtered', page };
    } catch (error) {
      if (error instanceof StorageError && ['RECORD_NOT_FOUND', 'FOLDER_NOT_FOUND', 'NOT_A_TASK_LIST'].includes(error.code))
        return { items: [], mode: 'filtered', page: { nextCursor: null } };
      throw error;
    }
  }
  if (rule.topic) {
    if (cursor) throw new StorageError('INVALID_CURSOR');
    try {
      const { results } = await search(env, { query: rule.topic, mode: 'semantic', limit, includeFolderName: true, collectionRule: rule });
      return { items: results.map(hit => ({ id: hit.id, name: hit.name, location: hit.folderName ?? undefined, text: hit.snippet, snippetFormat: hit.snippetFormat })), mode: 'semantic', page: { nextCursor: null } };
    } catch {
      return { items: [], mode: 'unavailable', page: { nextCursor: null } };
    }
  }
  const after = cursorFrom(cursor), anchor = after?.anchor ?? new Date().toISOString();
  const { clauses, values } = documentCollectionScope(rule, new Date(anchor));
  if (after) { clauses.push('(r.updated_at<? OR (r.updated_at=? AND r.id>?))'); values.push(after.updatedAt, after.updatedAt, after.id); }
  const rows = (await env.DB.prepare(`SELECT r.id,r.name,COALESCE(r.archived_from_path,f.name,'') AS location,r.description AS text,r.status,r.updated_at AS updatedAt
    FROM records r JOIN record_contents c ON c.record_id=r.id LEFT JOIN folders f ON f.id=r.folder_id WHERE ${clauses.join(' AND ')} ORDER BY r.updated_at DESC,r.id LIMIT ?`)
    .bind(...values, limit + 1).all<CollectionHit & { updatedAt: string }>()).results;
  return { items: rows.slice(0, limit), mode: 'filtered', page: pageFrom(rows, limit, anchor) };
}
