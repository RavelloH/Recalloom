import type {Env} from './types.js';
import {activityQuery,operationIdentity,type ActivityFilter} from './activity-query.js';

export async function activitySummary(env:Env,filter:ActivityFilter){
 const query=activityQuery(filter),catalog=activityQuery(filter,true);
 const [totals,daily,actors,coverage]=await Promise.all([
  env.DB.prepare(query.prefix+` SELECT COUNT(DISTINCT ${operationIdentity}) AS changes,COUNT(DISTINCT CASE WHEN entityType='record' THEN entityId END) AS resources,
   COALESCE(SUM(CAST(json_extract(detailsJson,'$.taskActivity.completed') AS INTEGER)),0) AS completed,
   COALESCE(SUM(CASE WHEN category='task' AND operation='update' AND COALESCE(json_extract(detailsJson,'$.taskActivity.version'),0)!=1 AND COALESCE(json_extract(detailsJson,'$.action'),'') NOT IN ('reorder','board_reorder','place_tasks') THEN 1 ELSE 0 END),0) AS incompleteTaskEvents
   FROM filtered`).bind(...query.values).first<{changes:number;resources:number;completed:number;incompleteTaskEvents:number}>(),
  env.DB.prepare(query.prefix+`, days AS (SELECT json_extract(value,'$.day') AS day,json_extract(value,'$.start') AS start,json_extract(value,'$.end') AS end FROM json_each(?))
   SELECT days.day,f.actorKind,
    CASE WHEN f.actorKind='agent' THEN CASE WHEN f.actorKey LIKE 'client:%' THEN f.actorKey ELSE 'agent:unidentified' END ELSE '' END AS agentKey,
    CASE WHEN f.actorKind='agent' THEN f.actorName ELSE '' END AS agentName,
    COUNT(DISTINCT ${operationIdentity}) AS count FROM days JOIN filtered f ON f.createdAt>=days.start AND f.createdAt<days.end GROUP BY days.day,f.actorKind,agentKey,agentName`)
   .bind(...query.values,JSON.stringify(query.days)).all<{day:string;actorKind:'user'|'agent'|'system'|'unknown';agentKey:string;agentName:string;count:number}>(),
  env.DB.prepare(catalog.prefix+` SELECT actorKey,actorName,actorKind,COUNT(*) AS count FROM filtered WHERE actorKind='agent' GROUP BY actorKey,actorName,actorKind ORDER BY count DESC LIMIT 100`)
   .bind(...catalog.values).all<{actorKey:string;actorName:string;actorKind:string;count:number}>(),
  env.DB.prepare('SELECT started_at AS taskTrackingSince FROM activity_coverage WHERE id=1').first<{taskTrackingSince:string}>()
 ]);
 const days=query.days.map(({day})=>({day,user:0,agent:0,system:0,unknown:0,total:0,agents:{} as Record<string,number>}));
 const byDay=new Map(days.map(day=>[day.day,day]));
 const agents=new Map<string,{actorKey:string;actorName:string}>();
 for(const row of daily.results){
  const day=byDay.get(row.day);if(!day)continue;
  const count=Number(row.count);day[row.actorKind]+=count;day.total+=count;
  if(row.actorKind==='agent'){
   day.agents[row.agentKey]=count;agents.set(row.agentKey,{actorKey:row.agentKey,actorName:row.agentName});
  }
 }
 const contributions={user:0,agent:0,system:0,unknown:0};
 for(const day of days)for(const key of Object.keys(contributions) as Array<keyof typeof contributions>)contributions[key]+=day[key];
 return {totals:{activeDays:days.filter(day=>day.total>0).length,changes:Number(totals?.changes??0),resources:Number(totals?.resources??0),completed:Number(totals?.completed??0)},days,contributions,agents:[...agents.values()].sort((a,b)=>a.actorKey.localeCompare(b.actorKey)),actors:actors.results,
  coverage:{taskTrackingSince:coverage?.taskTrackingSince??null,incompleteTaskEvents:Number(totals?.incompleteTaskEvents??0)}};
}

export async function activityFolders(env:Env,cursor?:string){
 const rows=await env.DB.prepare(`WITH RECURSIVE tree(id,name,path) AS (
  SELECT id,name,'/'||name FROM folders WHERE parent_id IS NULL
  UNION ALL SELECT f.id,f.name,tree.path||'/'||f.name FROM folders f JOIN tree ON f.parent_id=tree.id
 ) SELECT * FROM tree WHERE (? IS NULL OR id>?) ORDER BY id LIMIT 201`).bind(cursor??null,cursor??null).all<{id:string;name:string;path:string}>();
 const items=rows.results.slice(0,200);return {items,page:{hasMore:rows.results.length>200,nextCursor:rows.results.length>200?items.at(-1)!.id:null}};
}
