import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {getTaskLists,getTaskView,getTaskItem,getTasks,taskOperation} from '../src/storage/tasks.js';
import {mutateTasks} from '../src/storage/task-mutations.js';
import {getRecord} from '../src/storage/record-core.js';
import {commitContent,restoreRecord} from '../src/storage/record-revisions.js';
import {updateMeta} from '../src/storage/record-metadata.js';
import {archivedRecords} from '../src/storage/archive.js';
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
    tasks.forEach((t,position)=>db.prepare('INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(t.id,id,t.title,t.details,t.status,t.priority,position,'2026-11-15'));
    tasks.forEach(item=>db.prepare('INSERT INTO task_board_order(task_id,record_id,position) SELECT ?,?,COALESCE(MAX(position),0)+1024 FROM task_board_order').run(item.id,id));
    return id;
  };
  const request=async(path:string,body?:unknown)=>{
    const token='t'.repeat(43),now=Date.now();
    db.prepare('INSERT OR REPLACE INTO web_sessions(id,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?)').run('session',await webHmacHex(env.MCP_AUTH_SECRET!,'session',token),now,now,now+60000);
    return webApi.fetch(new Request('https://tasks.test/api'+path,{method:body===undefined?'GET':'POST',headers:{cookie:WEB_COOKIE+'='+token,origin:'https://tasks.test','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  };
  return {db,env,folder,list,request};
}
const task=(title:string,status:TaskStatus='todo',priority=0,details=''):Task=>({id:crypto.randomUUID(),title,details,status,priority});
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===expected;

test('archive pagination uses archive dates and binds cursors to kind, search and sort',async()=>{
 const f=fixture();
 try{
  const first=await f.list('Alpha'),second=await f.list('beta'),third=await f.list('Gamma');
  for(const [index,id] of [first,second,third].entries())f.db.prepare("UPDATE records SET status='archived',archived_at=?,archived_from_path=?,updated_at=? WHERE id=?").run('2026-11-'+(10+index),'/Plans/'+['Alpha','beta','Gamma'][index],'2026-12-'+(20-index),id);
  f.db.prepare("UPDATE records SET kind='document' WHERE id=?").run(second);
  const recent=await archivedRecords(f.env,1);
  assert.equal(recent.total,3);assert.equal(recent.items[0].id,third);
  const next=await archivedRecords(f.env,1,recent.page.nextCursor!);
  assert.equal(next.items[0].id,second);
  assert.equal((await archivedRecords(f.env,1,next.page.nextCursor!)).items[0].id,first);
  assert.equal((await archivedRecords(f.env,10,undefined,'','', 'oldest')).items[0].id,first);
  assert.deepEqual((await archivedRecords(f.env,10,undefined,'Plans','','name')).items.map(item=>item.id),[first,second,third]);
  const documents=await archivedRecords(f.env,1,undefined,'','document');
  assert.equal(documents.total,1);assert.equal(documents.items[0].id,second);assert.equal(documents.page.hasMore,false);
  await assert.rejects(()=>archivedRecords(f.env,1,recent.page.nextCursor!,'','document'),code('INVALID_CURSOR'));
  await assert.rejects(()=>archivedRecords(f.env,1,recent.page.nextCursor!,'other'),code('INVALID_CURSOR'));
  await assert.rejects(()=>archivedRecords(f.env,1,recent.page.nextCursor!,'','','name'),code('INVALID_CURSOR'));
  const response=await f.request('/archives?kind=document&sort=name');
  assert.equal(response.status,200);assert.equal((await response.json() as {total:number}).total,1);
  assert.equal((await f.request('/archives?sort=unsafe')).status,400);
 }finally{f.db.close();}
});

test('archive and restore accept D1 change counts that include task visibility triggers',async()=>{
 const f=fixture();
 try{
  const id=await f.list('Task archive',[task('Retained task')]);
  const batch=f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch=(async(statements:D1PreparedStatement[])=>{
   const result=await batch(statements);
   if(result[0]?.meta?.changes)result[0].meta.changes++;
   return result;
  }) as typeof f.env.DB.batch;
  const archived=await updateMeta(f.env,id,{status:'archived',expectedMetadataRevision:1});
  assert.equal(archived.metadataRevision,2);
  const restored=await updateMeta(f.env,id,{status:'active',expectedMetadataRevision:2});
  assert.equal(restored.metadataRevision,3);
  assert.equal((await getTasks(f.env,id)).items.length,1);
 }finally{f.db.close();}
});

test('board-order migration backfills the prior global canonical order with spaced ranks',async()=>{
  const db=new DatabaseSync(':memory:'),directory=new URL('../migrations/',import.meta.url);
  try{
    const migrations=readdirSync(directory).filter(name=>name.endsWith('.sql')).sort();
    for(const name of migrations.filter(name=>name<'0017_task_board_order.sql'))db.exec(readFileSync(new URL(name,directory),'utf8'));
    const insertList=(id:string,manual:boolean,tasks:Task[])=>{
      const content=JSON.stringify({tasks,...(manual?{taskOrder:'manual'}:{})});
      db.prepare("INSERT INTO records(id,name,kind,status,created_at,updated_at) VALUES(?,?,'task_list','active','x','x')").run(id,id);
      db.prepare("INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,1,'x')").run(id,content);
      db.prepare("INSERT INTO record_histories(record_id,history_metadata) VALUES(?,'{}')").run(id);
      tasks.forEach((item,position)=>db.prepare("INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,'x')")
        .run(item.id,id,item.title,item.details,item.status,item.priority,position));
    };
    insertList('a',false,[{...task('Low','todo',0),id:'low'},{...task('High','todo',5),id:'high'}]);
    insertList('b',true,[{...task('Manual'),id:'manual'}]);
    db.exec(readFileSync(new URL('0017_task_board_order.sql',directory),'utf8'));
    assert.deepEqual(db.prepare('SELECT task_id,position FROM task_board_order ORDER BY position').all().map(row=>({...row})),[
      {task_id:'high',position:1024},{task_id:'low',position:2048},{task_id:'manual',position:3072}
    ]);
  }finally{db.close();}
});

test('unchanged content still executes explicitly supplied atomic statements',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const id=await f.list('Before',[task('Task')]),row=await getRecord(f.env,id);
  const result=await commitContent(f.env,row,row.content,1,'Rank only','test',undefined,undefined,[
    f.env.DB.prepare('UPDATE records SET name=? WHERE id=?').bind('After',id)
  ]);
  assert.equal(result.changed,false);assert.equal(result.revision,1);
  assert.equal((f.db.prepare('SELECT name FROM records WHERE id=?').get(id) as {name:string}).name,'After');
});

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

test('global board order crosses task lists without changing ownership or canonical content',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const a=task('A'),c=task('C'),b=task('B'),d=task('D');
  const first=await f.list('First',[a,c]),second=await f.list('Second',[b,d]);
  const before=(await getRecord(f.env,first)).content;
  const moved=await taskOperation(f.env,first,1,'board_reorder',a.id,{status:'todo'},'test',{beforeTaskId:d.id});
  assert.equal(moved.revision,1);assert.equal(moved.changed,false);
  assert.equal(moved.boardOrder!.beforeTaskId,d.id);assert.equal(moved.boardOrder!.rebalanced,undefined);
  assert.equal((await getRecord(f.env,first)).content,before);
  assert.equal((await getTaskItem(f.env,a.id)).item.recordId,first);
  assert.deepEqual((await getTaskView(f.env,{statuses:['todo'],order:'board'})).items.map(item=>item.id),[c.id,b.id,a.id,d.id]);
  assert.deepEqual((await getTaskView(f.env,{recordId:first})).items.map(item=>item.id),[c.id,a.id]);
  const page1=await getTaskView(f.env,{statuses:['todo'],order:'board',limit:2});
  const page2=await getTaskView(f.env,{statuses:['todo'],order:'board',limit:2,cursor:page1.page.nextCursor!});
  assert.deepEqual([...page1.items,...page2.items].map(item=>item.id),[c.id,b.id,a.id,d.id]);
  assert.equal(new Set([...page1.items,...page2.items].map(item=>item.boardPosition)).size,4);
  assert.equal(second,(await getTaskItem(f.env,d.id)).item.recordId);
  const canonical=await taskOperation(f.env,first,1,'reorder',c.id,{},'test',{beforeTaskId:a.id});
  assert.equal(canonical.revision,1);
  assert.deepEqual((await getTaskView(f.env,{statuses:['todo'],order:'board'})).items.map(item=>item.id),[b.id,c.id,a.id,d.id]);
});

test('board status changes commit with rank atomically and invalid or stale anchors write nothing',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const source=task('Source'),todo=task('Todo'),done=task('Done','done');
  const first=await f.list('First',[source]),second=await f.list('Second',[todo,done]);
  const invalidRank=f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(source.id) as {position:number};
  await assert.rejects(taskOperation(f.env,first,1,'board_reorder',source.id,{status:'unknown' as TaskStatus},'test',{beforeTaskId:null}),code('INVALID_TASK'));
  await assert.rejects(taskOperation(f.env,first,1,'board_reorder',source.id,{status:'todo'},'test',{beforeTaskId:done.id}),code('INVALID_TASK_ORDER'));
  assert.equal((f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(source.id) as {position:number}).position,invalidRank.position);
  assert.equal((await getRecord(f.env,first)).revision,1);
  const moved=await taskOperation(f.env,first,1,'board_reorder',source.id,{status:'done'},'test',{beforeTaskId:done.id});
  assert.equal(moved.revision,2);assert.equal(moved.tasks.find(item=>item.id===source.id)!.status,'done');
  assert.deepEqual((await getTaskView(f.env,{statuses:['done'],order:'board'})).items.map(item=>item.id),[source.id,done.id]);
  await assert.rejects(taskOperation(f.env,first,1,'board_reorder',source.id,{status:'done'},'test',{beforeTaskId:null}),code('VERSION_CONFLICT'));
  assert.equal(second,(await getTaskItem(f.env,done.id)).item.recordId);
});

test('board batch guards reject gap, anchor and revision races after the rank plan was read',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const source=task('Source'),anchor=task('Anchor','in_progress'),contender=task('Contender','in_progress');
  const first=await f.list('First',[source]),second=await f.list('Second',[anchor,contender]);
  const sourceRank=(f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(source.id) as {position:number}).position;
  const anchorRank=(f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(anchor.id) as {position:number}).position;
  const contenderRank=(f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(contender.id) as {position:number}).position;
  const originalBatch=f.env.DB.batch.bind(f.env.DB);let raced=false;
  (f.env.DB as any).batch=async(statements:D1PreparedStatement[])=>{
    if(!raced){raced=true;f.db.prepare('UPDATE task_board_order SET position=? WHERE task_id=?').run(anchorRank-512,contender.id);f.db.exec('UPDATE task_order_state SET version=version+1 WHERE id=1');}
    return originalBatch(statements);
  };
  await assert.rejects(taskOperation(f.env,first,1,'board_reorder',source.id,{status:'in_progress'},'test',{beforeTaskId:anchor.id}),code('ORDER_VERSION_CONFLICT'));
  assert.equal((f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(source.id) as {position:number}).position,sourceRank);

  f.db.prepare('UPDATE task_board_order SET position=? WHERE task_id=?').run(contenderRank,contender.id);raced=false;
  (f.env.DB as any).batch=async(statements:D1PreparedStatement[])=>{
    if(!raced){raced=true;f.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(anchor.id);f.db.exec('UPDATE task_order_state SET version=version+1 WHERE id=1');}
    return originalBatch(statements);
  };
  await assert.rejects(taskOperation(f.env,first,1,'board_reorder',source.id,{status:'in_progress'},'test',{beforeTaskId:anchor.id}),code('ORDER_VERSION_CONFLICT'));
  assert.equal((await getRecord(f.env,first)).revision,1);
  assert.equal((await getTaskItem(f.env,source.id)).item.status,'todo');
  assert.equal((f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(source.id) as {position:number}).position,sourceRank);
  assert.equal(second,(await getTaskItem(f.env,anchor.id)).item.recordId);

  f.db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(anchor.id);raced=false;
  (f.env.DB as any).batch=async(statements:D1PreparedStatement[])=>{
    if(!raced){
      raced=true;
      f.db.prepare('UPDATE record_contents SET revision=revision+1 WHERE record_id=?').run(first);
      f.db.prepare("INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,2,'race','Concurrent','test','2026-11-15')").run(first);
    }
    return originalBatch(statements);
  };
  await assert.rejects(taskOperation(f.env,first,1,'board_reorder',source.id,{status:'in_progress'},'test',{beforeTaskId:anchor.id}),code('VERSION_CONFLICT'));
  assert.equal((f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(source.id) as {position:number}).position,sourceRank);
});

test('board rank precision exhaustion rebalances the target status and reports it',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const source=task('Source'),previous=task('Previous'),anchor=task('Anchor');
  const id=await f.list('Ranks',[source,previous,anchor]);
  f.db.prepare('UPDATE task_board_order SET position=? WHERE task_id=?').run(1,previous.id);
  f.db.prepare('UPDATE task_board_order SET position=? WHERE task_id=?').run(1.0000000000000002,anchor.id);
  f.db.prepare('UPDATE task_board_order SET position=? WHERE task_id=?').run(4096,source.id);
  const moved=await taskOperation(f.env,id,1,'board_reorder',source.id,{status:'todo'},'test',{beforeTaskId:anchor.id});
  assert.equal(moved.boardOrder!.rebalanced,true);
  assert.deepEqual((await getTaskView(f.env,{statuses:['todo'],order:'board'})).items.map(item=>item.id),[previous.id,source.id,anchor.id]);
  const ranks=f.db.prepare('SELECT position FROM task_board_order ORDER BY position').all() as Array<{position:number}>;
  assert.ok(ranks.every((row,index)=>index===0||row.position>ranks[index-1]!.position));
});

test('legacy pure reorder checks the content revision inside its rank transaction',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const first=task('First'),second=task('Second');const id=await f.list('Race',[first,second]);
  const originalRank=(f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(first.id) as {position:number}).position;
  const originalBatch=f.env.DB.batch.bind(f.env.DB);let raced=false;
  const racingBatch=async(statements:D1PreparedStatement[])=>{
    if(!raced){
      raced=true;(f.env.DB as any).batch=originalBatch;
      try{
        const row=await getRecord(f.env,id),parsed=JSON.parse(row.content) as {tasks:Task[]};
        parsed.tasks[1]={...parsed.tasks[1]!,title:'Concurrent title'};
        await commitContent(f.env,row,JSON.stringify(parsed,null,2),1,'Concurrent edit','test',parsed.tasks);
      }finally{(f.env.DB as any).batch=racingBatch;}
    }
    return originalBatch(statements);
  };
  (f.env.DB as any).batch=racingBatch;
  await assert.rejects(taskOperation(f.env,id,1,'reorder',first.id,{},'test',{beforeTaskId:null}),code('VERSION_CONFLICT'));
  assert.equal((f.db.prepare('SELECT position FROM task_board_order WHERE task_id=?').get(first.id) as {position:number}).position,originalRank);
});

test('task-list visibility races invalidate rank plans and batch owner snapshots',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const source=task('Source'),anchor=task('Anchor');const first=await f.list('First',[source]),second=await f.list('Second',[anchor]);
  const before=(await getTaskView(f.env)).orderVersion,originalBatch=f.env.DB.batch.bind(f.env.DB);let raced=false;
  const archiveAnchor=async(statements:D1PreparedStatement[])=>{
    if(!raced){
      raced=true;(f.env.DB as any).batch=originalBatch;
      try{await updateMeta(f.env,second,{status:'archived',expectedMetadataRevision:1},'test');}
      finally{(f.env.DB as any).batch=archiveAnchor;}
    }
    return originalBatch(statements);
  };
  (f.env.DB as any).batch=archiveAnchor;
  await assert.rejects(taskOperation(f.env,first,1,'board_reorder',source.id,{status:'todo'},'test',{beforeTaskId:anchor.id}),code('ORDER_VERSION_CONFLICT'));
  assert.equal((await getTaskView(f.env)).orderVersion,before+1);

  const thirdTask=task('Third'),third=await f.list('Third',[thirdTask]);raced=false;let batchCalls=0;
  const archiveOwner=async(statements:D1PreparedStatement[])=>{
    batchCalls++;
    if(!raced&&batchCalls===2){
      raced=true;(f.env.DB as any).batch=originalBatch;
      try{await updateMeta(f.env,third,{status:'archived',expectedMetadataRevision:1},'test');}
      finally{(f.env.DB as any).batch=archiveOwner;}
    }
    return originalBatch(statements);
  };
  (f.env.DB as any).batch=archiveOwner;
  await assert.rejects(mutateTasks(f.env,{requestId:'archive-race',expectedRevisions:{[third]:1},operations:[
    {op:'update',taskId:thirdTask.id,changes:{title:'Must not write archived'}}
  ]},'test'),code('METADATA_CONFLICT'));
  assert.equal((await getRecord(f.env,third)).revision,1);
});

test('independent legacy task creates append concurrently without false path conflicts',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const lists=await Promise.all(Array.from({length:5},(_,index)=>f.list('Concurrent '+index)));
  const results=await Promise.all(lists.map((id,index)=>taskOperation(f.env,id,1,'add',undefined,{title:'Task '+index},'test')));
  assert.ok(results.every(result=>result.revision===2));
  const view=await getTaskView(f.env);
  assert.equal(view.items.length,5);assert.equal(new Set(view.items.map(item=>item.boardPosition)).size,5);
});

test('the unified rank ignores legacy priority and survives edits and history restore',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const low=task('Low','todo',-3),high=task('High','todo',8),middle=task('Middle','blocked',2);
  const id=await f.list('Ordering',[low,high,middle]);
  assert.deepEqual((await getTaskView(f.env,{recordId:id})).items.map(x=>x.id),[low.id,high.id,middle.id]);
  const moved=await taskOperation(f.env,id,1,'reorder',low.id,{status:'in_progress'},'test',{beforeTaskId:middle.id});
  assert.equal(moved.revision,2);assert.deepEqual(moved.tasks.map(x=>x.id),[low.id,high.id,middle.id]);
  assert.equal(moved.tasks[0]!.status,'in_progress');
  assert.deepEqual((await getTaskView(f.env,{statuses:['in_progress'],order:'board'})).items.map(x=>x.id),[low.id]);
  const saved=JSON.parse((await getRecord(f.env,id)).content);assert.equal(saved.taskOrder,undefined);
  assert.deepEqual(f.db.prepare('SELECT id,position FROM tasks WHERE record_id=? ORDER BY position').all(id).map(x=>[x.id,x.position]),[[low.id,0],[high.id,1],[middle.id,2]]);
  await taskOperation(f.env,id,2,'update',middle.id,{title:'Renamed',details:'Keep this',priority:10},'test');
  assert.deepEqual((await getTaskView(f.env,{recordId:id})).items.map(x=>x.id),[high.id,low.id,middle.id]);
  const added=await taskOperation(f.env,id,3,'add',undefined,{title:'New','priority':10},'test');
  assert.equal((await getTaskView(f.env,{recordId:id})).items.at(-1)!.id,added.tasks.at(-1)!.id);
  await restoreRecord(f.env,id,1,4,'test');
  assert.equal((await getTaskLists(f.env,{recordId:id})).items[0]!.order,'manual');
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
  assert.equal((await f.request('/tasks/view?order=board&statuses=todo')).status,200);
  assert.equal((await f.request('/tasks/view?order=recent')).status,400);
  assert.equal((await f.request('/tasks/view?statuses=open')).status,400);
  assert.equal((await f.request('/task-lists?recordId='+id+'&folderId='+crypto.randomUUID())).status,400);
  assert.equal((await f.request('/tasks?status=open')).status,400);
  const exact=await f.request('/tasks/'+b.id);assert.equal(exact.status,200);assert.equal(((await exact.json()) as any).item.title,'Beta');
  assert.equal((await f.request('/tasks/'+crypto.randomUUID())).status,404);
  const base={recordId:id,expectedRevision:1,action:'reorder',taskId:a.id};
  assert.equal((await f.request('/tasks/mutate',base)).status,400);
  const moved=await f.request('/tasks/mutate',{...base,beforeTaskId:null,changes:{status:'done',details:'Edited in Drawer'}});
  assert.equal(moved.status,200);assert.equal(((await moved.json()) as any).revision,2);
  const board=await f.request('/tasks/mutate',{...base,action:'board_reorder',expectedRevision:2,beforeTaskId:b.id,changes:{status:'done'}});
  assert.equal(board.status,200);assert.equal(((await board.json()) as any).boardOrder.beforeTaskId,b.id);
  assert.equal((await f.request('/tasks/mutate',{...base,action:'board_reorder',expectedRevision:2,beforeTaskId:b.id,changes:{status:'done',title:'No'}})).status,400);
  assert.equal((await f.request('/tasks/mutate',{...base,beforeTaskId:null})).status,409);
  const legacy=await f.request('/tasks?recordId='+id+'&limit=1');const old=await legacy.json() as any;
  assert.equal(old.items.length,1);assert.equal(old.page.hasMore,true);assert.equal('list'in old.items[0],false);
});

test('manual ordering preserves imported priority values and deleting a task remains recoverable',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const imported=task('Imported','todo',100,'x'.repeat(50001)),normal=task('Normal');const id=await f.list('Compatible',[normal,imported]);
  await taskOperation(f.env,id,1,'reorder',normal.id,{},'test',{beforeTaskId:null});
  const unchanged=await taskOperation(f.env,id,1,'reorder',normal.id,{},'test',{beforeTaskId:null});
  assert.equal(unchanged.changed,false);assert.equal(unchanged.revision,1);
  const removed=await taskOperation(f.env,id,1,'remove',imported.id,{},'test');assert.equal(removed.revision,2);
  assert.equal(f.db.prepare('SELECT task_id FROM task_board_order WHERE task_id=?').get(imported.id),undefined);
  await assert.rejects(getTaskItem(f.env,imported.id),code('TASK_NOT_FOUND'));
  await restoreRecord(f.env,id,1,2,'test');
  const item=(await getTaskItem(f.env,imported.id)).item;
  assert.ok(Number.isFinite(item.boardPosition));
  assert.equal(item.priority,100);assert.equal(item.position,1);assert.equal(item.list.order,'manual');
  assert.equal(item.details.length,50001,'imported content outside current edit limits is not discarded by a reorder');
});

test('mutateTasks stages cross-owner projection swaps and keeps retries idempotent',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const a=task('A'),b=task('B');const first=await f.list('First',[a]),second=await f.list('Second',[b]);
  const before=await getTaskView(f.env);
  const input={requestId:'swap-owners',expectedRevisions:{[first]:1,[second]:1},expectedOrderVersion:before.orderVersion,operations:[
    {op:'update' as const,taskId:b.id,changes:{title:'B updated'}},
    {op:'transfer' as const,taskId:a.id,targetRecordId:second},
    {op:'transfer' as const,taskId:b.id,targetRecordId:first}
  ]};
  const result=await mutateTasks(f.env,input,'test');
  assert.deepEqual(result.revisions,{[second]:2,[first]:2});
  assert.equal(result.orderVersion,before.orderVersion+1);
  assert.equal((await getTaskItem(f.env,a.id)).item.recordId,second);
  assert.equal((await getTaskItem(f.env,b.id)).item.recordId,first);
  assert.equal((await getTaskItem(f.env,b.id)).item.title,'B updated');
  assert.deepEqual(await mutateTasks(f.env,input,'test'),result);
  await assert.rejects(mutateTasks(f.env,{...input,operations:[{op:'delete',taskId:a.id}]},'test'),code('IDEMPOTENCY_CONFLICT'));

  const failed={requestId:'partial-failure',expectedRevisions:{[second]:2},operations:[
    {op:'update' as const,taskId:a.id,changes:{title:'Must roll back'}},
    {op:'transfer' as const,taskId:a.id,targetRecordId:crypto.randomUUID()}
  ]};
  await assert.rejects(mutateTasks(f.env,failed,'test'),code('RECORD_NOT_FOUND'));
  assert.equal((await getTaskItem(f.env,a.id)).item.title,'A');
  assert.equal((await getRecord(f.env,second)).revision,2);
});

test('restoring a historical UUID transferred to another owner returns a task conflict',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const moved=task('Moved');const first=await f.list('First',[moved]),second=await f.list('Second');
  const orderVersion=(await getTaskView(f.env)).orderVersion;
  await mutateTasks(f.env,{requestId:'transfer-before-restore',expectedRevisions:{[first]:1,[second]:1},expectedOrderVersion:orderVersion,operations:[
    {op:'transfer',taskId:moved.id,targetRecordId:second}
  ]},'test');
  await assert.rejects(restoreRecord(f.env,first,1,2,'test'),code('TASK_ID_CONFLICT'));
  assert.equal((await getTaskItem(f.env,moved.id)).item.recordId,second);
  assert.equal((await getRecord(f.env,first)).revision,2);
});

test('mutateTasks guards pure placement revisions and task query cursors track content changes',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const a=task('A'),b=task('B');const first=await f.list('First',[a]),second=await f.list('Second',[b]);
  const page=await getTaskView(f.env,{limit:1,order:'updated'});
  const titled=await mutateTasks(f.env,{requestId:'title-only',expectedRevisions:{[second]:1},operations:[
    {op:'update',taskId:b.id,changes:{title:'B renamed'}}
  ]},'test');
  assert.equal(titled.orderVersion,page.orderVersion);
  await assert.rejects(getTaskView(f.env,{limit:1,order:'updated',cursor:page.page.nextCursor!}),code('ORDER_VERSION_CONFLICT'));
  assert.deepEqual((await getTaskView(f.env,{statuses:[]})).items,[]);

  const current=await getTaskView(f.env);
  await assert.rejects(mutateTasks(f.env,{requestId:'missing-anchor-owner-version',expectedRevisions:{[first]:1},expectedOrderVersion:current.orderVersion,operations:[
    {op:'place',taskId:a.id,beforeTaskId:b.id}
  ]},'test'),code('VERSION_CONFLICT'));

  const originalBatch=f.env.DB.batch.bind(f.env.DB);let raced=false;
  (f.env.DB as any).batch=async(statements:D1PreparedStatement[])=>{
    if(!raced){raced=true;f.db.prepare('UPDATE record_contents SET revision=revision+1 WHERE record_id=?').run(first);}
    return originalBatch(statements);
  };
  await assert.rejects(mutateTasks(f.env,{requestId:'place-race',expectedRevisions:{[first]:1,[second]:2},expectedOrderVersion:current.orderVersion,operations:[
    {op:'place',taskId:a.id,beforeTaskId:b.id}
  ]},'test'),code('VERSION_CONFLICT'));
  assert.deepEqual((await getTaskView(f.env)).items.map(item=>item.id),[a.id,b.id]);
});

test('MCP task tools query, read and atomically transfer/update/place without legacy priority',async(t)=>{
  const f=fixture();t.after(()=>f.db.close());
  const a=task('First'),b=task('Second');const first=await f.list('MCP A',[a]),second=await f.list('MCP B',[b]);
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
    const queryResponse=await request('tools/call',{name:'query_tasks',arguments:{order:'manual'}});
    const queried=JSON.parse(queryResponse.result.content[0].text);
    assert.deepEqual(queried.items.map((item:any)=>item.id),[a.id,b.id]);
    assert.ok(queried.items.every((item:any)=>!('priority'in item)&&typeof item.position==='number'));
    const readResponse=await request('tools/call',{name:'read_tasks',arguments:{ids:[b.id,a.id,crypto.randomUUID()]}});
    const read=JSON.parse(readResponse.result.content[0].text);
    assert.deepEqual(read.items.map((item:any)=>item.id),[b.id,a.id]);assert.equal(read.missingIds.length,1);
    assert.ok(read.items.every((item:any)=>!('priority'in item)));

    const mutation={requestId:'mcp-transfer',expectedRevisions:{[first]:1,[second]:1},expectedOrderVersion:queried.orderVersion,operations:[
      {op:'transfer',taskId:a.id,targetRecordId:second},
      {op:'update',taskId:a.id,changes:{title:'Moved and done',status:'done'}},
      {op:'place',taskId:a.id,beforeTaskId:b.id,scope:{recordId:second}}
    ]};
    const moved=await request('tools/call',{name:'mutate_tasks',arguments:mutation});
    assert.equal(moved.error,undefined);assert.equal(moved.result.isError,undefined);
    const result=JSON.parse(moved.result.content[0].text);
    assert.deepEqual(result.revisions,{[first]:2,[second]:2});assert.equal(result.orderVersion,queried.orderVersion+1);
    assert.equal(result.items[0].recordId,second);assert.equal(result.items[0].title,'Moved and done');
    assert.equal(result.items[0].status,'done');assert.equal(typeof result.items[0].position,'number');assert.equal('priority'in result.items[0],false);
    const retry=await request('tools/call',{name:'mutate_tasks',arguments:mutation});
    assert.deepEqual(JSON.parse(retry.result.content[0].text),result);

    const failed=await request('tools/call',{name:'mutate_tasks',arguments:{requestId:'mcp-partial',expectedRevisions:{[second]:2},operations:[
      {op:'update',taskId:b.id,changes:{title:'Should not persist'}},
      {op:'transfer',taskId:a.id,targetRecordId:crypto.randomUUID()}
    ]}});
    assert.equal(failed.result.isError,true);
    assert.equal((await getTaskItem(f.env,b.id)).item.title,'Second');assert.equal((await getRecord(f.env,second)).revision,2);
  } finally {await client.close();await server.close();}
});
