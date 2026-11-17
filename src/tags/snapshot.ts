import type { Env } from '../types.js';
import { StorageError } from '../types.js';
import { tagColors, tagIdPattern, type TagSnapshot } from '../tag-model.js';
import {
  catalogGuard,
  catalogVersion,
  ensureTagCatalog,
  validTagName,
  type TagRow
} from './catalog.js';

export async function exportTagCatalog(env: Env): Promise<TagSnapshot[]> {
  await ensureTagCatalog(env);
  const [tags, names] = await Promise.all([
    env.DB.prepare('SELECT * FROM tags ORDER BY id').all<TagRow>(),
    env.DB.prepare(
      'SELECT tag_id,name,normalized_name FROM tag_names ORDER BY normalized_name'
    ).all<{ tag_id: string; name: string; normalized_name: string }>()
  ]);
  return tags.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    metadataRevision: row.metadata_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    kind: row.kind,
    mergedInto: row.merged_into,
    aliases: names.results
      .filter((name) => name.tag_id === row.id && name.normalized_name !== row.normalized_name)
      .map((name) => name.name)
  }));
}

export async function planSnapshotTags(env: Env, catalog: unknown[], recordNames: string[]) {
  await ensureTagCatalog(env);
  const version = await catalogVersion(env),
    statements = [catalogGuard(env, version)];
  const [rows, names] = await Promise.all([
    env.DB.prepare('SELECT * FROM tags').all<TagRow>(),
    env.DB.prepare('SELECT tag_id,normalized_name FROM tag_names').all<{
      tag_id: string;
      normalized_name: string;
    }>()
  ]);
  const current = new Map(rows.results.map((row) => [row.id, row])),
    keys = new Map(names.results.map((row) => [row.normalized_name, row.tag_id]));
  const mapping = new Map<string, string>(),
    seen = new Set<string>();
  const uuid = tagIdPattern;
  const invalid = () => {
    throw new StorageError('INVALID_SNAPSHOT_TAGS');
  };
  const definitions = catalog.map((raw) => {
    if (!raw || typeof raw !== 'object') return invalid();
    const tag = raw as TagSnapshot;
    if (
      !uuid.test(tag.id) ||
      seen.has(tag.id) ||
      typeof tag.name !== 'string' ||
      typeof tag.description !== 'string' ||
      tag.description.length > 2000 ||
      (tag.kind !== undefined && !['smart','fixed'].includes(tag.kind)) ||
      (tag.smartEnabled !== undefined && typeof tag.smartEnabled !== 'boolean') ||
      (tag.propagate !== undefined && typeof tag.propagate !== 'boolean') ||
      !tagColors.includes(tag.color) ||
      !Number.isInteger(tag.metadataRevision) ||
      tag.metadataRevision < 1 ||
      !Array.isArray(tag.aliases) ||
      tag.aliases.some((alias) => typeof alias !== 'string') ||
      typeof tag.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(tag.createdAt)) ||
      typeof tag.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(tag.updatedAt)) ||
      (tag.mergedInto !== null && !uuid.test(tag.mergedInto))
    )
      return invalid();
    validTagName(tag.name);
    tag.aliases.forEach(validTagName);
    seen.add(tag.id);
    return tag;
  });
  const incomingKeys = new Map<string, string>();
  for (const tag of definitions.filter((tag) => !tag.mergedInto))
    for (const name of [tag.name, ...tag.aliases]) {
      const key = validTagName(name).key,
        owner = incomingKeys.get(key);
      if (owner && owner !== tag.id) invalid();
      incomingKeys.set(key, tag.id);
    }
  for (const tag of definitions.filter((tag) => !tag.mergedInto)) {
    const key = validTagName(tag.name).key,
      existing = current.get(tag.id),
      owner = keys.get(key);
    if (
      (existing && (existing.merged_into || existing.normalized_name !== key)) ||
      (existing && owner && owner !== existing.id)
    )
      throw new StorageError('SNAPSHOT_TAG_CONFLICT');
    const id = existing?.id ?? owner ?? tag.id;
    mapping.set(tag.id, id);
    if (!existing && !owner)
      statements.push(
        env.DB.prepare(
          'INSERT INTO tags(id,name,normalized_name,description,color,metadata_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)'
        ).bind(
          id,
          tag.name,
          key,
          tag.description,
          tag.color,
          tag.metadataRevision,
          tag.createdAt,
          tag.updatedAt
        )
      );
    if (!existing && owner && tag.id !== owner) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO tags(id,name,normalized_name,description,color,metadata_revision,created_at,updated_at,merged_into) VALUES(?,?,?,?,?,?,?,?,?)'
        ).bind(
          tag.id,
          tag.name,
          key,
          tag.description,
          tag.color,
          tag.metadataRevision,
          tag.createdAt,
          tag.updatedAt,
          owner
        )
      );
    }
    if (!existing && !owner)
      statements.push(
        env.DB.prepare('UPDATE tags SET kind=? WHERE id=?').bind(tag.kind ?? (tag.smartEnabled===false || tag.propagate===false ? 'fixed' : 'smart'), id)
      );
    for (const name of [tag.name, ...tag.aliases]) {
      const normalized = validTagName(name).key,
        old = keys.get(normalized);
      if (old && old !== id)
        throw new StorageError('TAG_NAME_CONFLICT', '备份中的标签名称或别名与当前标签冲突');
      if (!old) {
        statements.push(
          env.DB.prepare('INSERT INTO tag_names(normalized_name,name,tag_id) VALUES(?,?,?)').bind(
            normalized,
            name,
            id
          )
        );
        keys.set(normalized, id);
      }
    }
  }
  for (const tag of definitions.filter((tag) => tag.mergedInto)) {
    const target =
      mapping.get(tag.mergedInto!) ??
      (current.get(tag.mergedInto!)?.merged_into ? null : current.get(tag.mergedInto!)?.id);
    if (!target || target === tag.id) invalid();
    const existing = current.get(tag.id);
    if (existing) {
      if (existing.merged_into !== target) throw new StorageError('SNAPSHOT_TAG_CONFLICT');
      continue;
    }
    statements.push(
      env.DB.prepare(
        'INSERT INTO tags(id,name,normalized_name,description,color,metadata_revision,created_at,updated_at,merged_into) VALUES(?,?,?,?,?,?,?,?,?)'
      ).bind(
        tag.id,
        tag.name,
        validTagName(tag.name).key,
        tag.description,
        tag.color,
        tag.metadataRevision,
        tag.createdAt,
        tag.updatedAt,
        target
      )
    );
  }
  for (const value of recordNames) {
    const { name, key } = validTagName(value);
    if (keys.has(key)) continue;
    const id = crypto.randomUUID();
    statements.push(
      env.DB.prepare('INSERT INTO tags(id,name,normalized_name) VALUES(?,?,?)').bind(id, name, key),
      env.DB.prepare('INSERT INTO tag_names(normalized_name,name,tag_id) VALUES(?,?,?)').bind(
        key,
        name,
        id
      )
    );
    keys.set(key, id);
  }
  return {
    statements,
    idFor: (name: string) => {
      const id = keys.get(validTagName(name).key);
      if (!id) invalid();
      return id!;
    }
  };
}
