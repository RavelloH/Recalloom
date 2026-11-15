import type {Env,Task,TaskStatus} from '../types.js';
import {StorageError} from '../types.js';
import {event} from './internal.js';

export type TaskAction='add'|'update'|'remove'|'reorder'|'board_reorder';
export type TaskOrderScope={recordId?:string;status?:TaskStatus};
export type RankPlan={position:number;rebalanced:boolean;orderVersion:number;sourceStatementIndex:number;statements:D1PreparedStatement[]};

type RankRow={id:string;position:number};
const rankStep=1024;

export async function getTaskOrderVersion(env:Env){
 const row=await env.DB.prepare('SELECT version FROM task_order_state WHERE id=1').first<{version:number}>();
 if(!row)throw new StorageError('TASK_ORDER_STATE_MISSING');
 return Number(row.version);
}

function scopeSql(scope:TaskOrderScope,alias='t'){
 const clauses=["r.status!='archived'"];
 const values:unknown[]=[];
 if(scope.recordId){clauses.push(`${alias}.record_id=?`);values.push(scope.recordId);}
 if(scope.status){clauses.push(`${alias}.status=?`);values.push(scope.status);}
 return {sql:clauses.join(' AND '),values};
}

export function taskOrderVersionStatements(env:Env,version:number,extraCondition='1',extraValues:unknown[]=[]){
 const guard=env.DB.prepare(`INSERT INTO task_order_state(id,version)
   SELECT 1,0 WHERE NOT (EXISTS (SELECT 1 FROM task_order_state WHERE id=1 AND version=?) AND ${extraCondition})`)
  .bind(version,...extraValues);
 const bump=env.DB.prepare('UPDATE task_order_state SET version=version+1 WHERE id=1 AND version=?').bind(version);
 return {guard,bump};
}

export function isTaskOrderGuardError(error:unknown){
 return error instanceof Error&&(
  /UNIQUE constraint failed:\s*task_order_state\.id/i.test(error.message)||
  /PRIMARY KEY constraint failed:\s*task_order_state\.id/i.test(error.message)
 );
}

function directPosition(left:RankRow|undefined,right:RankRow|undefined){
 if(left&&right)return (left.position+right.position)/2;
 if(left)return left.position+rankStep;
 if(right)return right.position-rankStep;
 return rankStep;
}

function hasRoom(position:number,left:RankRow|undefined,right:RankRow|undefined){
 return Number.isFinite(position)&&(!left||position>left.position)&&(!right||position<right.position);
}

export async function boardRankPlan(env:Env,recordId:string,taskId:string,beforeTaskId:string|null,scope:TaskOrderScope,expectedOrderVersion?:number):Promise<RankPlan>{
 if(beforeTaskId===taskId)throw new StorageError('INVALID_TASK_ORDER','A task cannot be placed before itself');
 const [source,version]=await Promise.all([
  env.DB.prepare(`SELECT bo.position FROM task_board_order bo JOIN tasks t ON t.id=bo.task_id
    JOIN records r ON r.id=t.record_id WHERE bo.task_id=? AND t.record_id=? AND r.status!='archived'`)
   .bind(taskId,recordId).first<{position:number}>(),
  getTaskOrderVersion(env)
 ]);
 if(!source)throw new StorageError('INVALID_TASK_ORDER','Task is not active in the global order');
 if(expectedOrderVersion!==undefined&&expectedOrderVersion!==version){
  throw new StorageError('ORDER_VERSION_CONFLICT','Latest order version is '+version,{applied:false,orderVersion:version});
 }

 const scoped=scopeSql(scope);
 let left:RankRow|undefined,right:RankRow|undefined,anchor:RankRow|undefined,lastVisible:RankRow|undefined;
 if(beforeTaskId!==null){
  anchor=await env.DB.prepare(`SELECT bo.task_id AS id,bo.position FROM task_board_order bo
    JOIN tasks t ON t.id=bo.task_id JOIN records r ON r.id=t.record_id
    WHERE bo.task_id=? AND bo.task_id<>? AND ${scoped.sql}`)
   .bind(beforeTaskId,taskId,...scoped.values).first<RankRow>()??undefined;
  if(!anchor)throw new StorageError('INVALID_TASK_ORDER','Anchor is outside the requested task scope');
  right=anchor;
  left=await env.DB.prepare(`SELECT task_id AS id,position FROM task_board_order
    WHERE task_id<>? AND (position<? OR (position=? AND task_id<?))
    ORDER BY position DESC,task_id DESC LIMIT 1`).bind(taskId,anchor.position,anchor.position,anchor.id).first<RankRow>()??undefined;
 }else{
  lastVisible=await env.DB.prepare(`SELECT bo.task_id AS id,bo.position FROM task_board_order bo
    JOIN tasks t ON t.id=bo.task_id JOIN records r ON r.id=t.record_id
    WHERE bo.task_id<>? AND ${scoped.sql} ORDER BY bo.position DESC,bo.task_id DESC LIMIT 1`)
   .bind(taskId,...scoped.values).first<RankRow>()??undefined;
  if(lastVisible){
   left=lastVisible;
   right=await env.DB.prepare(`SELECT task_id AS id,position FROM task_board_order
     WHERE task_id<>? AND (position>? OR (position=? AND task_id>?))
     ORDER BY position,task_id LIMIT 1`).bind(taskId,left.position,left.position,left.id).first<RankRow>()??undefined;
  }else{
   left=await env.DB.prepare('SELECT task_id AS id,position FROM task_board_order WHERE task_id<>? ORDER BY position DESC,task_id DESC LIMIT 1')
    .bind(taskId).first<RankRow>()??undefined;
  }
 }

 const position=directPosition(left,right);
 const sourceCondition=`EXISTS (SELECT 1 FROM task_board_order bo JOIN tasks t ON t.id=bo.task_id
   JOIN records r ON r.id=t.record_id WHERE bo.task_id=? AND t.record_id=? AND r.status!='archived' AND bo.position IS ?)`;
 const versionStatements=taskOrderVersionStatements(env,version,sourceCondition,[taskId,recordId,source.position]);
 if(hasRoom(position,left,right)){
  const update=env.DB.prepare('UPDATE task_board_order SET position=? WHERE task_id=? AND record_id=?').bind(position,taskId,recordId);
  return {position,rebalanced:false,orderVersion:version+1,sourceStatementIndex:1,statements:[versionStatements.guard,update,versionStatements.bump]};
 }

 const rows=(await env.DB.prepare('SELECT task_id AS id,position FROM task_board_order WHERE task_id<>? ORDER BY position,task_id')
  .bind(taskId).all<RankRow>()).results;
 const insertion=anchor?rows.findIndex(row=>row.id===anchor!.id):lastVisible?rows.findIndex(row=>row.id===lastVisible!.id)+1:rows.length;
 if(insertion<0)throw new StorageError('TASK_ORDER_CONFLICT','Task order changed; reload and retry');
 const nextPosition=(insertion+.5)*rankStep;
 const rebalance=env.DB.prepare(`WITH ordered AS (
   SELECT CAST(key AS INTEGER)+1 AS ordinal,value AS task_id FROM json_each(?)
 ) UPDATE task_board_order SET position=(SELECT ordinal*? FROM ordered WHERE ordered.task_id=task_board_order.task_id)
   WHERE task_id IN (SELECT task_id FROM ordered)`).bind(JSON.stringify(rows.map(row=>row.id)),rankStep);
 const update=env.DB.prepare('UPDATE task_board_order SET position=? WHERE task_id=? AND record_id=?').bind(nextPosition,taskId,recordId);
 return {position:nextPosition,rebalanced:true,orderVersion:version+1,sourceStatementIndex:2,statements:[versionStatements.guard,rebalance,update,versionStatements.bump]};
}

export async function applyRankOnly(env:Env,row:{id:string;revision:number;content_sha256:string},tasks:Task[],taskId:string,plan:RankPlan,beforeTaskId:string|null,actor:string,action:TaskAction){
 const revisionGuard=env.DB.prepare(`INSERT INTO record_contents(record_id,content,revision,content_sha256)
   SELECT ?, '', 0, '' WHERE NOT EXISTS (SELECT 1 FROM record_contents WHERE record_id=? AND revision=?)`)
   .bind(row.id,row.id,row.revision);
 const results=await env.DB.batch([revisionGuard,...plan.statements,event(env,'record',row.id,'update',row.revision,actor,{action,taskId,beforeTaskId,orderVersion:plan.orderVersion})]);
 if(Number(results[plan.sourceStatementIndex+1]?.meta.changes??0)!==1)throw new StorageError('TASK_ORDER_CONFLICT','Task order changed; reload and retry');
 return {id:row.id,revision:row.revision,changed:false,contentSha256:row.content_sha256,tasks,orderVersion:plan.orderVersion,
  boardOrder:{taskId,position:plan.position,beforeTaskId,...(plan.rebalanced?{rebalanced:true as const}:{})}};
}
