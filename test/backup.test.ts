import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {exportSnapshot,importSnapshot,pageHash,type SnapshotPage} from '../src/backup.js';
import {initialVersion,sha256} from '../src/version.js';
import {saveCollection} from '../src/collections.js';
import {collectionRuleSchema} from '../src/collection-model.js';
import {createTag} from '../src/tags/mutations.js';
import type {Env} from '../src/types.js';

function fixture(){
 const db=new DatabaseSync(':memory:'),directory=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(new URL(file,directory),'utf8'));
 class Statement{
  values:(string|number|null)[]=[];
  constructor(readonly sql:string){}
  bind(...values:(string|number|null)[]){this.values=values;return this;}
  async first(){return db.prepare(this.sql).get(...this.values)??null;}
  async all(){return {results:db.prepare(this.sql).all(...this.values)};}
  async run(){return {meta:{changes:Number(db.prepare(this.sql).run(...this.values).changes)}};}
 }
 const env={DB:{prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{
  db.exec('BEGIN');
  try{
   const results=[];
   for(const statement of statements){
    const prepared=db.prepare(statement.sql);
    if(/^\s*(SELECT|WITH)/i.test(statement.sql))results.push({results:prepared.all(...statement.values)});
    else results.push({results:[],meta:{changes:Number(prepared.run(...statement.values).changes)}});
   }
   db.exec('COMMIT');return results;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }}} as unknown as Env;
 async function record(name:string,content:string,kind='document',status='active'){
  const id=crypto.randomUUID(),hash=await sha256(content),date='2026-11-15T10:00:00.000Z';
  db.prepare('INSERT INTO records(id,name,kind,status,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,name,kind,status,'',date,date);
  db.prepare('INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,1,?)').run(id,content,hash);
  db.prepare('INSERT INTO record_histories(record_id,history_metadata) VALUES(?,?)').run(id,initialVersion(content).metadata);
  db.prepare('INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,1,?,?,?,?)').run(id,hash,'Created','test',date);
  return id;
 }
 async function list(name:string,titles:string[],status='active'){
  const tasks=titles.map(title=>({id:crypto.randomUUID(),title,details:'Details '+title,status:'todo',priority:0}));
  const id=await record(name,JSON.stringify({tasks},null,2),'task_list',status);
  for(const [index,task] of tasks.entries()){
   db.prepare('INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(task.id,id,task.title,task.details,task.status,0,index,'2026-11-15');
   db.prepare('INSERT INTO task_board_order(task_id,record_id,position) VALUES(?,?,?)').run(task.id,id,1024*(index+1));
  }
  return {id,tasks};
 }
 return {db,env,record,list};
}
async function backup(env:Env){
 const pages:SnapshotPage[]=[];let cursor:string|null=null;
 do{const page=await exportSnapshot(env,cursor,1);pages.push(page);cursor=page.nextCursor;}while(cursor);
 return {pages};
}
const rows=(db:DatabaseSync,sql:string)=>db.prepare(sql).all().map(row=>({...row}));
const fails=(code:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===code);

test('snapshot v5 roundtrips interleaved task order, Wiki identities and tombstones atomically',async()=>{
 const source=fixture(),restored=fixture();
 try{
  const a=await source.list('A',['A1','A2']),b=await source.list('B',['B1']),archived=await source.list('Archived',['Z'],'archived');
  for(const [index,taskId] of [b.tasks[0]!.id,a.tasks[1]!.id,archived.tasks[0]!.id,a.tasks[0]!.id].entries())source.db.prepare('UPDATE task_board_order SET position=? WHERE task_id=?').run((index+1)*125.5,taskId);
  const target=await source.record('renamed.md','Target'),replacement=await source.record('dead.md','Replacement'),dead=crypto.randomUUID();
  const doc=await source.record('source.md','[[/old.md]] [[/dead.md]] [[id:'+target+']] [[/renamed.md]]');
  source.db.prepare('INSERT INTO record_path_bindings(source_id,target_expression,target_id) VALUES(?,?,?)').run(doc,'/old.md',target);
  source.db.prepare('INSERT INTO record_path_bindings(source_id,target_expression,target_id) VALUES(?,?,?)').run(doc,'/dead.md',dead);
  const bundle=await backup(source.env);
  assert.ok(bundle.pages.length>1);
  assert.ok(bundle.pages.every(page=>page.format==='recalloom-snapshot-v5'));
  const preview=await importSnapshot(restored.env,bundle,true);
  assert.equal(preview.taskOrder,4);assert.equal(preview.pathBindings,2);
  assert.equal(rows(restored.db,'SELECT id FROM records').length,0,'dryRun must leave all tables empty');
  await importSnapshot(restored.env,bundle,false);
  assert.deepEqual(rows(restored.db,'SELECT * FROM task_board_order ORDER BY position,task_id'),rows(source.db,'SELECT * FROM task_board_order ORDER BY position,task_id'));
  assert.deepEqual(rows(restored.db,'SELECT * FROM record_contents ORDER BY record_id'),rows(source.db,'SELECT * FROM record_contents ORDER BY record_id'));
  const refs=restored.db.prepare('SELECT target_expression,target_id,resolution_status FROM record_references WHERE source_id=? ORDER BY source_offset').all(doc);
  assert.deepEqual(refs.map(row=>({...row})),[
   {target_expression:'/old.md',target_id:target,resolution_status:'resolved'},
   {target_expression:'/dead.md',target_id:null,resolution_status:'missing'},
   {target_expression:'id:'+target,target_id:target,resolution_status:'resolved'},
   {target_expression:'/renamed.md',target_id:target,resolution_status:'resolved'}
  ]);
  assert.equal(restored.db.prepare('SELECT target_id FROM record_path_bindings WHERE source_id=? AND target_expression=?').get(doc,'/dead.md')?.target_id,dead);
  assert.notEqual(dead,replacement);
 }finally{source.db.close();restored.db.close();}
});

test('snapshot v5 validates order coverage and bindings before any import mutation',async()=>{
 const source=fixture(),target=fixture();
 try{
  await source.list('List',['Task']);
  const original=await backup(source.env),page=original.pages[0]!;
  assert.equal(page.format,'recalloom-snapshot-v5');if(page.format!=='recalloom-snapshot-v5')return;
  const missing={...page,taskOrder:[]};missing.pageHash=await pageHash(missing);
  await assert.rejects(importSnapshot(target.env,{pages:[missing]},false),fails('INVALID_SNAPSHOT_TASK_ORDER'));
  const invalid={...page,pathBindings:[{source_id:page.records[0]!.record.id,target_expression:'/x#anchor',target_id:crypto.randomUUID()}]};
  invalid.pageHash=await pageHash(invalid);
  await assert.rejects(importSnapshot(target.env,{pages:[invalid]},false),fails('INVALID_SNAPSHOT_PATH_BINDING'));
  assert.equal(rows(target.db,'SELECT id FROM records').length,0);
  const changed={...page,taskOrder:page.taskOrder.map(row=>({...row,position:99}))};
  await assert.rejects(importSnapshot(target.env,{pages:[changed]},false),fails('SNAPSHOT_INTEGRITY_ERROR'));
 }finally{source.db.close();target.db.close();}
});

test('snapshot export invalidates continuation after a rank-only order change',async()=>{
 const f=fixture();
 try{
  await f.record('one.md','one');await f.record('two.md','two');
  const first=await exportSnapshot(f.env,null,1);assert.ok(first.nextCursor);
  f.db.prepare('UPDATE task_order_state SET version=version+1 WHERE id=1').run();
  await assert.rejects(exportSnapshot(f.env,first.nextCursor,1),fails('SNAPSHOT_CHANGED'));
 }finally{f.db.close();}
});

test('snapshot v5 merges tasks after existing tasks while preserving both relative orders',async()=>{
 const source=fixture(),target=fixture();
 try{
  const imported=await source.list('Imported',['first','second','third']),existing=await target.list('Existing',['existing first','existing second']);
  for(const [index,taskId] of [imported.tasks[2]!.id,imported.tasks[0]!.id,imported.tasks[1]!.id].entries())
   source.db.prepare('UPDATE task_board_order SET position=? WHERE task_id=?').run((index+1)*0.25,taskId);
  const before=rows(target.db,'SELECT * FROM task_board_order ORDER BY position,task_id');
  await importSnapshot(target.env,await backup(source.env),false);
  const ordered=rows(target.db,'SELECT * FROM task_board_order ORDER BY position,task_id');
  assert.deepEqual(ordered.slice(0,2),before,'merge must preserve existing positions');
  assert.deepEqual(ordered.map(row=>row.task_id),[...existing.tasks.map(task=>task.id),imported.tasks[2]!.id,imported.tasks[0]!.id,imported.tasks[1]!.id]);
  assert.ok(Number(ordered[2]!.position)>Number(before[1]!.position));
 }finally{source.db.close();target.db.close();}
});

test('snapshot import rejects target path or rank changes after projection planning atomically',async()=>{
 for(const race of ['path','order']){
  const source=fixture(),target=fixture();
  try{
   const imported=await source.record('imported.md','[[/target.md]]'),existing=await target.record('target.md','Existing');
   const bundle=await backup(source.env),batch=target.env.DB.batch.bind(target.env.DB);
   let injected=false;
   target.env.DB.batch=async statements=>{
    if(!injected&&statements.some(statement=>(statement as unknown as {sql:string}).sql.startsWith('INSERT INTO records('))){
     injected=true;
     if(race==='path'){
      target.db.prepare('UPDATE records SET name=?,metadata_revision=metadata_revision+1 WHERE id=?').run('renamed.md',existing);
      target.db.prepare("INSERT INTO change_events(record_id,event_type,actor,created_at,entity_type,entity_id) VALUES(?,'rename','test','2026-11-15','record',?)").run(existing,existing);
     }else target.db.prepare('UPDATE task_order_state SET version=version+1 WHERE id=1').run();
    }
    return batch(statements);
   };
   await assert.rejects(importSnapshot(target.env,bundle,false),fails('IMPORT_CONFLICT'));
   assert.equal(injected,true);
   assert.equal(target.db.prepare('SELECT id FROM records WHERE id=?').get(imported),undefined);
   assert.equal(rows(target.db,'SELECT * FROM record_path_bindings').length,0,'stale identities must not be pinned');
   assert.equal(rows(target.db,'SELECT * FROM record_references').length,0);
   assert.equal(rows(target.db,'SELECT id FROM records').length,1);
  }finally{source.db.close();target.db.close();}
 }
});

test('snapshot v5 preserves smart collection definitions, revisions and cross-record scopes',async()=>{
 const source=fixture(),target=fixture();
 try{
  const folder=crypto.randomUUID(),date='2026-11-18T08:00:00.000Z';
  source.db.prepare('INSERT INTO folders(id,parent_id,name,description,metadata_revision,created_at,updated_at) VALUES(?,NULL,?,?,1,?,?)').run(folder,'Research','',date,date);
  const document=await source.record('overview.md','Engineering notes');
  source.db.prepare('UPDATE records SET folder_id=? WHERE id=?').run(folder,document);
  const taskList=await source.list('Tasks',['Deliver']);
  const tag=(await createTag(source.env,{name:'Research',kind:'fixed'})).item;
  const documentRule=collectionRuleSchema.parse({version:1,target:'document',folder:{id:folder,name:'/Research'},tags:[{id:tag.id,name:tag.name}],tagMatch:'all',archive:'active',topic:'engineering'});
  const taskRule=collectionRuleSchema.parse({version:1,target:'task',taskList:{id:taskList.id,name:'/Tasks'},statuses:['todo']});
  const created=await saveCollection(source.env,{name:'Knowledge',description:'Document scope',rule:documentRule});
  await saveCollection(source.env,{name:'Knowledge v2',description:'Document scope',rule:documentRule},{id:created.id,revision:1});
  await saveCollection(source.env,{name:'Todo',description:'Task scope',rule:taskRule});
  const bundle=await backup(source.env);
  assert.ok(bundle.pages.length>1);
  assert.ok(bundle.pages.every(page=>page.format==='recalloom-snapshot-v5'));
  assert.equal(bundle.pages[0]!.format==='recalloom-snapshot-v5'&&bundle.pages[0]!.collections.length,2);
  assert.ok(bundle.pages.slice(1).every(page=>page.format==='recalloom-snapshot-v5'&&page.collections.length===0));
  const preview=await importSnapshot(target.env,bundle,true);
  assert.equal(preview.collections,2);
  assert.equal(rows(target.db,'SELECT * FROM smart_collections').length,0,'dry run must not write collections');
  const result=await importSnapshot(target.env,bundle,false);
  assert.equal(result.collections,2);
  assert.deepEqual(rows(target.db,'SELECT * FROM smart_collections ORDER BY id'),rows(source.db,'SELECT * FROM smart_collections ORDER BY id'));
 }finally{source.db.close();target.db.close();}
});

test('snapshot v5 can restore a collection-only library and keeps unresolved references stable',async()=>{
 const source=fixture(),target=fixture();
 try{
  const missing=crypto.randomUUID();
  const rule=collectionRuleSchema.parse({version:1,target:'document',folder:{id:missing,name:'/Missing'},archive:'active'});
  const saved=await saveCollection(source.env,{name:'Orphan',description:'Preserve unresolved folder',rule});
  const bundle=await backup(source.env);
  assert.equal(bundle.pages.length,1);
  assert.equal(bundle.pages[0]!.totalRecords,0);
  assert.equal(bundle.pages[0]!.format==='recalloom-snapshot-v5'&&bundle.pages[0]!.collections.length,1);
  await importSnapshot(target.env,bundle,false);
  const restored=target.db.prepare('SELECT * FROM smart_collections WHERE id=?').get(saved.id)! as Record<string,unknown>;
  assert.equal(restored.revision,1);
  assert.equal((JSON.parse(String(restored.rule_json)) as typeof rule).folder?.id,missing);
 }finally{source.db.close();target.db.close();}
});

test('snapshot v5 remaps imported collection tag references when target reuses a tag name',async()=>{
 const source=fixture(),target=fixture();
 try{
  const sourceTag=(await createTag(source.env,{name:'Shared tag',kind:'fixed'})).item;
  const targetTag=(await createTag(target.env,{name:'Shared tag',kind:'fixed'})).item;
  assert.notEqual(sourceTag.id,targetTag.id);
  const rule=collectionRuleSchema.parse({version:1,target:'document',tags:[{id:sourceTag.id,name:'Previous label'}],archive:'active'});
  const saved=await saveCollection(source.env,{name:'Mapped',description:'',rule});
  await importSnapshot(target.env,await backup(source.env),false);
  const restored=target.db.prepare('SELECT rule_json FROM smart_collections WHERE id=?').get(saved.id) as {rule_json:string};
  const tags=(JSON.parse(restored.rule_json) as {tags?:Array<{id:string}>}).tags;
  assert.equal(tags?.[0]?.id,targetTag.id);
  assert.equal((tags?.[0] as {name?:string})?.name,'Shared tag','stale labels should resolve through the source tag ID');
 }finally{source.db.close();target.db.close();}
});

test('snapshot v5 invalidates paginated exports after collections are created, updated or deleted',async()=>{
 for(const change of ['create','update','delete'] as const){
  const f=fixture();
  try{
   await f.record('first.md','first');await f.record('second.md','second');
   const rule=collectionRuleSchema.parse({version:1,target:'document',archive:'active'});
   const saved=change==='create'?null:await saveCollection(f.env,{name:'Saved',description:'',rule});
   const first=await exportSnapshot(f.env,null,1);
   assert.ok(first.nextCursor);
   if(change==='create')await saveCollection(f.env,{name:'New',description:'',rule});
   else if(change==='update')await saveCollection(f.env,{name:'Updated',description:'',rule},{id:saved!.id,revision:saved!.revision});
   else await f.env.DB.prepare('DELETE FROM smart_collections WHERE id=?').bind(saved!.id).run();
   await assert.rejects(exportSnapshot(f.env,first.nextCursor,1),fails('SNAPSHOT_CHANGED'));
  }finally{f.db.close();}
 }
});

test('snapshot v5 checks collection integrity, rule validity and UUID conflicts before applying changes',async()=>{
 const source=fixture(),target=fixture();
 try{
  await source.record('import.md','content');
  const rule=collectionRuleSchema.parse({version:1,target:'document',archive:'active'});
  const collection=await saveCollection(source.env,{name:'Test',description:'',rule});
  const original=(await backup(source.env)).pages[0]!;
  assert.equal(original.format,'recalloom-snapshot-v5');
  if(original.format!=='recalloom-snapshot-v5')return;
  const changed={...original,collections:original.collections.map(row=>({...row,name:'Tampered'}))};
  changed.pageHash=await pageHash(changed);
  await assert.rejects(importSnapshot(target.env,{pages:[changed]},false),fails('INVALID_SNAPSHOT_COLLECTIONS'));
  const invalid={...original,collections:original.collections.map(row=>({...row,rule_json:'{"version":1,"target":"document","unexpected":true}'}))};
  invalid.collectionHash=await sha256(JSON.stringify(invalid.collections));
  invalid.pageHash=await pageHash(invalid);
  await assert.rejects(importSnapshot(target.env,{pages:[invalid]},false),fails('INVALID_SNAPSHOT_COLLECTIONS'));
  const duplicate={...original,collections:[...original.collections,...original.collections]};
  duplicate.collectionHash=await sha256(JSON.stringify(duplicate.collections));
  duplicate.pageHash=await pageHash(duplicate);
  await assert.rejects(importSnapshot(target.env,{pages:[duplicate]},false),fails('DUPLICATE_SNAPSHOT_ID'));
  const row=original.collections[0]!;
  target.db.prepare('INSERT INTO smart_collections(id,name,description,rule_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .run(row.id,row.name,row.description,row.rule_json,row.revision,row.created_at,row.updated_at);
  await assert.rejects(importSnapshot(target.env,{pages:[original]},false),fails('IMPORT_CONFLICT'));
  assert.equal(rows(target.db,'SELECT * FROM records').length,0,'conflict must not import records');
  assert.equal(rows(target.db,'SELECT * FROM smart_collections').length,1);
  assert.equal(collection.id,row.id);
 }finally{source.db.close();target.db.close();}
});

test('snapshot v4 bundles remain importable without smart collections',async()=>{
 const source=fixture(),target=fixture();
 try{
  const recordId=await source.record('legacy.md','legacy text');
  const rule=collectionRuleSchema.parse({version:1,target:'document',archive:'active'});
  await saveCollection(source.env,{name:'Not in v4',description:'',rule});
  const current=await backup(source.env),pages:SnapshotPage[]=[];
  for(const page of current.pages){
   assert.equal(page.format,'recalloom-snapshot-v5');
   if(page.format!=='recalloom-snapshot-v5')return;
   const {collections:_collections,collectionHash:_hash,pageHash:_pageHash,...fields}=page;
   const legacy={...fields,format:'recalloom-snapshot-v4' as const};
   pages.push({...legacy,pageHash:await pageHash(legacy)});
  }
  const result=await importSnapshot(target.env,{pages},false);
  assert.equal(result.collections,0);
  assert.equal(rows(target.db,'SELECT id FROM smart_collections').length,0);
  assert.ok(target.db.prepare('SELECT id FROM records WHERE id=?').get(recordId));
 }finally{source.db.close();target.db.close();}
});

test('legacy snapshot v2 remains importable and rebuilds references against all staged records',async()=>{
 const source=fixture(),target=fixture();
 try{
  await source.record('first.md','[[/second.md]]');const destination=await source.record('second.md','second');
  const current=await backup(source.env);
  const pages:SnapshotPage[]=[];
  for(const page of current.pages){
   const {format:_format,...base}=page;
   const payload={format:'recalloom-snapshot-v2' as const,watermark:base.watermark,totalRecords:base.totalRecords,cursor:base.cursor,nextCursor:base.nextCursor,folders:base.folders,records:base.records,links:base.links};
   pages.push({...payload,pageHash:await pageHash(payload)});
  }
  await importSnapshot(target.env,{pages},false);
  assert.equal(target.db.prepare('SELECT target_id FROM record_references').get()?.target_id,destination);
 }finally{source.db.close();target.db.close();}
});
