import type { DocumentCollectionRule } from './collection-model.js';

export function documentCollectionScope(rule: DocumentCollectionRule, at: Date) {
  const clauses = ["r.kind='document'"];
  const values: string[] = [];
  if (rule.archive !== 'all') clauses.push(rule.archive === 'archived' ? "r.status='archived'" : "r.status!='archived'");
  if (rule.folder) {
    clauses.push('r.folder_id IN (WITH RECURSIVE scope(id) AS (SELECT id FROM folders WHERE id=? UNION ALL SELECT f.id FROM folders f JOIN scope s ON f.parent_id=s.id) SELECT id FROM scope)');
    values.push(rule.folder.id);
  }
  if (rule.updatedWithinDays) {
    clauses.push('r.updated_at>=?');
    values.push(new Date(at.getTime() - rule.updatedWithinDays * 86400000).toISOString());
  }
  if (rule.keyword) {
    clauses.push('(instr(lower(r.name),lower(?))>0 OR instr(lower(c.content),lower(?))>0)');
    values.push(rule.keyword, rule.keyword);
  }
  if (rule.tags?.length) {
    const ids = JSON.stringify([...new Set(rule.tags.map(tag => tag.id))]);
    const resolved = 'SELECT DISTINCT COALESCE(t.merged_into,t.id,j.value) AS id FROM json_each(?) j LEFT JOIN tags t ON t.id=j.value';
    clauses.push(rule.tagMatch === 'any'
      ? `EXISTS(SELECT 1 FROM record_tags rt WHERE rt.record_id=r.id AND rt.tag_id IN (${resolved}))`
      : `NOT EXISTS(SELECT 1 FROM (${resolved}) wanted WHERE NOT EXISTS(SELECT 1 FROM record_tags rt WHERE rt.record_id=r.id AND rt.tag_id=wanted.id))`);
    values.push(ids);
  }
  return { clauses, values };
}
