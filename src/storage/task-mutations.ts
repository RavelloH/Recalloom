import type {Env,StoredRecord,Task,TaskCounts,TaskStatus,TaskViewItem} from '../types.js';
import {StorageError} from '../types.js';
import {sha256} from '../version.js';
import {event,newId,now,recordExtras} from './internal.js';
import {getRecord} from './record-core.js';
import {prepareTaskContentCommit} from './record-revisions.js';
import {getTaskOrderVersion,isTaskOrderGuardError,taskOrderVersionStatements,type TaskOrderScope} from './task-board.js';

export type TaskMutation=
 | {op:'create';recordId:string;title:string;details?:string;status?:TaskStatus;clientId?:string}
 | {op:'update';taskId:string;changes:{title?:string;details?:string;status?:TaskStatus}}
 | {op:'delete';taskId:string}
 | {op:'place';taskId:string;beforeTaskId:string|null;scope?:TaskOrderScope}
 | {op:'transfer';taskId:string;targetRecordId:string};

export interface MutateTasksInput {
 requestId:string;
 expectedRevisions:Record<string,number>;
 expectedOrderVersion?:number;
 operations:TaskMutation[];
}

export interface MutateTasksResult {
 items:TaskViewItem[];
 deletedIds:string[];
 revisions:Record<string,number>;
 orderVersion:number;
 created?:Record<string,string>;
}

type RecordState={row:StoredRecord;parsed:{tasks:Task[];[key:string]:unknown};dirty:boolean};
type TaskState=Task&{recordId:string;updatedAt:string;recordStatus:string};
type RankRow={id:string;position:number};
const statuses:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];

function stable(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)]));
 return value;
}

function validTask(task:Task){
 return typeof task.id==='string'&&typeof task.title==='string'&&!!task.title.trim()&&task.title.length<=500&&
  typeof task.details==='string'&&task.details.length<=50000&&statuses.includes(task.status)&&Number.isInteger(task.priority);
}

function scopeMatches(task:TaskState|undefined,scope:TaskOrderScope){
 return !!task&&task.recordStatus!=='archived'&&(!scope.recordId||task.recordId===scope.recordId)&&(!scope.status||task.status===scope.status);
}

function assignPositions(order:string[],movable:Set<string>,current:Map<string,number>){
 const next=new Map(current),updates=new Map<string,number>();
 let rebalanced=false,index=0;
 while(index<order.length){
  if(!movable.has(order[index]!)){index++;continue;}
  const start=index;
  while(index<order.length&&movable.has(order[index]!))index++;
  const count=index-start,left=start>0?next.get(order[start-1]!):undefined,right=index<order.length?next.get(order[index]!):undefined;
  const step=left!==undefined&&right!==undefined?(right-left)/(count+1):1024;
  if(!Number.isFinite(step)||step<=0||left!==undefined&&left+step===left||right!==undefined&&right-step===right){rebalanced=true;break;}
  let previous=left;
  for(let offset=0;offset<count;offset++){
   const position=left!==undefined?left+step*(offset+1):right!==undefined?right-step*(count-offset):1024*(offset+1);
   if(!Number.isFinite(position)||(previous!==undefined&&position<=previous)||(right!==undefined&&position>=right)){rebalanced=true;break;}
   next.set(order[start+offset]!,position);updates.set(order[start+offset]!,position);
   previous=position;
  }
  if(rebalanced)break;
 }
 if(rebalanced){
  updates.clear();
  order.forEach((id,ordinal)=>{const position=(ordinal+1)*1024;next.set(id,position);updates.set(id,position);});
 }
 return {positions:next,updates,rebalanced};
}

async function latestDetails(env:Env,recordIds:string[]){
 const latestRevisions:Record<string,number>={},latestMetadataRevisions:Record<string,number>={},recordStatuses:Record<string,string>={};
 await Promise.all(recordIds.map(async id=>{
  const row=await env.DB.prepare(`SELECT c.revision,r.metadata_revision AS metadataRevision,r.status
    FROM record_contents c JOIN records r ON r.id=c.record_id WHERE c.record_id=?`).bind(id)
   .first<{revision:number;metadataRevision:number;status:string}>();
  if(row){latestRevisions[id]=Number(row.revision);latestMetadataRevisions[id]=Number(row.metadataRevision);recordStatuses[id]=row.status;}
 }));
 return {applied:false,latestRevisions,latestMetadataRevisions,recordStatuses,orderVersion:await getTaskOrderVersion(env)};
}

function isRecordGuardError(error:unknown){
 return error instanceof Error&&(/UNIQUE constraint failed:\s*record_contents\.record_id/i.test(error.message)||/CHECK constraint failed:\s*revision\s*>=\s*1/i.test(error.message));
}

export async function mutateTasks(env:Env,input:MutateTasksInput,actor='agent'):Promise<MutateTasksResult>{
 if(!input.requestId||input.requestId.length>100||!input.operations.length||input.operations.length>50)
  throw new StorageError('INVALID_TASK_MUTATION','Provide a requestId and 1-50 operations',{applied:false});
 const inputSha256=await sha256(JSON.stringify(stable(input)));
 const existing=await env.DB.prepare('SELECT input_sha256 AS inputSha256,result_json AS resultJson FROM task_mutation_requests WHERE request_id=?')
  .bind(input.requestId).first<{inputSha256:string;resultJson:string}>();
 if(existing){
  if(existing.inputSha256!==inputSha256)throw new StorageError('IDEMPOTENCY_CONFLICT','requestId was already used for different input',{applied:false});
  return JSON.parse(existing.resultJson) as MutateTasksResult;
 }

 const snapshot=await env.DB.batch([
  env.DB.prepare('SELECT task_id AS id,position FROM task_board_order ORDER BY position,task_id'),
  env.DB.prepare(`SELECT t.id,t.record_id AS recordId,t.title,t.details,t.status,t.priority,t.updated_at AS updatedAt,r.status AS recordStatus
    FROM tasks t JOIN records r ON r.id=t.record_id`),
  env.DB.prepare('SELECT version FROM task_order_state WHERE id=1')
 ]);
 const rankRows={results:snapshot[0]!.results as RankRow[]},projected={results:snapshot[1]!.results as TaskState[]};
 const baseOrderVersion=Number((snapshot[2]!.results as Array<{version:number}>)[0]?.version);
 if(!Number.isSafeInteger(baseOrderVersion))throw new StorageError('TASK_ORDER_STATE_MISSING');
 if(input.expectedOrderVersion!==undefined&&input.expectedOrderVersion!==baseOrderVersion)
  throw new StorageError('ORDER_VERSION_CONFLICT','Latest order version is '+baseOrderVersion,{applied:false,latestRevisions:{},orderVersion:baseOrderVersion});
 if(input.operations.some(operation=>operation.op==='place')&&input.expectedOrderVersion===undefined)
  throw new StorageError('EXPECTED_ORDER_VERSION_REQUIRED','Placement requires expectedOrderVersion',{applied:false,orderVersion:baseOrderVersion});

 const records=new Map<string,RecordState>(),taskStates=new Map(projected.results.map(task=>[task.id,{...task}]));
 const originalPositions=new Map(rankRows.results.map(row=>[row.id,Number(row.position)]));
 const order=rankRows.results.map(row=>row.id),movable=new Set<string>(),deletedIds:string[]=[],resultIds=new Set<string>();
 const created:Record<string,string>={},transferOwners=new Map<string,string>(),placeRecords=new Set<string>();
 let orderChanged=false;
 const loadRecord=async(recordId:string)=>{
  let state=records.get(recordId);if(state)return state;
  const row=await getRecord(env,recordId);
  if(row.kind!=='task_list')throw new StorageError('NOT_A_TASK_LIST');
  if(row.status==='archived')throw new StorageError('INVALID_TASK_SCOPE','Archived task lists cannot be mutated');
  let parsed:RecordState['parsed'];
  try{parsed=JSON.parse(row.content);if(!Array.isArray(parsed.tasks)||parsed.tasks.some(task=>!validTask(task)))throw Error();}
  catch{throw new StorageError('INVALID_TASK_DOCUMENT');}
  for(const [taskId,task] of taskStates)if(task.recordId===recordId)taskStates.delete(taskId);
  for(const task of parsed.tasks)taskStates.set(task.id,{...task,recordId,updatedAt:row.updated_at,recordStatus:row.status});
  state={row,parsed,dirty:false};records.set(recordId,state);return state;
 };
 const resolveId=(id:string)=>created[id]??id;
 const locate=async(rawId:string)=>{
  const taskId=resolveId(rawId),meta=taskStates.get(taskId);
  if(!meta)throw new StorageError('TASK_NOT_FOUND','Task not found: '+rawId,{applied:false});
  const state=await loadRecord(meta.recordId),fresh=taskStates.get(taskId),index=state.parsed.tasks.findIndex(task=>task.id===taskId);
  if(!fresh||fresh.recordId!==state.row.id||index<0)
   throw new StorageError('VERSION_CONFLICT','Task ownership changed before the batch was prepared',await latestDetails(env,Object.keys(input.expectedRevisions)));
  return {taskId,meta:fresh,state,index,task:state.parsed.tasks[index]!};
 };

 for(const operation of input.operations){
  if(operation.op==='create'){
   const state=await loadRecord(operation.recordId),title=operation.title.trim();
   if(!title||title.length>500||operation.details!==undefined&&operation.details.length>50000||operation.status!==undefined&&!statuses.includes(operation.status))
    throw new StorageError('INVALID_TASK');
   if(operation.clientId&&created[operation.clientId])throw new StorageError('DUPLICATE_CLIENT_ID');
   const id=newId(),task:Task={id,title,details:operation.details??'',status:operation.status??'todo',priority:0};
   state.parsed.tasks.push(task);state.dirty=true;
   taskStates.set(id,{...task,recordId:state.row.id,updatedAt:state.row.updated_at,recordStatus:state.row.status});
   order.push(id);movable.add(id);orderChanged=true;resultIds.add(id);
   if(operation.clientId)created[operation.clientId]=id;
   continue;
  }
  if(operation.op==='update'){
   const found=await locate(operation.taskId),changes=operation.changes;
   if(!Object.keys(changes).length||changes.title!==undefined&&(!changes.title.trim()||changes.title.trim().length>500)||
      changes.details!==undefined&&changes.details.length>50000||changes.status!==undefined&&!statuses.includes(changes.status))throw new StorageError('INVALID_TASK');
   const updated={...found.task,...changes,...(changes.title!==undefined?{title:changes.title.trim()}:{}),id:found.taskId};
   found.state.parsed.tasks[found.index]=updated;found.state.dirty=true;
   taskStates.set(found.taskId,{...found.meta,...updated});resultIds.add(found.taskId);
   if(changes.status!==undefined&&changes.status!==found.task.status)orderChanged=true;
   continue;
  }
  if(operation.op==='delete'){
   const found=await locate(operation.taskId);
   found.state.parsed.tasks.splice(found.index,1);found.state.dirty=true;taskStates.delete(found.taskId);
   const at=order.indexOf(found.taskId);if(at>=0)order.splice(at,1);
   movable.delete(found.taskId);deletedIds.push(found.taskId);resultIds.delete(found.taskId);orderChanged=true;
   continue;
  }
  if(operation.op==='transfer'){
   const found=await locate(operation.taskId),target=await loadRecord(operation.targetRecordId);
   if(target.row.id===found.state.row.id){resultIds.add(found.taskId);continue;}
   found.state.parsed.tasks.splice(found.index,1);found.state.dirty=true;target.parsed.tasks.push(found.task);target.dirty=true;
   taskStates.set(found.taskId,{...found.meta,recordId:target.row.id,recordStatus:target.row.status});
   transferOwners.set(found.taskId,target.row.id);resultIds.add(found.taskId);orderChanged=true;
   continue;
  }
  const found=await locate(operation.taskId),scope=operation.scope??{},before=operation.beforeTaskId===null?null:resolveId(operation.beforeTaskId);
  if(scope.recordId)await loadRecord(scope.recordId);
  const sourceAt=order.indexOf(found.taskId);if(sourceAt<0)throw new StorageError('TASK_NOT_FOUND');order.splice(sourceAt,1);
  if(before!==null){
   let anchor=taskStates.get(before);
   if(before===found.taskId||!anchor)throw new StorageError('INVALID_TASK_ORDER','Anchor is outside the requested task scope');
   await loadRecord(anchor.recordId);anchor=taskStates.get(before);
   if(!scopeMatches(anchor,scope))throw new StorageError('INVALID_TASK_ORDER','Anchor is outside the requested task scope');
   const anchorAt=order.indexOf(before);if(anchorAt<0)throw new StorageError('INVALID_TASK_ORDER');order.splice(anchorAt,0,found.taskId);
  }else{
   let last=-1;for(let i=0;i<order.length;i++)if(scopeMatches(taskStates.get(order[i]!),scope))last=i;
   order.splice(last<0?order.length:last+1,0,found.taskId);
  }
  movable.add(found.taskId);placeRecords.add(found.meta.recordId);resultIds.add(found.taskId);orderChanged=true;
 }

 const involved=[...records.values()],dirty=involved.filter(state=>state.dirty),latestRevisions=Object.fromEntries(involved.map(state=>[state.row.id,state.row.revision]));
 const missingExpected=involved.filter(state=>input.expectedRevisions[state.row.id]===undefined);
 const stale=involved.filter(state=>input.expectedRevisions[state.row.id]!==state.row.revision);
 if(missingExpected.length||stale.length)throw new StorageError('VERSION_CONFLICT','Expected revisions do not match current task lists',{
  applied:false,latestRevisions,orderVersion:baseOrderVersion,missingRecordIds:missingExpected.map(state=>state.row.id)
 });

 const {positions,updates}=assignPositions(order,movable,originalPositions),ts=now();
 const statements:D1PreparedStatement[]=[];
 for(const state of involved)statements.push(env.DB.prepare(`INSERT INTO record_contents(record_id,content,revision,content_sha256)
   SELECT ?, '', 0, '' WHERE NOT EXISTS (
     SELECT 1 FROM record_contents c JOIN records r ON r.id=c.record_id
     WHERE c.record_id=? AND c.revision=? AND r.metadata_revision=? AND r.status!='archived'
   )`).bind(state.row.id,state.row.id,state.row.revision,state.row.metadata_revision));
 if(orderChanged)statements.push(taskOrderVersionStatements(env,baseOrderVersion).guard);
 const revisions:Record<string,number>=Object.fromEntries(involved.map(state=>[state.row.id,state.row.revision]));
 const preparedCommits=[];
 const transferredTasks=new Map<string,Task>();
 for(const state of involved)for(const task of (JSON.parse(state.row.content) as {tasks:Task[]}).tasks)if(transferOwners.has(task.id))transferredTasks.set(task.id,task);
 for(const state of dirty){
  const content=JSON.stringify({...state.parsed,tasks:state.parsed.tasks},null,2);
  const prepared=await prepareTaskContentCommit(env,state.row,content,state.parsed.tasks,state.row.revision,
    'Task batch '+input.requestId,actor,{action:'mutate_tasks',requestId:input.requestId,operationCount:input.operations.length},ts,transferredTasks);
  if(!prepared.result.changed){state.dirty=false;continue;}
  preparedCommits.push(prepared);revisions[state.row.id]=prepared.result.revision;
 }
 for(const prepared of preparedCommits)statements.push(...prepared.contentStatements);
 for(const prepared of preparedCommits)if(prepared.deleteProjectionStatement)statements.push(prepared.deleteProjectionStatement);
 for(const prepared of preparedCommits)if(prepared.insertProjectionStatement)statements.push(prepared.insertProjectionStatement);
 for(const [taskId,targetRecordId] of transferOwners)statements.push(env.DB.prepare('UPDATE task_board_order SET record_id=? WHERE task_id=?').bind(targetRecordId,taskId));
 for(const prepared of preparedCommits)statements.push(...prepared.orderProjectionStatements);
 if(updates.size){
  const mapping=JSON.stringify([...updates].map(([id,position])=>({id,position})));
  statements.push(env.DB.prepare(`WITH positions AS (
    SELECT json_extract(value,'$.id') AS task_id,json_extract(value,'$.position') AS position FROM json_each(?)
  ) UPDATE task_board_order SET position=(SELECT position FROM positions WHERE positions.task_id=task_board_order.task_id)
    WHERE task_id IN (SELECT task_id FROM positions)`).bind(mapping));
 }
 for(const recordId of placeRecords)if(!records.get(recordId)?.dirty){
  const row=records.get(recordId)?.row??await getRecord(env,recordId);
  statements.push(event(env,'record',recordId,'update',row.revision,actor,{action:'place_tasks',requestId:input.requestId}));
 }
 for(const prepared of preparedCommits)statements.push(...prepared.finalStatements);
 if(orderChanged)statements.push(taskOrderVersionStatements(env,baseOrderVersion).bump);

 const pathByRecord=new Map<string,string>();
 await Promise.all([...records.values()].map(async state=>{
  const extras=await recordExtras(env,state.row.folder_id,state.row.id);
  pathByRecord.set(state.row.id,extras.path+(state.row.folder_id?'/':'')+state.row.name);
 }));
 const items:TaskViewItem[]=[];
 for(const taskId of resultIds){
  const meta=taskStates.get(taskId);if(!meta)continue;
  const state=await loadRecord(meta.recordId),task=state.parsed.tasks.find(item=>item.id===taskId);if(!task)continue;
  const counts=Object.fromEntries(statuses.map(status=>[status,state.parsed.tasks.filter(item=>item.status===status).length])) as TaskCounts;
  items.push({...task,recordId:meta.recordId,position:state.parsed.tasks.findIndex(item=>item.id===taskId),boardPosition:positions.get(taskId)!,
   updatedAt:state.dirty?ts:meta.updatedAt,list:{id:state.row.id,name:state.row.name,path:pathByRecord.get(state.row.id)!,folderId:state.row.folder_id,
    status:state.row.status,revision:revisions[state.row.id]??state.row.revision,order:'manual',counts,total:state.parsed.tasks.length}});
 }
 items.sort((a,b)=>a.boardPosition-b.boardPosition||a.id.localeCompare(b.id));
 const orderVersion=baseOrderVersion+(orderChanged?1:0);
 const result:MutateTasksResult={items,deletedIds:[...new Set(deletedIds)],revisions,orderVersion,...(Object.keys(created).length?{created}:{})};
 statements.push(env.DB.prepare('INSERT INTO task_mutation_requests(request_id,input_sha256,result_json,created_at) VALUES(?,?,?,?)')
  .bind(input.requestId,inputSha256,JSON.stringify(result),ts));
 try{await env.DB.batch(statements);}
 catch(error){
  const applied=await env.DB.prepare('SELECT input_sha256 AS inputSha256,result_json AS resultJson FROM task_mutation_requests WHERE request_id=?')
   .bind(input.requestId).first<{inputSha256:string;resultJson:string}>();
  if(applied){
   if(applied.inputSha256===inputSha256)return JSON.parse(applied.resultJson) as MutateTasksResult;
   throw new StorageError('IDEMPOTENCY_CONFLICT','requestId was already used for different input',{applied:false});
  }
  const details=await latestDetails(env,Object.keys(input.expectedRevisions));
  if(Object.entries(input.expectedRevisions).some(([id,revision])=>details.latestRevisions[id]!==revision))
   throw new StorageError('VERSION_CONFLICT','Task lists changed before the batch committed',details);
  if(isRecordGuardError(error))
   throw new StorageError('METADATA_CONFLICT','Task list metadata changed before the batch committed',details);
  if(orderChanged&&details.orderVersion!==baseOrderVersion||isTaskOrderGuardError(error))
   throw new StorageError('ORDER_VERSION_CONFLICT','Task order changed before the batch committed',details);
  throw error;
 }
 return result;
}
