import type {Env} from './types.js';

export type ActivityItem={seq:number;revision:number|null;actor:string;actorName:string;actorKind:'user'|'agent'|'system'|'unknown';clientName:string|null;createdAt:string;entityType:string;entityId:string;recordId:string|null;operation:string;resourceName:string;details:Record<string,unknown>|null};
/** UI-facing newest-first activity; the existing MCP incremental changes endpoint stays ascending. */
export async function recentActivity(env:Env,cursor?:number,limit=50){
 const size=Math.max(1,Math.min(limit,200));
 const rows=await env.DB.prepare(`SELECT e.seq,e.revision,e.actor,e.created_at AS createdAt,e.record_id AS recordId,
 e.event_type AS operation,e.entity_type AS entityType,e.entity_id AS entityId,e.details_json AS detailsJson,
 r.name AS recordName,f.name AS folderName,a.client_name AS clientName
 FROM change_events e
 LEFT JOIN records r ON (e.entity_type='record' OR (e.entity_type IS NULL AND e.record_id IS NOT NULL)) AND r.id=COALESCE(e.entity_id,e.record_id)
 LEFT JOIN folders f ON e.entity_type='folder' AND f.id=e.entity_id
 LEFT JOIN oauth_actor_names a ON e.actor=('grant:' || a.actor_id)
 WHERE (? IS NULL OR e.seq < ?) ORDER BY e.seq DESC LIMIT ?`).bind(cursor??null,cursor??null,size+1).all();
 type Row={seq:number;revision:number|null;actor:string;createdAt:string;recordId:string|null;operation:string;entityType:string|null;entityId:string|null;detailsJson:string|null;recordName:string|null;folderName:string|null;clientName:string|null};
 const items=(rows.results as Row[]).slice(0,size).map(row=>{
  let details:Record<string,unknown>|null=null;
  if(row.detailsJson){try{const v:unknown=JSON.parse(row.detailsJson);if(v&&typeof v==='object'&&!Array.isArray(v))details=v as Record<string,unknown>;}catch{/* old malformed details */}}
  const isOwner=row.actor.startsWith('web:owner:');
  const agent=row.actor.startsWith('grant:');
  const system=row.actor.startsWith('system:');
  const clientName=row.clientName?.trim()||null;
  const fallbackName=typeof details?.name==='string'?details.name:typeof details?.title==='string'?details.title:null;
  const entityId=row.entityId||row.recordId||'';
  return {seq:row.seq,revision:row.revision,actor:row.actor,
    actorName:isOwner?'本人（Web）':agent?(clientName||'未识别 Agent'):system?(row.actor==='system:migration'?'系统迁移':'系统'):'未识别的历史操作方',
    actorKind:isOwner?'user':agent?'agent':system?'system':'unknown',clientName,
    createdAt:row.createdAt,recordId:row.recordId,entityType:row.entityType??(row.recordId?'record':'unknown'),entityId,
    operation:row.operation,resourceName:row.recordName||row.folderName||fallbackName||'已移除的资源',details} as ActivityItem;
 });
 const hasMore=rows.results.length>size;
 return {items,page:{hasMore,nextCursor:hasMore?items.at(-1)?.seq??null:null}};
}

/** Populate older OAuth actors after their next authenticated MCP call. */
export async function rememberOAuthActor(env:Env,actorId:string,clientId?:string,knownName?:string){
 if(!/^[a-f0-9-]{36}$/.test(actorId))return;
 const prior=await env.DB.prepare('SELECT 1 AS found FROM oauth_actor_names WHERE actor_id=?').bind(actorId).first();
 if(prior)return;
 let name=knownName?.trim();
 if(!name&&clientId){
  let cursor:string|undefined;
  for(let page=0;page<5;page++){
   const result=await env.OAUTH_PROVIDER.listClients({limit:200,cursor});
   const client=result.items.find(entry=>entry.clientId===clientId);
   if(client){name=client.clientName?.trim()||undefined;break;}
   cursor=result.cursor;if(!cursor)break;
  }
 }
 if(!name)return;
 await env.DB.prepare('INSERT OR IGNORE INTO oauth_actor_names(actor_id,client_name,created_at) VALUES(?,?,?)')
  .bind(actorId,name.slice(0,200),new Date().toISOString()).run();
}
