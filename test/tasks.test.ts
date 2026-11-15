import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {getTaskLists,getTaskView,getTaskItem,getTasks,taskOperation} from '../src/storage/tasks.js';
import {getRecord} from '../src/storage/record-core.js';
import {restoreRecord} from '../src/storage/record-revisions.js';
import {initialVersion,sha256} from '../src/version.js';
import {webApi} from '../src/web-api.js';
import {webHmacHex} from '../src/web-keys.js';
import {WEB_COOKIE} from '../src/web-auth.js';
import {InMemoryTransport,LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/server';
import {createRecalloomServer} from '../src/mcp.js';
import type {Env,Task,TaskStatus} from '../src/types.js';

// Execute the real SQL against the complete production schema, including atomic D1 batches.
function fixture(){
  const db=new DatabaseSync(':memory:');
  const directory=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL(name,directory),'utf8'));
  class Statement {
    values:(string|number|null)[]=[];
    constructor(readonly sql:string){}
    bind(...values:(string|number|null)[]){this.values=values;return this;}
    async first(){return db.prepare(this.sql).get(...this.values)??null;}
    async all(){return {results:db.prepare(this.sql).all(...this.values)};}
    async run(){const result=db.prepare(this.sql).run(...this.values);return {meta:{changes:Number(result.changes)}};}
  }
  const env={MCP_AUTH_SECRET:'tasks-test-secret',DB:{
    prepare:(sql:string)=>new Statement(sql),
    batch:async(statements:Statement[])=>{
      db.exec('BEGIN');
      try {
        const results=[];
        for(const statement of statements){
          const prepared=db.prepare(statement.sql);
          if(/^\s*(SELECT|WITH)/i.test(statement.sql))results.push({results:prepared.all(...statement.values)});
          else {const result=prepared.run(...statement.values);results.push({results:[],meta:{changes:Number(result.changes)}});}
        }
        db.exec('COMMIT');return results;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  }} as unknown as Env;
  const folder=(name:string,parentId:string|null=null)=>{
    const id=crypto.randomUUID();
    db.prepare('INSERT INTO folders(id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,parentId,name,'2026-11-15','2026-11-15');return id;
  };
  const list=async(name:string,tasks:Task[]=[],folderId:string|null=null,manual=false)=>{
    const id=crypto.randomUUID(),content=JSON.stringify({tasks,...(manual?{taskOrder:'manual'}:{})},null,2),digest=await sha256(content);
    db.prepare("INSERT INTO records(id,folder_id,name,kind,status,created_at,updated_at) VALUES(?,?,?,'task_list','active',?,?)").run(id,folderId,name,'2026-11-15','2026-11-15');
    db.prepare('INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,1,?)').run(id,content,digest);
    db.prepare('INSERT INTO record_histories(record_id,history_metadata) VALUES(?,?)').run(id,initialVersion(content).metadata);
    db.prepare("INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,1,?,'Created','test','2026-11-15')").run(id,digest);
    tasks.forEach((t,position)=>db.prepare('INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(t.id,id,t.title,t.details,t.status,t.priority,position,'2026-11-15'));
    return id;
  };
  const request=async(path:string,body?:unknown)=>{
    const token='t'.repeat(43),now=Date.now();
    db.prepare('INSERT OR REPLACE INTO web_sessions(id,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?)').run('session',await webHmacHex(env.MCP_AUTH_SECRET,'session',token),now,now,now+60000);
    return webApi.fetch(new Request('https://tasks.test/api'+path,{method:body===undefined?'GET':'POST',headers:{cookie:WEB_COOKIE+'='+token,origin:'https://tasks.test','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  };
  return {db,env,folder,list,request};
}
const task=(title:string,status:TaskStatus='todo',priority=0,details=''):Task=>({id:crypto.randomUUID(),title,details,status,priority});
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===expected;

test('task list groups include empty lists, source paths, full counts and folder descendants',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const parent=f.folder('Work'),child=f.folder('Nested',parent);
  const empty=await f.list('Empty',[],parent);
  const id=await f.list('Sprint',[task('Build'),task('Paused','blocked'),task('Shipped','done')],child);
  const archived=await f.list('Old',[task('Hidden')],parent);
  f.db.prepare("UPDATE records SET status='archived' WHERE id=?").run(archived);
  await f.list('Outside',[task('Elsewhere')]);
  const first=await getTaskLists(f.env,{folderId:parent,limit:1});
  assert.deepEqual(first.counts,{todo:1,in_progress:0,blocked:1,done:1,cancelled:0});
  assert.equal(first.page.hasMore,true);
  const second=await getTaskLists(f.env,{folderId:parent,limit:1,cursor:first.page.nextCursor!});
  assert.equal(second.page.hasMore,false);
  const groups=[...first.items,...second.items];
  assert.equal(groups.find(x=>x.id===empty)!.total,0);
  assert.equal(groups.find(x=>x.id===id)!.path,'/Work/Nested/Sprint');
  assert.equal(groups.find(x=>x.id===id)!.revision,1);
  await assert.rejects(getTaskLists(f.env,{cursor:first.page.nextCursor!}),code('INVALID_CURSOR'));
});

test('board columns paginate independently in 40-item keyset pages, including beyond 200 tasks',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const tasks=Array.from({length:245},(_,i)=>task('Task '+i,i%2?'done':'todo',i%7));
  await f.list('Large',tasks);
  const first=await getTaskView(f.env,{statuses:['todo']});
  assert.equal(first.items.length,40);
  assert.equal(first.items[0]!.list.counts.todo,123);
  await assert.rejects(getTaskView(f.env,{statuses:['done'],cursor:first.page.nextCursor!}),code('INVALID_CURSOR'));
  const ids=first.items.map(x=>x.id);
  let cursor=first.page.nextCursor;
  while(cursor){const next=await getTaskView(f.env,{statuses:['todo'],cursor});ids.push(...next.items.map(x=>x.id));cursor=next.page.nextCursor;}
  assert.equal(ids.length,123);assert.equal(new Set(ids).size,123);
  const all=await getTaskView(f.env,{limit:999});assert.equal(all.items.length,200);
  assert.equal((await getTaskItem(f.env,tasks.at(-1)!.id)).item.title,'Task 244');
  const total=await getTaskLists(f.env);assert.equal(total.items[0]!.total,245);
});

test('search covers unloaded title/details and counts, while status selection leaves source counts complete',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const id=await f.list('Search',[...Array.from({length:45},(_,i)=>task('Other '+i)),task('Needle','done'),task('Details only','todo',0,'NEEDLE here')]);
  await f.list('Empty');
  const groups=await getTaskLists(f.env,{query:' needle '});
  assert.equal(groups.items.length,1);assert.equal(groups.items[0]!.id,id);assert.equal(groups.items[0]!.total,2);
  const matching=await getTaskView(f.env,{query:'needle',statuses:['todo']});
  assert.deepEqual(matching.items.map(x=>x.title),['Details only']);
  assert.equal(matching.items[0]!.list.counts.done,1);
  assert.equal((await getTaskLists(f.env,{query:'%'})).items.length,0,'search text is literal, not a LIKE wildcard');
  await assert.rejects(getTaskView(f.env,{cursor:'null'}),code('INVALID_CURSOR'));
});

test('reorder freezes legacy priority order, changes status atomically and survives edits and history restore',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const low=task('Low','todo',-3),high=task('High','todo',8),middle=task('Middle','blocked',2);
  const id=await f.list('Ordering',[low,high,middle]);
  assert.deepEqual((await getTaskView(f.env,{recordId:id})).items.map(x=>x.id),[high.id,middle.id,low.id]);
  const moved=await taskOperation(f.env,id,1,'reorder',low.id,{status:'in_progress'},'test',{beforeTaskId:middle.id});
  assert.equal(moved.revision,2);assert.deepEqual(moved.tasks.map(x=>x.id),[high.id,low.id,middle.id]);
  assert.equal(moved.tasks[1]!.status,'in_progress');
  const saved=JSON.parse((await getRecord(f.env,id)).content);assert.equal(saved.taskOrder,'manual');
  assert.deepEqual(f.db.prepare('SELECT id,position FROM tasks WHERE record_id=? ORDER BY position').all(id).map(x=>[x.id,x.position]),[[high.id,0],[low.id,1],[middle.id,2]]);
  await taskOperation(f.env,id,2,'update',middle.id,{title:'Renamed',details:'Keep this',priority:10},'test');
  assert.deepEqual((await getTaskView(f.env,{recordId:id})).items.map(x=>x.id),[high.id,low.id,middle.id]);
  const added=await taskOperation(f.env,id,3,'add',undefined,{title:'New','priority':10},'test');
  assert.equal((await getTaskView(f.env,{recordId:id})).items.at(-1)!.id,added.tasks.at(-1)!.id);
  await restoreRecord(f.env,id,1,4,'test');
  assert.equal((await getTaskLists(f.env,{recordId:id})).items[0]!.order,'priority');
  await restoreRecord(f.env,id,2,5,'test');
  assert.equal((await getTaskLists(f.env,{recordId:id})).items[0]!.order,'manual');
  assert.deepEqual((await getTaskView(f.env,{recordId:id})).items.map(x=>x.id),[high.id,low.id,middle.id]);
});

test('invalid anchors and stale revisions cannot change canonical content or its task projection',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const first=task('First'),second=task('Second'),foreign=task('Foreign');
  const id=await f.list('Own',[first,second]);await f.list('Other',[foreign]);
  const before=(await getRecord(f.env,id)).content;
  await assert.rejects(taskOperation(f.env,id,1,'reorder',first.id,{},'test',{beforeTaskId:foreign.id}),code('INVALID_TASK_ORDER'));
  await assert.rejects(taskOperation(f.env,id,1,'reorder',first.id,{},'test',{beforeTaskId:first.id}),code('INVALID_TASK_ORDER'));
  await assert.rejects(taskOperation(f.env,id,1,'reorder',first.id,{},'test'),code('INVALID_TASK_ORDER'));
  assert.equal((await getRecord(f.env,id)).content,before);
  const concurrent=await Promise.allSettled([
    taskOperation(f.env,id,1,'update',first.id,{title:'Writer A'},'test'),
    taskOperation(f.env,id,1,'update',second.id,{title:'Writer B'},'test')
  ]);
  assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(concurrent.filter(x=>x.status==='rejected'&&code('VERSION_CONFLICT')(x.reason)).length,1);
  assert.equal((await getRecord(f.env,id)).revision,2);
  assert.equal((await getTasks(f.env,id)).items.length,2);
});

test('new web task endpoints validate scopes/states/reorder and leave the legacy query contract intact',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const a=task('Alpha'),b=task('Beta','done');const id=await f.list('API',[a,b]);
  const view=await f.request('/tasks/view?recordId='+id+'&statuses=todo');assert.equal(view.status,200);
  assert.equal(((await view.json()) as any).items[0].list.revision,1);
  assert.equal((await f.request('/tasks/view?statuses=open')).status,400);
  assert.equal((await f.request('/task-lists?recordId='+id+'&folderId='+crypto.randomUUID())).status,400);
  assert.equal((await f.request('/tasks?status=open')).status,400);
  const exact=await f.request('/tasks/'+b.id);assert.equal(exact.status,200);assert.equal(((await exact.json()) as any).item.title,'Beta');
  assert.equal((await f.request('/tasks/'+crypto.randomUUID())).status,404);
  const base={recordId:id,expectedRevision:1,action:'reorder',taskId:a.id};
  assert.equal((await f.request('/tasks/mutate',base)).status,400);
  const moved=await f.request('/tasks/mutate',{...base,beforeTaskId:null,changes:{status:'done',details:'Edited in Drawer'}});
  assert.equal(moved.status,200);assert.equal(((await moved.json()) as any).revision,2);
  assert.equal((await f.request('/tasks/mutate',{...base,beforeTaskId:null})).status,409);
  const legacy=await f.request('/tasks?recordId='+id+'&limit=1');const old=await legacy.json() as any;
  assert.equal(old.items.length,1);assert.equal(old.page.hasMore,true);assert.equal('list'in old.items[0],false);
});

test('manual ordering preserves imported priority values and deleting a task remains recoverable',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const imported=task('Imported','todo',100,'x'.repeat(50001)),normal=task('Normal');const id=await f.list('Compatible',[normal,imported]);
  await taskOperation(f.env,id,1,'reorder',normal.id,{},'test',{beforeTaskId:null});
  const unchanged=await taskOperation(f.env,id,2,'reorder',normal.id,{},'test',{beforeTaskId:null});
  assert.equal(unchanged.changed,false);assert.equal(unchanged.revision,2);
  const removed=await taskOperation(f.env,id,2,'remove',imported.id,{},'test');assert.equal(removed.revision,3);
  await assert.rejects(getTaskItem(f.env,imported.id),code('TASK_NOT_FOUND'));
  await restoreRecord(f.env,id,2,3,'test');
  const item=(await getTaskItem(f.env,imported.id)).item;
  assert.equal(item.priority,100);assert.equal(item.position,0);assert.equal(item.list.order,'manual');
  assert.equal(item.details.length,50001,'imported content outside current edit limits is not discarded by a reorder');
});

test('MCP reorder requires a same-list anchor, rejects stale writes and commits status/order together',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const a=task('First'),b=task('Second');const id=await f.list('MCP',[a,b]);
  const server=createRecalloomServer(f.env,['notes:read','notes:write'],'task-test');
  const [serverTransport,client]=InMemoryTransport.createLinkedPair();
  const pending=new Map<number,(value:any)=>void>();let sequence=0;
  client.onmessage=message=>{if('id'in message&&typeof message.id==='number'){pending.get(message.id)?.(message);pending.delete(message.id);}};
  await server.connect(serverTransport);await client.start();
  const request=async(method:string,params:Record<string,unknown>)=>{
    const id=++sequence;const response=new Promise<any>(resolve=>pending.set(id,resolve));
    await client.send({jsonrpc:'2.0',id,method,params});return response;
  };
  try {
    await request('initialize',{protocolVersion:LATEST_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'tasks-test',version:'1'}});
    await client.send({jsonrpc:'2.0',method:'notifications/initialized'});
    const base={action:'reorder',recordId:id,taskId:a.id,expectedRevision:1};
    const invalid=await request('tools/call',{name:'mutate_task',arguments:base});
    assert.ok(invalid.error||invalid.result?.isError);
    const moved=await request('tools/call',{name:'mutate_task',arguments:{...base,beforeTaskId:null,changes:{status:'blocked'}}});
    assert.equal(moved.error,undefined);assert.equal(moved.result.isError,undefined);
    const result=JSON.parse(moved.result.content[0].text);
    assert.equal(result.revision,2);assert.deepEqual(result.tasks.map((x:Task)=>x.id),[b.id,a.id]);
    assert.equal(result.tasks[1].status,'blocked');
    const stale=await request('tools/call',{name:'mutate_task',arguments:{...base,beforeTaskId:b.id}});
    assert.equal(stale.result.isError,true);assert.equal(JSON.parse(stale.result.content[0].text).code,'VERSION_CONFLICT');
  } finally {await client.close();await server.close();}
});
