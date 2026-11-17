import {StorageError} from './types.js';

export type ActivityCategory='document'|'task'|'organization';
export type ActivityFilter={from?:string;to?:string;timeZone?:string;actor?:string;categories?:ActivityCategory[];query?:string;folderId?:string};
export type ActivityDay={day:string;start:string;end:string};
const isoDay=/^\d{4}-\d{2}-\d{2}$/;
export function activityDays(from:string,to:string,timeZone='UTC'):ActivityDay[]{
 const valid=(day:string)=>isoDay.test(day)&&!Number.isNaN(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day;
 if(!valid(from)||!valid(to)||from>to)throw new StorageError('INVALID_ARGUMENT','Invalid activity date range');
 let formatter:Intl.DateTimeFormat;
 try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}
 catch{throw new StorageError('INVALID_ARGUMENT','Invalid activity time zone');}
 const start=Date.parse(from),end=Date.parse(to);
 if(end-start>365*86400000)throw new StorageError('INVALID_ARGUMENT','Activity range must not exceed 366 days');
 const midnight=(target:number)=>{
  let result=target;
  for(let i=0;i<4;i++){
   const parts=Object.fromEntries(formatter.formatToParts(new Date(result)).map(part=>[part.type,part.value]));
   const local=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
   const delta=target-local;if(delta===0)return new Date(result).toISOString();result+=delta;
  }
  // Some zones skip midnight entirely. Pick the first instant of that civil
  // date rather than oscillating between the preceding day and 01:00.
  const targetDay=new Date(target).toISOString().slice(0,10);
  let low=target-36*3600000,high=target+36*3600000;
  while(high-low>1){
   const middle=Math.floor((low+high)/2),parts=Object.fromEntries(formatter.formatToParts(new Date(middle)).map(part=>[part.type,part.value]));
   const day=parts.year+'-'+parts.month+'-'+parts.day;
   if(day<targetDay)low=middle;else high=middle;
  }
  return new Date(high).toISOString();
 };
 const result:ActivityDay[]=[];
 let boundary=midnight(start);
 for(let value=start;value<=end;value+=86400000){const next=midnight(value+86400000);result.push({day:new Date(value).toISOString().slice(0,10),start:boundary,end:next});boundary=next;}
 return result;
}

/** One normalized source and predicate are shared by the feed and all aggregations. */
export function activityQuery(filter:ActivityFilter={},ignoreActor=false){
 const values:(string|number)[]=[],conditions:string[]=[];
 if(Boolean(filter.from)!==Boolean(filter.to))throw new StorageError('INVALID_ARGUMENT','Both activity dates are required');
 const days=filter.from&&filter.to?activityDays(filter.from,filter.to,filter.timeZone):[];
 if(days.length){conditions.push('createdAt>=? AND createdAt<?');values.push(days[0]!.start,days.at(-1)!.end);}
 if(filter.actor&&filter.actor!=='all'&&!ignoreActor){
  if(['user','agent','system','unknown'].includes(filter.actor)){conditions.push('actorKind=?');values.push(filter.actor);}
  else{conditions.push('actorKey=?');values.push(filter.actor);}
 }
 if(filter.categories){
  if(!filter.categories.length)conditions.push('0');
  else{conditions.push('category IN ('+filter.categories.map(()=>'?').join(',')+')');values.push(...filter.categories);}
 }
 if(filter.query){conditions.push('(instr(lower(resourceName),lower(?))>0 OR instr(lower(actorName),lower(?))>0 OR instr(lower(detailsJson),lower(?))>0)');values.push(filter.query,filter.query,filter.query);}
 if(filter.folderId){conditions.push('(folderId IN (SELECT id FROM descendants) OR (entityType=\'folder\' AND entityId IN (SELECT id FROM descendants)))');}
 const prefix=`WITH RECURSIVE descendants(id) AS (
  SELECT id FROM folders WHERE id=? UNION ALL SELECT f.id FROM folders f JOIN descendants d ON f.parent_id=d.id
 ), source AS (
 SELECT e.seq,e.revision,e.actor,e.created_at AS createdAt,e.record_id AS recordId,e.event_type AS operation,
 COALESCE(e.entity_type,CASE WHEN e.record_id IS NOT NULL THEN 'record' ELSE 'unknown' END) AS entityType,
 COALESCE(e.entity_id,e.record_id,'') AS entityId,
 CASE WHEN json_valid(e.details_json) THEN e.details_json ELSE '{}' END AS detailsJson,
 r.name AS recordName,COALESCE(r.kind,json_extract(CASE WHEN json_valid(e.details_json) THEN e.details_json ELSE '{}' END,'$.kind')) AS recordKind,
 CASE WHEN r.id IS NOT NULL THEN r.folder_id ELSE json_extract(CASE WHEN json_valid(e.details_json) THEN e.details_json ELSE '{}' END,'$.folderId') END AS folderId,f.name AS folderName,a.client_name AS clientName,
 CASE WHEN e.actor LIKE 'web:owner:%' THEN 'user' WHEN e.actor LIKE 'grant:%' THEN 'agent' WHEN e.actor LIKE 'system:%' THEN 'system' ELSE 'unknown' END AS actorKind,
 CASE WHEN e.entity_type='folder' THEN f.id IS NOT NULL WHEN e.entity_type='tag' THEN t.id IS NOT NULL ELSE r.id IS NOT NULL END AS resourceExists
 FROM change_events e
 LEFT JOIN records r ON (e.entity_type='record' OR (e.entity_type IS NULL AND e.record_id IS NOT NULL)) AND r.id=COALESCE(e.entity_id,e.record_id)
 LEFT JOIN folders f ON e.entity_type='folder' AND f.id=e.entity_id
 LEFT JOIN tags t ON e.entity_type='tag' AND t.id=e.entity_id
 LEFT JOIN oauth_actor_names a ON e.actor=('grant:'||a.actor_id)
 ), normalized AS (
 SELECT *,COALESCE(recordName,folderName,json_extract(detailsJson,'$.name'),json_extract(detailsJson,'$.title'),'已移除的资源') AS resourceName,
 CASE WHEN actorKind='user' THEN '本人（Web）' WHEN actorKind='agent' THEN COALESCE(NULLIF(trim(clientName),''),'未识别 Agent') WHEN actor='system:migration' THEN '系统迁移' WHEN actorKind='system' THEN '系统' ELSE '未识别的历史操作方' END AS actorName,
 CASE WHEN actorKind='agent' AND NULLIF(trim(clientName),'') IS NOT NULL THEN 'client:'||trim(clientName) ELSE actor END AS actorKey,
 CASE WHEN json_extract(detailsJson,'$.taskActivity.version')=1 OR recordKind='task_list' OR json_extract(detailsJson,'$.kind')='task_list' OR operation LIKE 'task_%' THEN 'task'
 WHEN entityType IN ('folder','tag') OR operation IN ('metadata','folder_update','tag_add','tag_remove','tag_auto_update','tag_accept_all','tag_restore_suggestion','link_add','link_remove','link_restore','kind_migrate') THEN 'organization' ELSE 'document' END AS category
 FROM source
 ), filtered AS (SELECT * FROM normalized ${conditions.length?'WHERE '+conditions.join(' AND '):''})`;
 return {prefix,values:[filter.folderId??'',...values],days};
}

export const operationIdentity="COALESCE(json_extract(detailsJson,'$.requestId'),'event:'||seq)";
