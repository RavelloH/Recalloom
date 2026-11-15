import type {Env,Task,TaskStatus} from '../types.js';
import {StorageError} from '../types.js';
import {event,newId} from './internal.js';

export type TaskAction='add'|'update'|'remove'|'reorder'|'board_reorder';
export type RankPlan={position:number;rebalanced:boolean;statements:D1PreparedStatement[]};

type RankRow={id:string;position:number};
type RankSnapshotRow=RankRow&{fingerprint:string};
type SourceRank={position:number};
const rankStep=1024;
const guardPrefix='task-board-guard:';

const activeStatusRows=`FROM task_board_order bo
 JOIN tasks t ON t.id=bo.task_id JOIN records r ON r.id=t.record_id
 WHERE t.status=? AND r.status!='archived' AND bo.task_id<>?`;

function neighborSql(before:boolean,column:'task_id'|'position'){
 return `(SELECT bo.${column} ${activeStatusRows}${before
  ?' AND (bo.position<? OR (bo.position=? AND bo.task_id<?))'
  :''} ORDER BY bo.position DESC,bo.task_id DESC LIMIT 1)`;
}

function neighborBindings(targetStatus:TaskStatus,taskId:string,anchor?:RankRow){
 return anchor
  ?[targetStatus,taskId,anchor.position,anchor.position,anchor.id]
  :[targetStatus,taskId];
}

function statusFingerprintSql(){
 return `(SELECT COALESCE(group_concat(snapshot.task_id||':'||printf('%.17g',snapshot.position),'|'),'')
   FROM (SELECT bo.task_id,bo.position ${activeStatusRows} ORDER BY bo.position,bo.task_id) snapshot)`;
}

function rankGuard(env:Env,input:{
 recordId:string;taskId:string;targetStatus:TaskStatus;expectedRevision?:number;
 sourcePosition:number;anchor?:RankRow;previous?:RankRow;fingerprint?:string;
}){
 const conditions=[`EXISTS (SELECT 1 FROM tasks source JOIN records r ON r.id=source.record_id
   JOIN task_board_order bo ON bo.task_id=source.id
   WHERE source.id=? AND source.record_id=? AND source.status=? AND r.status!='archived' AND bo.position IS ?)`];
 const values:unknown[]=[input.taskId,input.recordId,input.targetStatus,input.sourcePosition];
 if(input.anchor){
  conditions.push(`EXISTS (SELECT 1 FROM tasks anchor JOIN records r ON r.id=anchor.record_id
    JOIN task_board_order bo ON bo.task_id=anchor.id
    WHERE anchor.id=? AND anchor.id<>? AND anchor.status=? AND r.status!='archived' AND bo.position IS ?)`);
  values.push(input.anchor.id,input.taskId,input.targetStatus,input.anchor.position);
 }
 const bindings=neighborBindings(input.targetStatus,input.taskId,input.anchor);
 conditions.push(`${neighborSql(Boolean(input.anchor),'task_id')} IS ?`);
 values.push(...bindings,input.previous?.id??null);
 conditions.push(`${neighborSql(Boolean(input.anchor),'position')} IS ?`);
 values.push(...bindings,input.previous?.position??null);
 if(input.expectedRevision!==undefined){
  conditions.push('EXISTS (SELECT 1 FROM record_contents c WHERE c.record_id=? AND c.revision=?)');
  values.push(input.recordId,input.expectedRevision);
 }
 if(input.fingerprint!==undefined){
  conditions.push(`${statusFingerprintSql()}=?`);
  values.push(input.targetStatus,input.taskId,input.fingerprint);
 }
 // A failed predicate attempts an impossible row and aborts the entire D1 batch.
 return env.DB.prepare(`INSERT INTO task_board_order(task_id,record_id,position)
   SELECT ?,NULL,0 WHERE NOT (${conditions.join(' AND ')})`).bind(guardPrefix+newId(),...values);
}

export function isTaskOrderGuardError(error:unknown){
 return error instanceof Error&&/NOT NULL constraint failed:\s*task_board_order\.record_id/i.test(error.message);
}

export async function boardRankPlan(env:Env,recordId:string,taskId:string,targetStatus:TaskStatus,beforeTaskId:string|null,expectedRevision?:number):Promise<RankPlan>{
 if(beforeTaskId===taskId)throw new StorageError('INVALID_TASK_ORDER','A task cannot be placed before itself');
 const source=await env.DB.prepare(`SELECT bo.position FROM task_board_order bo
   JOIN tasks t ON t.id=bo.task_id JOIN records r ON r.id=t.record_id
   WHERE bo.task_id=? AND t.record_id=? AND r.status!='archived'`).bind(taskId,recordId).first<SourceRank>();
 if(!source)throw new StorageError('INVALID_TASK_ORDER','Task is not active on the board');
 let previous:RankRow|undefined,anchor:RankRow|undefined;
 if(beforeTaskId!==null){
  anchor=await env.DB.prepare(`SELECT bo.task_id AS id,bo.position FROM task_board_order bo
    JOIN tasks t ON t.id=bo.task_id JOIN records r ON r.id=t.record_id
    WHERE bo.task_id=? AND t.status=? AND r.status!='archived'`).bind(beforeTaskId,targetStatus).first<RankRow>()??undefined;
  if(!anchor)throw new StorageError('INVALID_TASK_ORDER','Anchor must be active and in the target status');
  previous=await env.DB.prepare(`SELECT bo.task_id AS id,bo.position ${activeStatusRows}
    AND (bo.position<? OR (bo.position=? AND bo.task_id<?))
    ORDER BY bo.position DESC,bo.task_id DESC LIMIT 1`)
   .bind(...neighborBindings(targetStatus,taskId,anchor)).first<RankRow>()??undefined;
 }else{
  previous=await env.DB.prepare(`SELECT bo.task_id AS id,bo.position ${activeStatusRows}
    ORDER BY bo.position DESC,bo.task_id DESC LIMIT 1`)
   .bind(...neighborBindings(targetStatus,taskId)).first<RankRow>()??undefined;
 }
 const direct=anchor
  ?previous?(previous.position+anchor.position)/2:anchor.position-rankStep
  :previous?previous.position+rankStep:rankStep;
 const hasRoom=Number.isFinite(direct)&&(!previous||direct>previous.position)&&(!anchor||direct<anchor.position);
 if(hasRoom){
  const guard=rankGuard(env,{recordId,taskId,targetStatus,expectedRevision,sourcePosition:source.position,anchor,previous});
  return {position:direct,rebalanced:false,statements:[guard,env.DB.prepare('UPDATE task_board_order SET position=? WHERE task_id=? AND record_id=?').bind(direct,taskId,recordId)]};
 }

 const rows=(await env.DB.prepare(`SELECT bo.task_id AS id,bo.position,
   group_concat(bo.task_id||':'||printf('%.17g',bo.position),'|') OVER (
     ORDER BY bo.position,bo.task_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
   ) AS fingerprint ${activeStatusRows}
   ORDER BY bo.position,bo.task_id`).bind(targetStatus,taskId).all<RankSnapshotRow>()).results;
 const insertion=beforeTaskId===null?rows.length:rows.findIndex(row=>row.id===beforeTaskId);
 if(insertion<0)throw new StorageError('INVALID_TASK_ORDER','Anchor must be active and in the target status');
 const fingerprint=rows[0]?.fingerprint??'';
 const position=insertion===0?rankStep/2:insertion===rows.length?(rows.length+1)*rankStep:(insertion+.5)*rankStep;
 const guard=rankGuard(env,{recordId,taskId,targetStatus,expectedRevision,sourcePosition:source.position,anchor,previous,fingerprint});
 const rebalance=env.DB.prepare(`WITH ranked AS (
   SELECT bo.task_id,ROW_NUMBER() OVER (ORDER BY bo.position,bo.task_id)*? AS next_position
   ${activeStatusRows}
 ) UPDATE task_board_order SET position=(SELECT next_position FROM ranked WHERE ranked.task_id=task_board_order.task_id)
   WHERE task_id IN (SELECT task_id FROM ranked)`).bind(rankStep,targetStatus,taskId);
 return {position,rebalanced:true,statements:[guard,rebalance,env.DB.prepare('UPDATE task_board_order SET position=? WHERE task_id=? AND record_id=?').bind(position,taskId,recordId)]};
}

export async function applyRankOnly(env:Env,row:{id:string;revision:number;content_sha256:string},tasks:Task[],taskId:string,targetStatus:TaskStatus,plan:RankPlan,beforeTaskId:string|null,actor:string,action:TaskAction){
 const sourceIndex=plan.statements.length-1;
 const results=await env.DB.batch([...plan.statements,event(env,'record',row.id,'update',row.revision,actor,{action,taskId,changes:{status:targetStatus},beforeTaskId})]);
 if(Number(results[sourceIndex]?.meta.changes??0)!==1)throw new StorageError('TASK_ORDER_CONFLICT','Task board order changed; reload and retry');
 return {id:row.id,revision:row.revision,changed:false,contentSha256:row.content_sha256,tasks,
  boardOrder:{taskId,position:plan.position,beforeTaskId,...(plan.rebalanced?{rebalanced:true as const}:{})}};
}
