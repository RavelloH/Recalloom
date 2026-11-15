import type {Env,Task,TaskStatus,TaskCounts,TaskListSummary,TaskViewItem} from '../types.js';
import {StorageError} from '../types.js';
import {newId,bounded} from './internal.js';
import {getRecord,commitContent} from './records.js';

export async function taskOperation(env:Env,recordId:string,expectedRevision:number,action:'add'|'update'|'remove'|'reorder',taskId:string|undefined,changes:Partial<Task>,actor='agent',placement?:{beforeTaskId:string|null}) {
  const row=await getRecord(env,recordId);
  if(row.kind!=='task_list')throw new StorageError('NOT_A_TASK_LIST');
  if(row.revision!==expectedRevision)throw new StorageError('VERSION_CONFLICT','Latest revision is '+row.revision);
  let parsed: {tasks:Task[];taskOrder?:'manual';[key:string]:unknown};
  try { parsed=JSON.parse(row.content); if(!Array.isArray(parsed.tasks))throw Error(); }
  catch {throw new StorageError('INVALID_TASK_DOCUMENT');}
  const tasks=parsed.tasks;
  const validStates:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];
  if(action==='reorder'&&!placement)throw new StorageError('INVALID_TASK_ORDER');
  if(action!=='reorder'&&placement)throw new StorageError('INVALID_TASK_ORDER');
  const fields:Partial<Task>={};
  for(const key of ['title','details','status','priority'] as const)if(changes[key]!==undefined)Object.assign(fields,{[key]:changes[key]});
  if(fields.title!==undefined){
    if(typeof fields.title!=='string'||fields.title.trim().length>500)throw new StorageError('INVALID_TASK');
    fields.title=fields.title.trim();
  }
  if(fields.details!==undefined&&(typeof fields.details!=='string'||fields.details.length>50000))throw new StorageError('INVALID_TASK');
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
  if(action==='reorder'){
    if(placement!.beforeTaskId===taskId)throw new StorageError('INVALID_TASK_ORDER','A task cannot be placed before itself');
    if(placement!.beforeTaskId!==null&&!tasks.some(t=>t.id===placement!.beforeTaskId))throw new StorageError('INVALID_TASK_ORDER','Anchor must belong to the same task list');
    // Freeze the old priority order once; subsequent moves use the canonical array.
    if(parsed.taskOrder!=='manual')tasks.sort((a,b)=>b.priority-a.priority);
    const index=tasks.findIndex(t=>t.id===taskId);
    const [moved]=tasks.splice(index,1);
    const destination=placement!.beforeTaskId===null?tasks.length:tasks.findIndex(t=>t.id===placement!.beforeTaskId);
    tasks.splice(destination,0,moved!);
    parsed.taskOrder='manual';
  }
  const content=JSON.stringify({...parsed,tasks},null,2);
  const affected=action==='add'?tasks.at(-1):action==='remove'?undefined:tasks.find(t=>t.id===taskId);
  const message='Task '+action+': '+(affected?.title??taskId??'task')+' ['+(affected?.id??taskId??'new')+']';
  const result=await commitContent(env,row,content,expectedRevision,message,actor,tasks,{action,taskId:affected?.id??taskId,title:affected?.title,changes:fields,...(placement??{})});
  return {...result,tasks};
}

type TaskCursor={recordId?:string;status?:TaskStatus;updatedAt:string;id:string};

export async function getTasks(env:Env,recordId?:string,status?:TaskStatus,limit=100,cursor?:string){
  const size=bounded(limit,200);
  let next:TaskCursor|undefined;
  if(cursor){
    try{
      next=JSON.parse(cursor) as TaskCursor;
      if(next.recordId!==recordId||next.status!==status||typeof next.updatedAt!=='string'||typeof next.id!=='string')throw Error();
    }catch{throw new StorageError('INVALID_CURSOR');}
  }
  const clauses=["r.status!='archived'"];
  const bind:(string|number)[]=[];
  if(recordId){clauses.push('t.record_id=?');bind.push(recordId);}
  if(status){clauses.push('t.status=?');bind.push(status);}
  if(next){clauses.push('(t.updated_at<? OR (t.updated_at=? AND t.id>?))');bind.push(next.updatedAt,next.updatedAt,next.id);}
  const rows=(await env.DB.prepare('SELECT t.id,t.record_id AS recordId,t.title,t.details,t.status,t.priority,t.position,t.updated_at AS updatedAt FROM tasks t JOIN records r ON r.id=t.record_id WHERE '+clauses.join(' AND ')+' ORDER BY t.updated_at DESC,t.id LIMIT ?')
    .bind(...bind,size+1).all()).results as Array<Record<string,unknown>>;
  const items=rows.slice(0,size);
  const hasMore=rows.length>size;
  const last=items.at(-1);
  return {items,page:{hasMore,nextCursor:hasMore?JSON.stringify({recordId,status,updatedAt:last?.updatedAt,id:last?.id}):null}};
}

export interface TaskViewOptions {
  recordId?:string;
  /** Include the selected folder and all descendants. Omit for the whole library. */
  folderId?:string;
  query?:string;
  statuses?:TaskStatus[];
  limit?:number;
  cursor?:string;
}
const states:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];
type Row=Record<string,unknown>;
const countSelect=states.map(s=>`SUM(CASE WHEN status='${s}' THEN 1 ELSE 0 END) AS ${s}`).join(',');
const listSelect=`r.id AS listId,r.name AS listName,r.folder_id AS folderId,r.status AS listStatus,c.revision,
 COALESCE(fp.path,'')||'/'||r.name AS path,
 CASE WHEN json_extract(c.content,'$.taskOrder')='manual' THEN 'manual' ELSE 'priority' END AS taskOrder,
 ${states.map(s=>`COALESCE(tc.${s},0) AS ${s}Count`).join(',')}`;
const listJoins=`JOIN records r ON r.id=t.record_id JOIN record_contents c ON c.record_id=r.id
 LEFT JOIN folder_paths fp ON fp.id=r.folder_id LEFT JOIN task_counts tc ON tc.record_id=r.id`;
const orderPriority=`CASE WHEN json_extract(c.content,'$.taskOrder')='manual' THEN 0 ELSE -t.priority END`;

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
    recordId:String(row.recordId),position:Number(row.position),updatedAt:String(row.updatedAt),list:summary(row)};
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
  if(!selected.length||options.statuses?.some(s=>!states.includes(s)))throw new StorageError('INVALID_TASK_STATUS');
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
  return {cte,where:clauses.join(' AND '),bindings,cteBindings,selected,query,
    key:JSON.stringify({recordId:options.recordId??null,folderId:options.folderId??null,query,statuses:selected})};
}
function readCursor(value:string|undefined,kind:'lists'|'view',key:string):Row|undefined {
  if(value===undefined)return;
  try {
    const parsed=JSON.parse(value) as Row;
    if(parsed.v!==1||parsed.kind!==kind||parsed.key!==key||typeof parsed.id!=='string')throw Error();
    if(kind==='view'&&(typeof parsed.recordId!=='string'||typeof parsed.priority!=='number'||!Number.isInteger(parsed.priority)||typeof parsed.position!=='number'||!Number.isInteger(parsed.position)))throw Error();
    return parsed;
  }catch{throw new StorageError('INVALID_CURSOR');}
}

/** List metadata and complete query-matching counts, including empty lists. */
export async function getTaskLists(env:Env,options:TaskViewOptions={}) {
  const scope=await viewScope(env,options),size=bounded(options.limit??40,200);
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
  return {items,counts:counts((results[1]!.results as Row[])[0]??{}),page:{hasMore,nextCursor:hasMore?JSON.stringify({v:1,kind:'lists',key,id:items.at(-1)!.id}):null}};
}

/** Independent keyset pages for a board column or a filtered list. */
export async function getTaskView(env:Env,options:TaskViewOptions={}) {
  const scope=await viewScope(env,options),size=bounded(options.limit??40,200);
  const cursor=readCursor(options.cursor,'view',scope.key);
  const clauses=[scope.where,`t.status IN (${scope.selected.map(()=>'?').join(',')})`];
  const bindings:(string|number)[]=[...scope.cteBindings,...scope.bindings,...scope.selected];
  if(cursor){
    clauses.push(`(r.id,${orderPriority},t.position,t.id)>(?,?,?,?)`);
    bindings.push(String(cursor.recordId),Number(cursor.priority),Number(cursor.position),String(cursor.id));
  }
  const rows=(await env.DB.prepare(scope.cte+`SELECT t.id,t.record_id AS recordId,t.title,t.details,t.status,t.priority,t.position,t.updated_at AS updatedAt,
    ${listSelect},${orderPriority} AS orderPriority FROM matching_tasks t ${listJoins}
    WHERE ${clauses.join(' AND ')} ORDER BY r.id,orderPriority,t.position,t.id LIMIT ?`).bind(...bindings,size+1).all()).results as Row[];
  const items=rows.slice(0,size).map(viewItem),hasMore=rows.length>size,last=rows[Math.min(size,rows.length)-1];
  return {items,page:{hasMore,nextCursor:hasMore?JSON.stringify({v:1,kind:'view',key:scope.key,recordId:last!.recordId,priority:last!.orderPriority,position:last!.position,id:last!.id}):null}};
}

/** Exact lookup does not depend on the first loaded page or current filters. */
export async function getTaskItem(env:Env,taskId:string) {
  const owner=await env.DB.prepare('SELECT record_id AS recordId FROM tasks WHERE id=?').bind(taskId).first<{recordId:string}>();
  if(!owner)throw new StorageError('TASK_NOT_FOUND');
  const scope=await viewScope(env,{recordId:owner.recordId});
  const row=await env.DB.prepare(scope.cte+`SELECT t.id,t.record_id AS recordId,t.title,t.details,t.status,t.priority,t.position,t.updated_at AS updatedAt,
    ${listSelect} FROM matching_tasks t ${listJoins} WHERE ${scope.where} AND t.id=?`).bind(...scope.cteBindings,...scope.bindings,taskId).first<Row>();
  if(!row)throw new StorageError('TASK_NOT_FOUND');
  return {item:viewItem(row)};
}
