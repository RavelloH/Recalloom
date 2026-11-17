import type { Env } from '../types.js';
import { StorageError } from '../types.js';
import { tagColors, type TagColor } from '../tag-model.js';
import {
  catalogGuard,
  catalogVersion,
  ensureTagCatalog,
  getTag,
  tagBatch,
  tagEvent,
  tagGuard,
  tagRow,
  validTagName
} from './catalog.js';

export type TagChanges = {
  smartEnabled?: boolean;
  propagate?: boolean;
  name: string;
  description?: string;
  color?: TagColor;
  aliases?: string[];
};
function fields(input: TagChanges) {
  const canonical = validTagName(input.name);
  if ((input.description?.length ?? 0) > 2000 || (input.color && !tagColors.includes(input.color)))
    throw new StorageError('INVALID_TAG');
  const names = new Map([[canonical.key, canonical.name]]);
  for (const alias of input.aliases ?? []) {
    const value = validTagName(alias);
    if (!names.has(value.key)) names.set(value.key, value.name);
  }
  return { canonical, names };
}

/** Compose this plan into record creation so tags and their record commit together. */
export async function planTagNames(env: Env, values: string[]) {
  if (!values.length)
    return { ids: [] as string[], names: [] as string[], statements: [] as D1PreparedStatement[] };
  await ensureTagCatalog(env);
  const normalized = new Map(
    values.map((value) => {
      const tag = validTagName(value);
      return [tag.key, tag.name];
    })
  );
  if (normalized.size > 32) throw new StorageError('INVALID_TAG', '每条记录最多 32 个标签');
  const version = await catalogVersion(env);
  const existing = (
    await env.DB.prepare(
      'SELECT n.normalized_name,t.id,t.name FROM tag_names n JOIN tags t ON t.id=n.tag_id WHERE n.normalized_name IN (SELECT value FROM json_each(?))'
    )
      .bind(JSON.stringify([...normalized.keys()]))
      .all<{ normalized_name: string; id: string; name: string }>()
  ).results;
  const lookup = new Map(existing.map((row) => [row.normalized_name, row]));
  const statements = [catalogGuard(env, version)],
    ids: string[] = [],
    names: string[] = [];
  for (const [key, name] of normalized) {
    const found = lookup.get(key),
      id = found?.id ?? crypto.randomUUID();
    ids.push(id);
    names.push(found?.name ?? name);
    if (!found)
      statements.push(
        env.DB.prepare('INSERT INTO tags(id,name,normalized_name) VALUES(?,?,?)').bind(
          id,
          name,
          key
        ),
        env.DB.prepare('INSERT INTO tag_names(normalized_name,name,tag_id) VALUES(?,?,?)').bind(
          key,
          name,
          id
        )
      );
  }
  return { ids: [...new Set(ids)], names: [...new Set(names)], statements };
}

export async function createTag(env: Env, input: TagChanges, actor = 'agent') {
  await ensureTagCatalog(env);
  const { canonical, names } = fields(input),
    version = await catalogVersion(env);
  const existing = await env.DB.prepare('SELECT tag_id FROM tag_names WHERE normalized_name=?')
    .bind(canonical.key)
    .first<{ tag_id: string }>();
  if (existing) {
    if (
      input.description ||
      (input.color && input.color !== 'gray') ||
      input.aliases?.length ||
      input.smartEnabled === false ||
      input.propagate === false
    )
      throw new StorageError('TAG_NAME_CONFLICT', '标签名称已存在');
    return { item: await getTag(env, existing.tag_id), reused: true };
  }
  const conflict = await env.DB.prepare(
    'SELECT name FROM tag_names WHERE normalized_name IN (SELECT value FROM json_each(?)) LIMIT 1'
  )
    .bind(JSON.stringify([...names.keys()]))
    .first<{ name: string }>();
  if (conflict) throw new StorageError('TAG_NAME_CONFLICT', '名称或别名已被使用');
  const id = crypto.randomUUID(),
    ts = new Date().toISOString();
  const statements = [
    catalogGuard(env, version),
    env.DB.prepare(
      'INSERT INTO tags(id,name,normalized_name,description,color,created_at,updated_at,smart_enabled,propagate) VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(
      id,
      canonical.name,
      canonical.key,
      input.description ?? '',
      input.color ?? 'gray',
      ts,
      ts,
      Number(input.smartEnabled ?? true),
      Number(input.propagate ?? true)
    )
  ];
  for (const [key, name] of names)
    statements.push(
      env.DB.prepare('INSERT INTO tag_names(normalized_name,name,tag_id) VALUES(?,?,?)').bind(
        key,
        name,
        id
      )
    );
  statements.push(tagEvent(env, id, 'tag_create', actor, { name: canonical.name }));
  await tagBatch(env, statements);
  return { item: await getTag(env, id), reused: false };
}

export async function updateTag(
  env: Env,
  id: string,
  input: TagChanges & { expectedMetadataRevision: number },
  actor = 'agent'
) {
  await ensureTagCatalog(env);
  const version = await catalogVersion(env),
    row = await tagRow(env, id),
    current = await getTag(env, row.id);
  if (row.metadata_revision !== input.expectedMetadataRevision)
    throw new StorageError('METADATA_CONFLICT', '标签版本已改变');
  const aliases = input.aliases ?? current.aliases;
  const { canonical, names } = fields({
    ...input,
    aliases: row.normalized_name !== validTagName(input.name).key ? [...aliases, row.name] : aliases
  });
  const conflicts = await env.DB.prepare(
    'SELECT name FROM tag_names WHERE tag_id<>? AND normalized_name IN (SELECT value FROM json_each(?)) LIMIT 1'
  )
    .bind(row.id, JSON.stringify([...names.keys()]))
    .first<{ name: string }>();
  if (conflicts)
    throw new StorageError('TAG_NAME_CONFLICT', '名称或别名已被标签「' + conflicts.name + '」使用');
  const description = input.description ?? row.description,
    color = input.color ?? row.color,
    ts = new Date().toISOString();
  const statements = [
    catalogGuard(env, version),
    tagGuard(env, 'EXISTS(SELECT 1 FROM tags WHERE id=? AND metadata_revision=?)', [
      row.id,
      input.expectedMetadataRevision
    ]),
    env.DB.prepare(
      'UPDATE tags SET name=?,normalized_name=?,description=?,color=?,metadata_revision=metadata_revision+1,updated_at=?,smart_enabled=?,propagate=? WHERE id=?'
    ).bind(
      canonical.name,
      canonical.key,
      description,
      color,
      ts,
      Number(input.smartEnabled ?? Boolean(row.smart_enabled)),
      Number(input.propagate ?? Boolean(row.propagate)),
      row.id
    ),
    env.DB.prepare('DELETE FROM tag_names WHERE tag_id=?').bind(row.id)
  ];
  for (const [key, name] of names)
    statements.push(
      env.DB.prepare('INSERT INTO tag_names(normalized_name,name,tag_id) VALUES(?,?,?)').bind(
        key,
        name,
        row.id
      )
    );
  statements.push(
    tagEvent(env, row.id, 'tag_update', actor, {
      name: canonical.name,
      previousName: row.name,
      aliases: [...names].filter(([key]) => key !== canonical.key).map(([, name]) => name),
      description,
      color
    })
  );
  await tagBatch(env, statements);
  return { item: await getTag(env, row.id) };
}

export async function tagImpact(env: Env, id: string, targetId?: string) {
  await ensureTagCatalog(env);
  const version = await catalogVersion(env),
    source = await getTag(env, id),
    target = targetId ? await getTag(env, targetId) : null;
  if (source.id === target?.id) throw new StorageError('INVALID_TAG', '请选择另一个合并目标');
  const duplicates = target
    ? Number(
        (
          await env.DB.prepare(
            'SELECT COUNT(*) AS n FROM record_tags a JOIN record_tags b ON a.record_id=b.record_id WHERE a.tag_id=? AND b.tag_id=?'
          )
            .bind(source.id, target.id)
            .first<{ n: number }>()
        )?.n ?? 0
      )
    : 0;
  return {
    source,
    target,
    duplicates,
    affectedRecords: Number(
      (
        await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM records WHERE id IN (SELECT record_id FROM record_tags WHERE tag_id=? UNION SELECT record_id FROM record_tag_suppressions WHERE tag_id=?)'
        )
          .bind(source.id, source.id)
          .first<{ n: number }>()
      )?.n ?? 0
    ),
    activeCount: source.activeCount,
    archivedCount: source.archivedCount,
    catalogVersion: version
  };
}

export async function mergeTag(
  env: Env,
  id: string,
  input: {
    targetId: string;
    expectedMetadataRevision: number;
    expectedTargetRevision: number;
    expectedCatalogVersion: number;
  },
  actor = 'agent'
) {
  const preview = await tagImpact(env, id, input.targetId),
    source = preview.source,
    target = preview.target!;
  const ts = new Date().toISOString();
  await tagBatch(env, [
    catalogGuard(env, input.expectedCatalogVersion),
    tagGuard(
      env,
      'EXISTS(SELECT 1 FROM tags WHERE id=? AND metadata_revision=? AND merged_into IS NULL) AND EXISTS(SELECT 1 FROM tags WHERE id=? AND metadata_revision=? AND merged_into IS NULL)',
      [source.id, input.expectedMetadataRevision, target.id, input.expectedTargetRevision]
    ),
    env.DB.prepare(
      'UPDATE records SET metadata_revision=metadata_revision+1,updated_at=? WHERE id IN (SELECT record_id FROM record_tags WHERE tag_id=? UNION SELECT record_id FROM record_tag_suppressions WHERE tag_id=?)'
    ).bind(ts, source.id, source.id),
    env.DB.prepare(
      "UPDATE record_tags SET source='manual',reason='',evidence='',source_revision=NULL,generated_at=NULL WHERE tag_id=? AND source='auto' AND record_id IN (SELECT record_id FROM record_tags WHERE tag_id=? AND source='manual')"
    ).bind(target.id, source.id),
    env.DB.prepare(
      'INSERT OR IGNORE INTO record_tags(record_id,tag_id,source,reason,evidence,source_revision,generated_at) SELECT record_id,?,source,reason,evidence,source_revision,generated_at FROM record_tags WHERE tag_id=?'
    ).bind(target.id, source.id),
    env.DB.prepare('DELETE FROM record_tags WHERE tag_id=?').bind(source.id),
    env.DB.prepare(
      'INSERT OR IGNORE INTO record_tag_suppressions(record_id,tag_id,created_at) SELECT record_id,?,created_at FROM record_tag_suppressions WHERE tag_id=?'
    ).bind(target.id, source.id),
    env.DB.prepare('DELETE FROM record_tag_suppressions WHERE tag_id=?').bind(source.id),
    env.DB.prepare(
      "DELETE FROM record_tags WHERE tag_id=? AND source='auto' AND record_id IN (SELECT record_id FROM record_tag_suppressions WHERE tag_id=?)"
    ).bind(target.id, target.id),
    env.DB.prepare(
      "DELETE FROM record_tag_suppressions WHERE tag_id=? AND record_id IN (SELECT record_id FROM record_tags WHERE tag_id=? AND source='manual')"
    ).bind(target.id, target.id),
    env.DB.prepare('UPDATE tag_names SET tag_id=? WHERE tag_id=?').bind(target.id, source.id),
    env.DB.prepare('UPDATE tags SET merged_into=?,updated_at=? WHERE merged_into=?').bind(
      target.id,
      ts,
      source.id
    ),
    env.DB.prepare(
      'UPDATE tags SET merged_into=?,metadata_revision=metadata_revision+1,updated_at=? WHERE id=?'
    ).bind(target.id, ts, source.id),
    env.DB.prepare(
      'UPDATE tags SET metadata_revision=metadata_revision+1,updated_at=? WHERE id=?'
    ).bind(ts, target.id),
    tagEvent(env, target.id, 'tag_merge', actor, {
      name: target.name,
      sourceId: source.id,
      sourceName: source.name,
      affectedRecords: preview.affectedRecords,
      duplicates: preview.duplicates
    })
  ]);
  return {
    item: await getTag(env, target.id),
    mergedId: source.id,
    affectedRecords: preview.affectedRecords
  };
}

export async function deleteTag(
  env: Env,
  id: string,
  input: { expectedMetadataRevision: number; expectedCatalogVersion: number },
  actor = 'agent'
) {
  const preview = await tagImpact(env, id),
    source = preview.source,
    ts = new Date().toISOString();
  await tagBatch(env, [
    catalogGuard(env, input.expectedCatalogVersion),
    tagGuard(
      env,
      'EXISTS(SELECT 1 FROM tags WHERE id=? AND metadata_revision=? AND merged_into IS NULL)',
      [source.id, input.expectedMetadataRevision]
    ),
    env.DB.prepare(
      'UPDATE records SET metadata_revision=metadata_revision+1,updated_at=? WHERE id IN (SELECT record_id FROM record_tags WHERE tag_id=?)'
    ).bind(ts, source.id),
    env.DB.prepare('DELETE FROM tags WHERE id=?').bind(source.id),
    tagEvent(env, source.id, 'tag_delete', actor, {
      name: source.name,
      affectedRecords: preview.affectedRecords
    })
  ]);
  return { deletedId: source.id, affectedRecords: preview.affectedRecords };
}

export async function assignTag(
  env: Env,
  recordId: string,
  input: {
    tag?: string;
    tagId?: string;
    action: 'add' | 'remove';
    expectedMetadataRevision: number;
  },
  actor = 'agent'
) {
  await ensureTagCatalog(env);
  const record = await env.DB.prepare('SELECT metadata_revision FROM records WHERE id=?')
    .bind(recordId)
    .first<{ metadata_revision: number }>();
  if (!record) throw new StorageError('RECORD_NOT_FOUND');
  if (record.metadata_revision !== input.expectedMetadataRevision)
    throw new StorageError('METADATA_CONFLICT');
  const version = await catalogVersion(env);
  const key = input.tag ? validTagName(input.tag).key : null;
  const existing = input.tagId
    ? await tagRow(env, input.tagId)
    : key
      ? await env.DB.prepare(
          'SELECT t.* FROM tags t JOIN tag_names n ON n.tag_id=t.id WHERE n.normalized_name=?'
        )
          .bind(key)
          .first<Awaited<ReturnType<typeof tagRow>>>()
      : null;
  if (!existing && input.action === 'remove')
    return { id: recordId, changed: false, metadataRevision: record.metadata_revision };
  if (!existing && !input.tag) throw new StorageError('INVALID_TAG');
  const linked = existing
    ? await env.DB.prepare('SELECT source FROM record_tags WHERE record_id=? AND tag_id=?')
        .bind(recordId, existing.id)
        .first<{ source: string }>()
    : null;
  if (
    (input.action === 'add' && linked?.source === 'manual') ||
    (input.action === 'remove' && !linked)
  )
    return { id: recordId, changed: false, metadataRevision: record.metadata_revision };
  if (input.action === 'add' && !linked) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM record_tags WHERE record_id=?')
      .bind(recordId)
      .first<{ n: number }>();
    if (Number(count?.n) >= 32) throw new StorageError('INVALID_TAG', '每条记录最多 32 个标签');
  }
  const statements = [
    catalogGuard(env, version),
    tagGuard(env, 'EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)', [
      recordId,
      input.expectedMetadataRevision
    ])
  ];
  if (input.action === 'add' && !linked)
    statements.push(
      tagGuard(env, '(SELECT COUNT(*) FROM record_tags WHERE record_id=?)<32', [recordId])
    );
  const id = existing?.id ?? crypto.randomUUID(),
    name = existing?.name ?? validTagName(input.tag!).name,
    ts = new Date().toISOString();
  if (!existing)
    statements.push(
      env.DB.prepare('INSERT INTO tags(id,name,normalized_name) VALUES(?,?,?)').bind(id, name, key),
      env.DB.prepare('INSERT INTO tag_names(normalized_name,name,tag_id) VALUES(?,?,?)').bind(
        key,
        name,
        id
      )
    );
  statements.push(
    input.action === 'add'
      ? env.DB.prepare(
          "INSERT INTO record_tags(record_id,tag_id) VALUES(?,?) ON CONFLICT(record_id,tag_id) DO UPDATE SET source='manual',reason='',evidence='',source_revision=NULL,generated_at=NULL"
        ).bind(recordId, id)
      : env.DB.prepare('DELETE FROM record_tags WHERE record_id=? AND tag_id=?').bind(recordId, id)
  );
  statements.push(
    input.action === 'add'
      ? env.DB.prepare('DELETE FROM record_tag_suppressions WHERE record_id=? AND tag_id=?').bind(
          recordId,
          id
        )
      : env.DB.prepare(
          'INSERT INTO record_tag_suppressions(record_id,tag_id,created_at) VALUES(?,?,?) ON CONFLICT(record_id,tag_id) DO UPDATE SET created_at=excluded.created_at'
        ).bind(recordId, id, ts)
  );
  statements.push(
    env.DB.prepare(
      'UPDATE records SET metadata_revision=metadata_revision+1,updated_at=? WHERE id=?'
    ).bind(ts, recordId),
    env.DB.prepare(
      "INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,NULL,?,?,'record',?,?)"
    ).bind(
      recordId,
      'tag_' + input.action,
      actor,
      ts,
      recordId,
      JSON.stringify({ tag: name, tagId: id })
    )
  );
  await tagBatch(env, statements);
  return {
    id: recordId,
    tagId: id,
    tag: name,
    action: input.action,
    changed: true,
    metadataRevision: record.metadata_revision + 1
  };
}
