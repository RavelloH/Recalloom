import type {Task} from './types.js';

import type {TaskActivity,TaskChange} from './activity-types.js';

/** Derive semantic activity at the commit boundary, including restores and MCP batches. */
export function taskActivity(before:Task[],after:Task[],transferred:ReadonlyMap<string,Task>=new Map()):TaskActivity{
 const old=new Map(before.map(task=>[task.id,task])),next=new Map(after.map(task=>[task.id,task]));
 const result:TaskActivity={version:1,created:0,completed:0,reopened:0,removed:0,updated:0,changes:[],totalChanges:0};
 const add=(change:TaskChange)=>{result.totalChanges++;if(result.changes.length<50)result.changes.push(change);};
 for(const task of after){
  const previous=old.get(task.id)??transferred.get(task.id);
  if(!previous){
   result.created++;add({id:task.id,title:task.title,action:'created',to:task.status});continue;
  }
  const fields=(['title','details','status','priority'] as const).filter(key=>previous[key]!==task[key]);
  if(!fields.length){if(!old.has(task.id))add({id:task.id,title:task.title,action:'transferred',from:previous.status,to:task.status});continue;}
  result.updated++;
  if(previous.status!=='done'&&task.status==='done')result.completed++;
  if(previous.status==='done'&&task.status!=='done')result.reopened++;
  add({id:task.id,title:task.title,action:'updated',from:previous.status,to:task.status,fields:[...fields]});
 }
 for(const task of before)if(!next.has(task.id)){
  const moving=transferred.has(task.id);if(!moving)result.removed++;
  add({id:task.id,title:task.title,action:moving?'transferred':'removed',from:task.status});
 }
 return result;
}

export function taskEventDetails(beforeContent:string,after:Task[],details:unknown,transferred?:ReadonlyMap<string,Task>){
 const before=JSON.parse(beforeContent) as {tasks:Task[]};
 return {...(details&&typeof details==='object'?details:{}),taskActivity:taskActivity(before.tasks,after,transferred)};
}
