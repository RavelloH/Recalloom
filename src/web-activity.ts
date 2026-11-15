import type {Env} from './types.js';
import {StorageError} from './types.js';
import {activityQuery,type ActivityFilter} from './activity-query.js';
import {recordExtras} from './storage/internal.js';

export type ActivityItem={seq:number;revision:number|null;actor:string;actorName:string;actorKind:'user'|'agent'|'system'|'unknown';clientName:string|null;createdAt:string;entityType:string;entityId:string;recordId:string|null;operation:string;resourceName:string;details:Record<string,unknown>|null;category:string;resourceExists:boolean;recordKind:string|null};
type ActivityRow=Omit<ActivityItem,'details'|'resourceExists'>&{detailsJson:string;resourceExists:number};
const activityColumns='seq,revision,actor,actorName,actorKind,clientName,createdAt,recordId,operation,entityType,entityId,detailsJson,recordKind,resourceExists,resourceName,category';
function activityItem(row:ActivityRow):ActivityItem{
 const {detailsJson,...rest}=row;let details:Record<string,unknown>|null=null;
 try{const value:unknown=JSON.parse(detailsJson);if(value&&typeof value==='object'&&!Array.isArray(value))details=value as Record<string,unknown>;}catch{/* malformed historical event */}
 return {...rest,details,resourceExists:Boolean(row.resourceExists)};
}
/** UI-facing newest-first activity; the existing MCP incremental changes endpoint stays ascending. */
export async function recentActivity(env:Env,cursor?:number,limit=50,filter:ActivityFilter={}){
 const size=Math.max(1,Math.min(limit,200));
 const query=activityQuery(filter);
 const rows=await env.DB.prepare(query.prefix+` SELECT ${activityColumns} FROM filtered WHERE (? IS NULL OR seq<?) ORDER BY seq DESC LIMIT ?`)
  .bind(...query.values,cursor??null,cursor??null,size+1).all<ActivityRow>();
 const items=rows.results.slice(0,size).map(activityItem);
 const hasMore=rows.results.length>size;
 return {items,page:{hasMore,nextCursor:hasMore?items.at(-1)?.seq??null:null}};
}

export async function activityDetail(env:Env,seq:number){
 const query=activityQuery();
 const row=await env.DB.prepare(query.prefix+` SELECT ${activityColumns} FROM filtered WHERE seq=?`).bind(...query.values,seq).first<ActivityRow>();
 if(!row)throw new StorageError('ACTIVITY_NOT_FOUND');
 const item=activityItem(row);
 const record=item.entityType==='record'?await env.DB.prepare('SELECT folder_id AS folderId,name FROM records WHERE id=?').bind(item.entityId).first<{folderId:string|null;name:string}>():null;
 const path=record?await recordExtras(env,record.folderId,item.entityId):null;
 return {item,path:record&&path?path.path+(record.folderId?'/':'')+record.name:null};
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
