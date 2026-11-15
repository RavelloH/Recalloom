import type {Env,Task,TaskStatus,TaskCounts,TaskListSummary,TaskViewItem} from '../types.js';
import {StorageError} from '../types.js';
import {newId,bounded} from './internal.js';
import {getRecord,commitContent} from './records.js';
import {applyRankOnly,boardRankPlan,getTaskOrderVersion,isTaskOrderGuardError,type TaskAction,type TaskOrderScope} from './task-board.js';

type BoardOrder={taskId:string;position:number;beforeTaskId:string|null;rebalanced?:true};

async function taskOrderConflict(env:Env,recordId:string,expectedRevision:number,error:unknown):Promise<never>{
 const [latest,orderVersion]=await Promise.all([getRecord(env,recordId),getTaskOrderVersion(env)]);
 if(latest.revision!==expectedRevision)throw new StorageError('VERSION_CONFLICT','Latest revision is '+latest.revision);
 if(!isTaskOrderGuardError(error))throw error;
 throw new StorageError('ORDER_VERSION_CONFLICT','Latest order version is '+orderVersion,{applied:false,latestRevisions:{[recordId]:latest.revision},orderVersion});
}

export async function taskOperation(env:Env,recordId:string,expectedRevision:number,action:TaskAction,taskId:string|undefined,changes:Partial<Task>,actor='agent',placement?:{beforeTaskId:string|null}) {
  const row=await getRecord(env,recordId);
  if(row.kind!=='task_list')throw new StorageError('NOT_A_TASK_LIST');
  if(row.revision!==expectedRevision)throw new StorageError('VERSION_CONFLICT','Latest revision is '+row.revision);
  let parsed: {tasks:Task[];taskOrder?:'manual';[key:string]:unknown};
  try { parsed=JSON.parse(row.content); if(!Array.isArray(parsed.tasks))throw Error(); }
  catch {throw new StorageError('INVALID_TASK_DOCUMENT');}
  const tasks=parsed.tasks;
  const validStates:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];
  const ordered=action==='reorder'||action==='board_reorder';
  if(ordered&&!placement)throw new StorageError('INVALID_TASK_ORDER');
  if(!ordered&&placement)throw new StorageError('INVALID_TASK_ORDER');
  const fields:Partial<Task>={};
  for(const key of ['title','details','status','priority'] as const)if(changes[key]!==undefined)Object.assign(fields,{[key]:changes[key]});
  if(fields.title!==undefined){
    if(typeof fields.title!=='string'||fields.title.trim().length>500)throw new StorageError('INVALID_TASK');
    fields.title=fields.title.trim();
  }
  if(fields.details!==undefined&&(typeof fields.details!=='string'||fields.details.length>50000))throw new StorageError('INVALID_TASK');
  if(ordered){
    if(!taskId)throw new StorageError('TASK_NOT_FOUND');
    if(action==='board_reorder'&&(!fields.status||Object.keys(fields).some(key=>key!=='status')))
      throw new StorageError('INVALID_TASK_ORDER','Board reorder only accepts changes.status');
    if(fields.status&&!validStates.includes(fields.status))throw new StorageError('INVALID_TASK');
    const index=tasks.findIndex(task=>task.id===taskId);
    if(index<0)throw new StorageError('TASK_NOT_FOUND');
    if(row.status==='archived')throw new StorageError('INVALID_TASK_ORDER','Archived tasks are not in the active order');
    const targetStatus=fields.status??tasks[index]!.status,beforeTaskId=placement!.beforeTaskId;
    const scope:TaskOrderScope=action==='reorder'?{recordId}:{status:targetStatus};
    const plan=await boardRankPlan(env,recordId,taskId,beforeTaskId,scope);
    const updated={...tasks[index]!,...fields,id:taskId};
    if(typeof updated.title!=='string'||!updated.title.trim()||typeof updated.details!=='string'||!validStates.includes(updated.status)||!Number.isInteger(updated.priority))
      throw new StorageError('INVALID_TASK');
    tasks[index]=updated;
    const content=JSON.stringify({...parsed,tasks},null,2);
    if(content===row.content){
      try{return await applyRankOnly(env,row,tasks,taskId,plan,beforeTaskId,actor,action);}
      catch(error){return taskOrderConflict(env,recordId,expectedRevision,error);}
    }
    try{
      const result=await commitContent(env,row,content,expectedRevision,'Task '+action+': '+updated.title+' ['+taskId+']',actor,tasks,
        {action,taskId,title:updated.title,changes:fields,beforeTaskId,orderVersion:plan.orderVersion},plan.statements,true);
      return {...result,tasks,orderVersion:plan.orderVersion,
        boardOrder:{taskId,position:plan.position,beforeTaskId,...(plan.rebalanced?{rebalanced:true as const}:{})}};
    }catch(error){return taskOrderConflict(env,recordId,expectedRevision,error);}
  }
  if(action==='add'){
    const title=fields.title;
    if(!title||title.length>500)throw new StorageError('INVALID_TASK');
    tasks.push({id:newId(),title,details:fields.details??'',status:fields.status??'todo',priority:fields.priority??0});
  } else {
    const index=tasks.findIndex(t=>t.id===taskId);
    if(index<0)throw new StorageError('TASK_NOT_FOUND');
    if(action==='remove') tasks.splice(index,1);
    else tasks[index]={...tasks[index]!,...fields,id:tasks[index]!.id};
  }
  if(tasks.some(t=>typeof t.title!=='string'||!t.title.trim()||typeof t.details!=='string'||!validStates.includes(t.status)||!Number.isInteger(t.priority)))throw new StorageError('INVALID_TASK');
  const content=JSON.stringify({...parsed,tasks},null,2);
  const affected=action==='add'?tasks.at(-1):action==='remove'?undefined:tasks.find(t=>t.id===taskId);
  const message='Task '+action+': '+(affected?.title??taskId??'task')+' ['+(affected?.id??taskId??'new')+']';
  const result=await commitContent(env,row,content,expectedRevision,message,actor,tasks,{action,taskId:affected?.id??taskId,title:affected?.title,changes:fields});
  const orderVersion=result.orderVersion??await getTaskOrderVersion(env);
  if(!affected)return {...result,tasks,orderVersion};
  const rank=await env.DB.prepare('SELECT position FROM task_board_order WHERE task_id=?').bind(affected.id).first<{position:number}>();
  const boardOrder:BoardOrder|undefined=rank?{taskId:affected.id,position:Number(rank.position),beforeTaskId:null}:undefined;
  return {...result,tasks,orderVersion,...(boardOrder?{boardOrder}:{})};
}

export async function getTasks(env:Env,recordId?:string,status?:TaskStatus,limit=100,cursor?:string){
  const result=await queryTasks(env,{recordId,statuses:status?[status]:undefined,limit,cursor,order:'manual'});
  return {...result,items:result.items.map(({list,boardPosition,...item})=>({...item,boardPosition}))};
}

export interface TaskQueryOptions {
  recordId?:string;
  /** Include the selected folder and all descendants. Omit for the whole library. */
  folderId?:string;
  query?:string;
  statuses?:TaskStatus[];
  limit?:number;
  cursor?:string;
  order?:'manual'|'updated';
}
export interface TaskViewOptions extends Omit<TaskQueryOptions,'order'>{order?:TaskQueryOptions['order']|'canonical'|'board'}
const states:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];
type Row=Record<string,unknown>;
const countSelect=states.map(s=>`SUM(CASE WHEN status='${s}' THEN 1 ELSE 0 END) AS ${s}`).join(',');
const listSelect=`r.id AS listId,r.name AS listName,r.folder_id AS folderId,r.status AS listStatus,c.revision,
 COALESCE(fp.path,'')||'/'||r.name AS path,
 'manual' AS taskOrder,
 ${states.map(s=>`COALESCE(tc.${s},0) AS ${s}Count`).join(',')}`;
const listJoins=`JOIN records r ON r.id=t.record_id JOIN record_contents c ON c.record_id=r.id
 JOIN task_board_order bo ON bo.task_id=t.id
 LEFT JOIN folder_paths fp ON fp.id=r.folder_id LEFT JOIN task_counts tc ON tc.record_id=r.id`;

function counts(row:Row):TaskCounts {
  return Object.fromEntries(states.map(s=>[s,Number(row[s+'Count']??0)])) as TaskCounts;
}
function summary(row:Row):TaskListSummary {
  const values=counts(row);
  return {id:String(row.listId),name:String(row.listName),path:String(row.path),folderId:row.folderId as string|null,
    status:row.listStatus as TaskListSummary['status'],revision:Number(row.revision),order:row.taskOrder as TaskListSummary['order'],
    counts:values,total:Object.values(values).reduce((a,b)=>a+b,0)};
}
function viewItem(row:Row):TaskViewItem {
  return {id:String(row.id),title:String(row.title),details:String(row.details),status:row.status as TaskStatus,priority:Number(row.priority),
    recordId:String(row.recordId),position:Number(row.position),boardPosition:Number(row.boardPosition),updatedAt:String(row.updatedAt),list:summary(row)};
}
async function viewScope(env:Env,options:TaskViewOptions){
  if(options.recordId&&options.folderId)throw new StorageError('INVALID_TASK_SCOPE');
  if(options.recordId){
    const record=await env.DB.prepare('SELECT kind FROM records WHERE id=?').bind(options.recordId).first<{kind:string}>();
    if(!record)throw new StorageError('RECORD_NOT_FOUND');
    if(record.kind!=='task_list')throw new StorageError('NOT_A_TASK_LIST');
  }
  if(options.folderId&&!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(options.folderId).first()))throw new StorageError('FOLDER_NOT_FOUND');
  const query=options.query?.trim()??'';
  if(query.length>200)throw new StorageError('INVALID_TASK_QUERY');
  const selected=options.statuses===undefined?states:states.filter(s=>options.statuses!.includes(s));
  if(options.statuses?.some(s=>!states.includes(s)))throw new StorageError('INVALID_TASK_STATUS');
  const clauses=["r.kind='task_list'","r.status!='archived'"];
  const bindings:(string|number)[]=[];
  if(options.recordId){clauses.push('r.id=?');bindings.push(options.recordId);}
  if(options.folderId){
    clauses.push('r.folder_id IN (WITH RECURSIVE scope(id) AS (SELECT id FROM folders WHERE id=? UNION ALL SELECT f.id FROM folders f JOIN scope s ON f.parent_id=s.id) SELECT id FROM scope)');
    bindings.push(options.folderId);
  }
  const cteBindings=[...bindings,...(query?[query,query]:[])];
  const cte=`WITH RECURSIVE folder_paths(id,path) AS (
    SELECT id,'/'||name FROM folders WHERE parent_id IS NULL
    UNION ALL SELECT f.id,p.path||'/'||f.name FROM folders f JOIN folder_paths p ON f.parent_id=p.id
  ), matching_tasks AS (SELECT t.* FROM tasks t JOIN records r ON r.id=t.record_id WHERE ${clauses.join(' AND ')}
    ${query?'AND (instr(lower(t.title),lower(?))>0 OR instr(lower(t.details),lower(?))>0)':''}),
  task_counts AS (SELECT record_id,${countSelect} FROM matching_tasks GROUP BY record_id) `;
  const order=options.order==='updated'?'updated':'manual';
  return {cte,where:clauses.join(' AND '),bindings,cteBindings,selected,query,order,
    key:JSON.stringify({recordId:options.recordId??null,folderId:options.folderId??null,query,statuses:selected,order})};
}
function readCursor(value:string|undefined,kind:'lists'|'view',key:string):Row|undefined {
  if(value===undefined)return;
  try {
    const parsed=JSON.parse(value) as Row;
    if(parsed.v!==1||parsed.kind!==kind||parsed.key!==key||typeof parsed.id!=='string')throw Error();
    if(kind==='view'&&(typeof parsed.boardPosition!=='number'||!Number.isFinite(parsed.boardPosition)))throw Error();
    if(kind==='view'&&parsed.order==='updated'&&typeof parsed.updatedAt!=='string')throw Error();
    return parsed;
  }catch(error){if(error instanceof StorageError)throw error;throw new StorageError('INVALID_CURSOR');}
}

/** List metadata and complete query-matching counts, including empty lists. */
export async function getTaskLists(env:Env,options:TaskViewOptions={}) {
  const [scope,orderVersion]=await Promise.all([viewScope(env,options),getTaskOrderVersion(env)]),size=bounded(options.limit??40,200);
  // Status selection filters task rows, never the list metadata or its counts.
  const key=JSON.stringify({recordId:options.recordId??null,folderId:options.folderId??null,query:scope.query});
  const cursor=readCursor(options.cursor,'lists',key);
  const statements=[
    env.DB.prepare(scope.cte+`SELECT ${listSelect} FROM records r JOIN record_contents c ON c.record_id=r.id
      LEFT JOIN folder_paths fp ON fp.id=r.folder_id LEFT JOIN task_counts tc ON tc.record_id=r.id
      WHERE ${scope.where}${scope.query?' AND tc.record_id IS NOT NULL':''}${cursor?' AND r.id>?':''} ORDER BY r.id LIMIT ?`)
      .bind(...scope.cteBindings,...scope.bindings,...(cursor?[String(cursor.id)]:[]),size+1),
    env.DB.prepare(scope.cte+`SELECT ${states.map(s=>`COALESCE(SUM(tc.${s}),0) AS ${s}Count`).join(',')} FROM records r
      LEFT JOIN task_counts tc ON tc.record_id=r.id WHERE ${scope.where}`).bind(...scope.cteBindings,...scope.bindings)
  ];
  const results=await env.DB.batch(statements);
  const rows=results[0]!.results as Row[],items=rows.slice(0,size).map(summary),hasMore=rows.length>size;
  return {items,counts:counts((results[1]!.results as Row[])[0]??{}),orderVersion,page:{hasMore,nextCursor:hasMore?JSON.stringify({v:1,kind:'lists',key,id:items.at(-1)!.id}):null}};
}

/** Independent keyset pages for a board column or a filtered list. */
export async function getTaskView(env:Env,options:TaskViewOptions={}) {
  const scope=await viewScope(env,options),size=bounded(options.limit??40,200);
  const cursor=readCursor(options.cursor,'view',scope.key);
  if(cursor&&(cursor.order!==scope.order||scope.order==='updated'&&typeof cursor.updatedAt!=='string'))throw new StorageError('INVALID_CURSOR');
  const clauses=[scope.where,scope.selected.length?`t.status IN (${scope.selected.map(()=>'?').join(',')})`:'0'];
  const bindings:(string|number)[]=[...scope.cteBindings,...scope.bindings,...scope.selected];
  if(cursor){
    if(scope.order==='manual'){
      clauses.push('(bo.position,t.id)>(?,?)');
      bindings.push(Number(cursor.boardPosition),String(cursor.id));
    }else{
      clauses.push('(t.updated_at<? OR (t.updated_at=? AND t.id>?))');
      bindings.push(String(cursor.updatedAt),String(cursor.updatedAt),String(cursor.id));
    }
  }
  const results=await env.DB.batch([env.DB.prepare(scope.cte+`SELECT t.id,t.record_id AS recordId,t.title,t.details,t.status,t.priority,t.position,t.updated_at AS updatedAt,
    bo.position AS boardPosition,${listSelect} FROM matching_tasks t ${listJoins}
    WHERE ${clauses.join(' AND ')} ORDER BY ${scope.order==='manual'?'bo.position,t.id':'t.updated_at DESC,t.id'} LIMIT ?`).bind(...bindings,size+1),
    env.DB.prepare('SELECT version FROM task_order_state WHERE id=1'),
    env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS changeSeq FROM change_events')]);
  const rows=results[0]!.results as Row[];
  const orderVersion=Number((results[1]!.results as Row[])[0]?.version),changeSeq=Number((results[2]!.results as Row[])[0]?.changeSeq??0);
  if(!Number.isSafeInteger(orderVersion))throw new StorageError('TASK_ORDER_STATE_MISSING');
  if(cursor&&(cursor.orderVersion!==orderVersion||cursor.changeSeq!==changeSeq))
    throw new StorageError('ORDER_VERSION_CONFLICT','Task query changed during pagination',{applied:false,orderVersion,changeSeq});
  const items=rows.slice(0,size).map(viewItem),hasMore=rows.length>size,last=rows[Math.min(size,rows.length)-1];
  return {items,orderVersion,page:{hasMore,nextCursor:hasMore?JSON.stringify(scope.order==='manual'
    ?{v:1,kind:'view',key:scope.key,order:'manual',orderVersion,changeSeq,boardPosition:last!.boardPosition,id:last!.id}
    :{v:1,kind:'view',key:scope.key,order:'updated',orderVersion,changeSeq,boardPosition:last!.boardPosition,updatedAt:last!.updatedAt,id:last!.id}):null}};
}

export function queryTasks(env:Env,options:TaskQueryOptions={}){return getTaskView(env,options);}

/** Exact lookup does not depend on the first loaded page or current filters. */
export async function getTaskItem(env:Env,taskId:string) {
  const result=await readTasks(env,[taskId]);
  if(!result.items[0])throw new StorageError('TASK_NOT_FOUND');
  return {item:result.items[0],orderVersion:result.orderVersion};
}

export async function readTasks(env:Env,ids:string[]){
  if(ids.length>200)throw new StorageError('TASK_READ_LIMIT','At most 200 task ids may be read at once');
  const unique=[...new Set(ids)];
  if(!unique.length)return {items:[] as TaskViewItem[],missingIds:[] as string[],orderVersion:await getTaskOrderVersion(env)};
  const requested=JSON.stringify(unique);
  const results=await env.DB.batch([env.DB.prepare(`WITH RECURSIVE requested(id,ordinal) AS (
      SELECT value,CAST(key AS INTEGER) FROM json_each(?)
    ),folder_paths(id,path) AS (
      SELECT id,'/'||name FROM folders WHERE parent_id IS NULL
      UNION ALL SELECT f.id,p.path||'/'||f.name FROM folders f JOIN folder_paths p ON f.parent_id=p.id
    ),task_counts AS (SELECT record_id,${countSelect} FROM tasks GROUP BY record_id)
    SELECT t.id,t.record_id AS recordId,t.title,t.details,t.status,t.priority,t.position,t.updated_at AS updatedAt,
      bo.position AS boardPosition,${listSelect},requested.ordinal
    FROM requested JOIN tasks t ON t.id=requested.id ${listJoins}
    WHERE r.kind='task_list' AND r.status!='archived' ORDER BY requested.ordinal`).bind(requested),
    env.DB.prepare('SELECT version FROM task_order_state WHERE id=1')]);
  const items=(results[0]!.results as Row[]).map(viewItem),found=new Set(items.map(item=>item.id));
  const orderVersion=Number((results[1]!.results as Row[])[0]?.version);
  if(!Number.isSafeInteger(orderVersion))throw new StorageError('TASK_ORDER_STATE_MISSING');
  return {items,missingIds:unique.filter(id=>!found.has(id)),orderVersion};
}
