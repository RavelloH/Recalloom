import type {Env,Task,TaskStatus} from '../types.js';
import {StorageError} from '../types.js';
import {newId,bounded} from './internal.js';
import {getRecord,commitContent} from './records.js';

export async function taskOperation(env:Env,recordId:string,expectedRevision:number,action:'add'|'update'|'remove',taskId:string|undefined,changes:Partial<Task>,actor='agent') {
  const row=await getRecord(env,recordId);
  if(row.kind!=='task_list')throw new StorageError('NOT_A_TASK_LIST');
  if(row.revision!==expectedRevision)throw new StorageError('VERSION_CONFLICT','Latest revision is '+row.revision);
  let parsed: {tasks:Task[]};
  try { parsed=JSON.parse(row.content); if(!Array.isArray(parsed.tasks))throw Error(); }
  catch {throw new StorageError('INVALID_TASK_DOCUMENT');}
  const tasks=parsed.tasks;
  const validStates:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];
  if(action==='add'){
    const title=changes.title?.trim();
    if(!title||title.length>500)throw new StorageError('INVALID_TASK');
    tasks.push({id:newId(),title,details:changes.details??'',status:changes.status??'todo',priority:changes.priority??0});
  } else {
    const index=tasks.findIndex(t=>t.id===taskId);
    if(index<0)throw new StorageError('TASK_NOT_FOUND');
    if(action==='remove') tasks.splice(index,1);
    else tasks[index]={...tasks[index]!,...changes,id:tasks[index]!.id};
  }
  if(tasks.some(t=>!t.title.trim()||!validStates.includes(t.status)||!Number.isInteger(t.priority)))throw new StorageError('INVALID_TASK');
  const content=JSON.stringify({tasks},null,2);
  const affected=action==='add'?tasks.at(-1):action==='remove'?undefined:tasks.find(t=>t.id===taskId);
  const message='Task '+action+': '+(affected?.title??taskId??'task')+' ['+(affected?.id??taskId??'new')+']';
  const result=await commitContent(env,row,content,expectedRevision,message,actor,tasks,{action,taskId:affected?.id??taskId,title:affected?.title,changes});
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
