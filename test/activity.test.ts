import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {activityDays} from '../src/activity-query.js';
import {activitySummary,activityFolders} from '../src/activity-analytics.js';
import {recentActivity,activityDetail} from '../src/web-activity.js';
import {taskActivity} from '../src/activity-events.js';
import {createRecord,getRecord} from '../src/storage/record-core.js';
import {restoreRecord} from '../src/storage/record-revisions.js';
import {mutateTasks} from '../src/storage/task-mutations.js';
import type {Env,Task} from '../src/types.js';

function fixture(){
 const db=new DatabaseSync(':memory:'),directory=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(new URL(name,directory),'utf8'));
 class Statement{
  values:(string|number|null)[]=[];
  constructor(readonly sql:string){}
  bind(...values:(string|number|null)[]){this.values=values;return this;}
  async first(){return db.prepare(this.sql).get(...this.values)??null;}
  async all(){return {results:db.prepare(this.sql).all(...this.values)};}
  async run(){return {meta:{changes:Number(db.prepare(this.sql).run(...this.values).changes)}};}
 }
 const env={DB:{prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{
  db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(/^\s*(SELECT|WITH)/i.test(statement.sql)?await statement.all():await statement.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}
 }}} as unknown as Env;
 const folder=(name:string,parentId:string|null=null)=>{const id=crypto.randomUUID();db.prepare("INSERT INTO folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,'x','x')").run(id,parentId,name);return id;};
 const event=(id:string,actor='web:owner:test',createdAt='2026-11-15T03:00:00.000Z',details:unknown={},operation='update')=>{
  const result=db.prepare("INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,2,?,?,'record',?,?)")
   .run(id,operation,actor,createdAt,id,JSON.stringify(details));return Number(result.lastInsertRowid);
 };
 return {db,env,folder,event};
}
const range={from:'2026-11-15',to:'2026-11-15',timeZone:'Asia/Shanghai'};

test('recent activity is newest-first and enriches resource/actor from persisted OAuth registration',async(t)=>{
 const f=fixture();t.after(()=>f.db.close());const folder=f.folder('Work');
 const doc=await createRecord(f.env,{name:'Design.md',folderId:folder});f.db.exec('DELETE FROM change_events');
 f.db.prepare("INSERT INTO oauth_actor_names VALUES('known','Codex','x')").run();
 f.db.prepare("INSERT INTO change_events(event_type,actor,created_at,entity_type,entity_id,details_json) VALUES('create','web:owner:x','2026-11-15T01:00:00Z','folder',?,'{}')").run(folder);
 const seq=f.event(doc.id,'grant:known');const items=(await recentActivity(f.env)).items;
 assert.equal(items[0]!.seq,seq);assert.equal(items[0]!.actorName,'Codex');assert.equal(items[0]!.resourceName,'Design.md');
 assert.equal(items[1]!.actorName,'本人（Web）');assert.equal(items[1]!.resourceName,'Work');
});

test('system migrations and unidentified historical actors retain distinct audit names',async(t)=>{
 const f=fixture();t.after(()=>f.db.close());const doc=await createRecord(f.env,{name:'状态总览.md'});f.db.exec('DELETE FROM change_events');
 for(const actor of ['grant:unregistered','legacy-import','system:maintenance','system:migration'])f.event(doc.id,actor,undefined,{from:'checkpoint',to:'document'},'kind_migrate');
 const items=(await recentActivity(f.env)).items;
 assert.deepEqual(items.map(item=>[item.actorName,item.actorKind]),[['系统迁移','system'],['系统','system'],['未识别的历史操作方','unknown'],['未识别 Agent','agent']]);
 assert.equal(items[0]!.operation,'kind_migrate');assert.equal(items[0]!.resourceName,'状态总览.md');
});

test('activity calendar honors local midnight, leap dates and daylight-saving transitions',()=>{
 assert.deepEqual(activityDays('2026-11-15','2026-11-15','Asia/Shanghai'),[{day:'2026-11-15',start:'2026-11-14T16:00:00.000Z',end:'2026-11-15T16:00:00.000Z'}]);
 const spring=activityDays('2026-03-08','2026-03-08','America/New_York')[0]!;
 assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);
 const fall=activityDays('2026-11-01','2026-11-01','America/New_York')[0]!;
 assert.equal(Date.parse(fall.end)-Date.parse(fall.start),25*3600000);
 const skipped=activityDays('2026-09-06','2026-09-06','America/Santiago')[0]!;
 assert.equal(skipped.start,'2026-09-06T04:00:00.000Z');assert.equal(Date.parse(skipped.end)-Date.parse(skipped.start),23*3600000);
 assert.equal(activityDays('2024-02-28','2024-03-01').length,3);
 for(const args of [['2026-02-29','2026-03-01'],['2026-11-16','2026-11-15'],['2025-01-01','2026-11-15'],['2026-11-15','2026-11-15','Invalid/Zone']])assert.throws(()=>activityDays(args[0]!,args[1]!,args[2]));
});

test('statistics cover the complete interval, independent of feed pagination, and retain raw originals',async(t)=>{
 const f=fixture();t.after(()=>f.db.close());
 const record=await createRecord(f.env,{name:'Activity document'});
 f.db.exec('DELETE FROM change_events');
 for(let index=0;index<115;index++)f.event(record.id,index%2?'web:owner:test':'system:index');
 f.event(record.id,'web:owner:test','2026-11-15T16:00:00.000Z');
 const summary=await activitySummary(f.env,range),first=await recentActivity(f.env,undefined,50,range);
 assert.equal(summary.totals.changes,115);assert.equal(summary.totals.resources,1);assert.equal(summary.totals.activeDays,1);
 assert.equal(summary.days[0]!.user,57);assert.equal(summary.days[0]!.system,58);
 const seen=first.items.map(item=>item.seq);let next=first.page.nextCursor;
 while(next){const page=await recentActivity(f.env,next,50,range);seen.push(...page.items.map(item=>item.seq));next=page.page.nextCursor;}
 assert.equal(seen.length,115);assert.equal(new Set(seen).size,115);assert.deepEqual(seen,[...seen].sort((a,b)=>b-a));
});

test('feed and summary share actor, category, text and subtree filters, including malformed history',async(t)=>{
 const f=fixture();t.after(()=>f.db.close());
 const parent=f.folder('Projects'),child=f.folder('Child',parent),other=f.folder('Other');
 const doc=await createRecord(f.env,{name:'Needle document',folderId:child}),list=await createRecord(f.env,{name:'Tasks',kind:'task_list',folderId:other});
 f.db.exec('DELETE FROM change_events');
 f.db.prepare("INSERT INTO oauth_actor_names VALUES('known','ChatGPT','x')").run();
 f.event(doc.id,'grant:known');f.event(doc.id,'grant:unknown');f.event(doc.id);f.event(list.id);
 f.event(doc.id,'system:import','2026-11-15T02:00:00.000Z',null,'tag_add');
 const invalid=f.event(doc.id,'legacy');f.db.prepare('UPDATE change_events SET details_json=? WHERE seq=?').run('{broken',invalid);
 for(const filter of [{folderId:parent},{actor:'agent'},{actor:'client:ChatGPT'},{categories:['task'] as const},{categories:[]},{query:'Needle'},{query:'ChatGPT'}]){
  const options={...range,...filter,categories:'categories'in filter?[...filter.categories!]:undefined};
  const feed=await recentActivity(f.env,undefined,100,options),summary=await activitySummary(f.env,options);
  assert.equal(summary.totals.changes,feed.items.length,JSON.stringify(filter));
 }
 assert.equal((await activitySummary(f.env,{...range,actor:'client:ChatGPT'})).totals.changes,1);
 assert.equal((await activitySummary(f.env,{...range,folderId:parent})).totals.changes,5);
 assert.equal((await recentActivity(f.env,undefined,100,range)).items.find(item=>item.seq===invalid)?.details instanceof Object,true);
 assert.equal((await activityDetail(f.env,invalid)).path,'/Projects/Child/Needle document');
 const folders=await activityFolders(f.env);assert.ok(folders.items.some(item=>item.path==='/Projects/Child'));
 await assert.rejects(activityDetail(f.env,999999),{code:'ACTIVITY_NOT_FOUND'});
});

test('task activity counts completions once across atomic transfers and idempotent retries, and records restores',async(t)=>{
 const f=fixture();t.after(()=>f.db.close());
 const a=await createRecord(f.env,{name:'Source',kind:'task_list'}),b=await createRecord(f.env,{name:'Target',kind:'task_list'});
 const created=await mutateTasks(f.env,{requestId:'create',expectedRevisions:{[a.id]:1},operations:[{op:'create',recordId:a.id,title:'Finish work',clientId:'first'}]},'web:owner:test');
 const taskId=created.created!.first!;
 const input={requestId:'move-and-finish',expectedRevisions:{[a.id]:2,[b.id]:1},expectedOrderVersion:created.orderVersion,operations:[{op:'transfer' as const,taskId,targetRecordId:b.id},{op:'update' as const,taskId,changes:{status:'done' as const}}]};
 await mutateTasks(f.env,input,'web:owner:test');await mutateTasks(f.env,input,'web:owner:test');
 const after=await recentActivity(f.env),events=after.items.filter(item=>item.details?.requestId==='move-and-finish');
 assert.equal(events.length,2);
 assert.equal(events.reduce((sum,event)=>sum+Number((event.details?.taskActivity as {completed:number}).completed),0),1);
 assert.equal(events.reduce((sum,event)=>sum+Number((event.details?.taskActivity as {removed:number}).removed),0),0);
 const today=new Date().toISOString().slice(0,10),summary=await activitySummary(f.env,{from:today,to:today,timeZone:'UTC'});
 assert.equal(summary.totals.completed,1);assert.equal(summary.totals.changes,4); // Two list creations and two logical batches.
 await restoreRecord(f.env,b.id,1,2,'web:owner:test');
 const restored=(await recentActivity(f.env)).items[0]!;
 assert.equal(restored.details?.action,'restore');assert.equal((restored.details?.taskActivity as {removed:number}).removed,1);
 const row=await getRecord(f.env,b.id);assert.equal(row.revision,3);
});

test('semantic detail is bounded while aggregate counts remain complete',()=>{
 const before:Task[]=Array.from({length:80},(_,index)=>({id:String(index),title:'Task '+index,details:'',status:'todo',priority:0}));
 const result=taskActivity(before,before.map(task=>({...task,status:'done'})));
 assert.equal(result.completed,80);assert.equal(result.changes.length,50);assert.equal(result.totalChanges,80);
 const reopened=taskActivity([{...before[0]!,status:'done'}],[before[0]!]);assert.equal(reopened.reopened,1);
});

test('historical task gaps are disclosed, known rank-only changes excluded, deleted resources preserve snapshots',async(t)=>{
 const f=fixture();t.after(()=>f.db.close());const record=await createRecord(f.env,{name:'Deleted list',kind:'task_list'});
 f.db.exec('DELETE FROM change_events');
 f.event(record.id,'web:owner:test',undefined,{name:'Deleted list',kind:'task_list'});
 f.event(record.id,'web:owner:test',undefined,{name:'Deleted list',kind:'task_list',action:'place_tasks'});
 f.db.prepare('DELETE FROM records WHERE id=?').run(record.id);
 const summary=await activitySummary(f.env,range);assert.equal(summary.coverage.incompleteTaskEvents,1);assert.equal(summary.totals.completed,0);
 const feed=await recentActivity(f.env);assert.ok(feed.items.every(item=>item.resourceName==='Deleted list'&&!item.resourceExists&&item.recordKind==='task_list'));
});
