import type {Env} from './types.js';

/**
 * Latest SAVED CONTENT revisions, not generic record.updated_at: metadata
 * changes should not reorder the homepage's recently updated documents.
 * Exactly one row per record (current revision), with newest first.
 */
export type RecentUpdate={
 id:string;name:string;kind:'document'|'task_list';updatedAt:string;
 revision:number;actorName:string|null;folderPath:string;
};
export async function recentUpdates(env:Env,limit=8):Promise<{items:RecentUpdate[]}>{
 const size=Math.max(1,Math.min(limit,30));
 const rows=await env.DB.prepare(`
  WITH RECURSIVE latest AS (
  SELECT r.id,r.name,r.kind,r.folder_id,v.created_at AS updatedAt,v.revision,
    CASE
      WHEN v.actor LIKE 'web:owner:%' THEN '本人（Web）'
      WHEN v.actor LIKE 'grant:%' THEN NULLIF(trim(a.client_name),'')
      WHEN v.actor='agent' THEN 'Agent'
      ELSE NULL
    END AS actorName
  FROM revisions v
  JOIN record_contents c ON c.record_id=v.record_id AND c.revision=v.revision
  JOIN records r ON r.id=v.record_id
  LEFT JOIN oauth_actor_names a ON v.actor=('grant:' || a.actor_id)
  WHERE r.status!='archived' AND r.kind IN ('document','task_list')
  ORDER BY v.created_at DESC,v.record_id DESC LIMIT ?
  ), locations(id,parentId,path) AS (
    SELECT id,folder_id,'' FROM latest
    UNION ALL SELECT l.id,f.parent_id,'/'||f.name||l.path FROM locations l JOIN folders f ON f.id=l.parentId
  )
  SELECT latest.id,name,kind,updatedAt,revision,actorName,COALESCE(NULLIF(locations.path,''),'/') AS folderPath
  FROM latest LEFT JOIN locations ON locations.id=latest.id AND locations.parentId IS NULL
  ORDER BY updatedAt DESC,latest.id DESC
 `).bind(size).all<RecentUpdate>();
 return {items:rows.results};
}
