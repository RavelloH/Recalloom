import type {Env} from './types.js';

/**
 * Latest SAVED CONTENT revisions, not generic record.updated_at: metadata
 * changes should not reorder the homepage's recently updated documents.
 * Exactly one row per record (current revision), with newest first.
 */
export type RecentUpdate={
 id:string;name:string;kind:'document'|'task_list';updatedAt:string;
 revision:number;actorName:string|null;
};
export async function recentUpdates(env:Env,limit=8):Promise<{items:RecentUpdate[]}>{
 const size=Math.max(1,Math.min(limit,30));
 const rows=await env.DB.prepare(`
  SELECT r.id,r.name,r.kind,v.created_at AS updatedAt,v.revision,
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
 `).bind(size).all<RecentUpdate>();
 return {items:rows.results};
}
