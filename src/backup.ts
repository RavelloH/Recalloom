import {ensureTagCatalog,catalogVersion,tagBatch} from './tags/catalog.js';
import {exportTagCatalog,planSnapshotTags} from './tags/snapshot.js';
import type {TagSnapshot} from './tag-model.js';
import {INDEX_JOB_UPSERT} from './index-queue.js';
import type { Env } from './types.js';
import { StorageError } from './types.js';
import { historicalVersion, sha256 } from './version.js';
import {snapshotProjections} from './snapshot-projections.js';
import {parseWikiTarget} from './wiki-syntax.js';

type AnyRow=Record<string,unknown>;
type SnapshotBase={
  watermark:number;
  totalRecords:number;
  cursor:string|null;
  nextCursor:string|null;
  folders:AnyRow[];
  records:Array<{record:AnyRow;revisions:AnyRow[];tags:string[]}>;
  links:AnyRow[];
  pageHash:string;
};
export type SnapshotPage=SnapshotBase&(
  {format:'recalloom-snapshot-v2'}|
  {format:'recalloom-snapshot-v3';orderVersion:number;taskOrder:AnyRow[];pathBindings:AnyRow[]}|
  {format:'recalloom-snapshot-v4';orderVersion:number;taskOrder:AnyRow[];pathBindings:AnyRow[];tagCatalogVersion:number;tagCatalog:TagSnapshot[]}
);
type SnapshotPayload=Omit<SnapshotBase,'pageHash'>&(
  {format:'recalloom-snapshot-v2'}|
  {format:'recalloom-snapshot-v3';orderVersion:number;taskOrder:AnyRow[];pathBindings:AnyRow[]}|
  {format:'recalloom-snapshot-v4';orderVersion:number;taskOrder:AnyRow[];pathBindings:AnyRow[];tagCatalogVersion:number;tagCatalog:TagSnapshot[]}
);
const fail=(code:string,message?:string):never=>{throw new StorageError(code,message);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(value:unknown):string=>typeof value==='string'&&uuid.test(value)?value:fail('INVALID_SNAPSHOT_ID');
const string=(value:unknown,max=500000):string=>typeof value==='string'&&value.length<=max?value:fail('INVALID_SNAPSHOT');
const name=(value:unknown):string=>{
  const v=string(value,180);
  if(!v.trim()||v!==v.trim()||v.includes('/')||v.includes('\\'))fail('INVALID_SNAPSHOT_NAME');
  return v;
};
const asArray=(v:unknown):unknown[]=>Array.isArray(v)?v:fail('INVALID_SNAPSHOT');
const maxSeq=async(env:Env)=>Number((await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS value FROM change_events').first<{value:number}>())?.value??0);
const orderVersion=async(env:Env)=>Number((await env.DB.prepare('SELECT version FROM task_order_state WHERE id=1').first<{version:number}>())?.version??0);
type SnapshotCursor={watermark:number;lastId:string;totalRecords:number;orderVersion:number;tagVersion:number};
const cursorEncode=(x:SnapshotCursor):string=>btoa(JSON.stringify(x));
const cursorDecode=(c:string):SnapshotCursor=>{
  try{
    const v=JSON.parse(atob(c)) as SnapshotCursor;
    if(!Number.isSafeInteger(v.watermark)||v.watermark<0||!uuid.test(v.lastId)||!Number.isSafeInteger(v.totalRecords)||v.totalRecords<0||!Number.isSafeInteger(v.orderVersion)||v.orderVersion<0||!Number.isSafeInteger(v.tagVersion)||v.tagVersion<0)throw Error();
    return v;
  }catch{return fail('INVALID_SNAPSHOT_CURSOR');}
};
export const pageHash=async(page:SnapshotPayload)=>sha256(JSON.stringify({format:page.format,watermark:page.watermark,totalRecords:page.totalRecords,cursor:page.cursor,nextCursor:page.nextCursor,folders:page.folders,records:page.records,links:page.links,
  ...(page.format!=='recalloom-snapshot-v2'?{orderVersion:page.orderVersion,taskOrder:page.taskOrder,pathBindings:page.pathBindings}:{}),
  ...(page.format==='recalloom-snapshot-v4'?{tagCatalogVersion:page.tagCatalogVersion,tagCatalog:page.tagCatalog}:{})}));

export async function exportSnapshot(env:Env,cursor:string|null=null,limit=2):Promise<SnapshotPage>{
  await ensureTagCatalog(env);
  const tagVersion=await catalogVersion(env);
  const pageSize=Math.min(5,Math.max(1,Math.floor(limit)));
  const state=cursor?cursorDecode(cursor):null;
  if(state&&state.tagVersion!==tagVersion)fail('SNAPSHOT_CHANGED','Tags changed during backup');
  const tagCatalog=state?[]:await exportTagCatalog(env);
  const watermark=state?.watermark??await maxSeq(env);
  const version=state?.orderVersion??await orderVersion(env);
  if(await maxSeq(env)!==watermark||await orderVersion(env)!==version||await catalogVersion(env)!==tagVersion)fail('SNAPSHOT_CHANGED','Library changed during backup; restart the export');
  const totalRecords=state?.totalRecords??Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM records').first<{n:number}>())?.n??0);
  const lastId=state?.lastId??'';
  const [folders,recordRows]=await Promise.all([
    !state?env.DB.prepare('SELECT * FROM folders ORDER BY id').all():Promise.resolve({results:[] as AnyRow[]}),
    env.DB.prepare('SELECT r.*,c.content,c.revision,c.content_sha256,h.history_metadata FROM records r JOIN record_contents c ON c.record_id=r.id JOIN record_histories h ON h.record_id=r.id WHERE r.id>? ORDER BY r.id LIMIT ?')
      .bind(lastId,pageSize+1).all()
  ]);
  const selection=recordRows.results.slice(0,pageSize);
  const records:SnapshotPage['records']=[];
  for(const row of selection){
    const recordId=id(row.id);
    const [versions,tags]=await Promise.all([
      env.DB.prepare('SELECT v.* FROM revisions v WHERE v.record_id=? ORDER BY v.revision').bind(recordId).all(),
      env.DB.prepare('SELECT t.name FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=? ORDER BY t.name').bind(recordId).all()
    ]);
    records.push({record:row,revisions:versions.results,tags:tags.results.map(x=>String(x.name))});
  }
  const done=recordRows.results.length<=pageSize;
  const links=done?(await env.DB.prepare('SELECT * FROM record_links ORDER BY source_id,target_id,relation').all()).results:[];
  const selectedIds=JSON.stringify(selection.map(row=>row.id));
  const [taskOrder,pathBindings]=await Promise.all([
    env.DB.prepare('SELECT task_id,record_id,position FROM task_board_order WHERE record_id IN (SELECT value FROM json_each(?)) ORDER BY position,task_id').bind(selectedIds).all(),
    env.DB.prepare('SELECT source_id,target_expression,target_id FROM record_path_bindings WHERE source_id IN (SELECT value FROM json_each(?)) ORDER BY source_id,target_expression').bind(selectedIds).all()
  ]);
  if(await maxSeq(env)!==watermark||await orderVersion(env)!==version||await catalogVersion(env)!==tagVersion)fail('SNAPSHOT_CHANGED','Library changed while exporting; discard all pages');
  const nextCursor=done?null:cursorEncode({watermark,lastId:id(selection.at(-1)?.id),totalRecords,orderVersion:version,tagVersion});
  const payload={tagCatalog,tagCatalogVersion:tagVersion,format:'recalloom-snapshot-v4' as const,watermark,totalRecords,cursor,nextCursor,folders:folders.results,records,links,orderVersion:version,taskOrder:taskOrder.results,pathBindings:pathBindings.results};
  return {...payload,pageHash:await pageHash(payload)};
}

type ImportInput={pages:SnapshotPage[]};
export async function importSnapshot(env:Env,bundle:unknown,dryRun=true,actor='agent'){
  if(!bundle||typeof bundle!=='object'||!Array.isArray((bundle as ImportInput).pages))fail('INVALID_SNAPSHOT');
  const pages=(bundle as ImportInput).pages;
  if(pages.length<1||pages.length>100||JSON.stringify(bundle).length>6_000_000)fail('SNAPSHOT_TOO_LARGE');
  await ensureTagCatalog(env);
  const watermark=pages[0]?.watermark,expected=pages[0]?.totalRecords;
  const format=pages[0]?.format,version=pages[0]?.format!=='recalloom-snapshot-v2'?pages[0]?.orderVersion:undefined;
  let previous:string|null=null;
  const folders:AnyRow[]=[],records:SnapshotPage['records']=[],links:AnyRow[]=[],taskOrder:AnyRow[]=[],pathBindings:AnyRow[]=[];
  for(const [index,page] of pages.entries()){
    if(!page||(page.format!=='recalloom-snapshot-v2'&&page.format!=='recalloom-snapshot-v3'&&page.format!=='recalloom-snapshot-v4')||page.format!==format||page.watermark!==watermark||page.totalRecords!==expected||
      page.cursor!==previous||page.pageHash!==await pageHash(page))fail('SNAPSHOT_INTEGRITY_ERROR');
    if(page.format==='recalloom-snapshot-v4'&&(!Number.isSafeInteger(page.tagCatalogVersion)||page.tagCatalogVersion!== (pages[0] as typeof page).tagCatalogVersion||!Array.isArray(page.tagCatalog)||index>0&&page.tagCatalog.length))fail('INVALID_SNAPSHOT_TAGS');
    if(page.format!=='recalloom-snapshot-v2'){
      if(!Number.isSafeInteger(page.orderVersion)||page.orderVersion<0||page.orderVersion!==version)fail('SNAPSHOT_INTEGRITY_ERROR');
      const pageRecords=new Set(asArray(page.records).map(item=>id((item as {record:AnyRow}).record.id)));
      const ranks=asArray(page.taskOrder) as AnyRow[],pins=asArray(page.pathBindings) as AnyRow[];
      if(ranks.some(row=>!pageRecords.has(id(row.record_id)))||pins.some(row=>!pageRecords.has(id(row.source_id))))fail('INVALID_SNAPSHOT');
      taskOrder.push(...ranks);pathBindings.push(...pins);
    }
    if(index>0&&page.folders.length)fail('INVALID_SNAPSHOT');
    if(index<pages.length-1&&page.links.length)fail('INVALID_SNAPSHOT');
    folders.push(...asArray(page.folders) as AnyRow[]);
    records.push(...asArray(page.records) as SnapshotPage['records']);
    links.push(...asArray(page.links) as AnyRow[]);
    previous=page.nextCursor;
    if(index<pages.length-1&&!previous)fail('INVALID_SNAPSHOT');
  }
  if(previous!==null||!Number.isSafeInteger(expected)||expected<0||records.length!==expected)fail('INCOMPLETE_SNAPSHOT');
  if(folders.length>2000||records.length>300||links.length>3000)fail('SNAPSHOT_TOO_LARGE');
  const targetState=await env.DB.batch<AnyRow>([
    env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS value FROM change_events'),
    env.DB.prepare('SELECT version FROM task_order_state WHERE id=1'),
    env.DB.prepare('SELECT COUNT(*) AS count,COALESCE(MAX(position),0) AS position FROM task_board_order')
  ]);
  const targetSeq=Number(targetState[0]!.results[0]?.value??0),targetVersion=Number(targetState[1]!.results[0]?.version);
  const targetOrder=targetState[2]!.results[0]!,targetTaskCount=Number(targetOrder.count),targetLastPosition=Number(targetOrder.position);
  if(!Number.isSafeInteger(targetVersion))fail('TASK_ORDER_STATE_MISSING');
  const knownFolders=new Set(folders.map(f=>id(f.id)));
  if(knownFolders.size!==folders.length)fail('DUPLICATE_SNAPSHOT_ID');
  const knownRecords=new Set(records.map(v=>id(v.record.id)));
  if(knownRecords.size!==records.length)fail('DUPLICATE_SNAPSHOT_ID');
  const stagedNames=new Set<string>();
  const key=(parent:string|null,recordName:string)=>JSON.stringify([parent,recordName]);
  // Projection planning resolves existing paths. Reject any intervening library
  // change before those resolutions can become permanent path identities.
  const tagNames=records.flatMap(item=>{
    if(!item||!item.record||!Array.isArray(item.tags)||item.tags.some(tag=>typeof tag!=='string'))fail('INVALID_SNAPSHOT');
    return [...item.tags,...(item.record.kind==='checkpoint'?['checkpoint']:[])];
  });
  const tagPlan=await planSnapshotTags(env,format==='recalloom-snapshot-v4'?(pages[0] as Extract<SnapshotPage,{format:'recalloom-snapshot-v4'}>).tagCatalog:[],tagNames);
  const statements:D1PreparedStatement[]=[...tagPlan.statements,env.DB.prepare(`INSERT INTO task_order_state(id,version)
    SELECT 1,0 WHERE (SELECT COALESCE(MAX(seq),0) FROM change_events)<>?
      OR NOT EXISTS (SELECT 1 FROM task_order_state WHERE id=1 AND version=?)`).bind(targetSeq,targetVersion)];
  // Full validation before the first mutation. Existing DB uniqueness and foreign
  // keys are checked here, not merely when the write batch is executed.
  for(const item of folders){
    const folderId=id(item.id),parent=item.parent_id===null?null:id(item.parent_id),folderName=name(item.name);
    string(item.description,5000);
    if(parent===folderId)fail('INVALID_FOLDER_HIERARCHY');
    if(await env.DB.prepare('SELECT 1 FROM folders WHERE id=?').bind(folderId).first())fail('IMPORT_CONFLICT','Folder ID already exists');
    if(parent&&!knownFolders.has(parent)&&!(await env.DB.prepare('SELECT 1 FROM folders WHERE id=?').bind(parent).first()))fail('INVALID_FOLDER_HIERARCHY');
    const k=key(parent,folderName);
    if(stagedNames.has(k))fail('PATH_CONFLICT');
    stagedNames.add(k);
    const conflict=await env.DB.prepare('SELECT 1 FROM folders WHERE parent_id IS ? AND name=? UNION ALL SELECT 1 FROM records WHERE folder_id IS ? AND name=? LIMIT 1')
      .bind(parent,folderName,parent,folderName).first();
    if(conflict)fail('PATH_CONFLICT');
  }
  const order:AnyRow[]=[];
  const visited=new Set<string>(),active=new Set<string>();
  const byId=new Map(folders.map(f=>[id(f.id),f]));
  function visit(folderId:string){
    if(visited.has(folderId))return;
    if(active.has(folderId))fail('INVALID_FOLDER_HIERARCHY');
    active.add(folderId);
    const folder=byId.get(folderId)!;
    if(folder.parent_id&&byId.has(String(folder.parent_id)))visit(String(folder.parent_id));
    active.delete(folderId);visited.add(folderId);order.push(folder);
  }
  for(const fid of byId.keys())visit(fid);
  for(const folder of order){
    statements.push(env.DB.prepare('INSERT INTO folders(id,parent_id,name,description,metadata_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .bind(folder.id,folder.parent_id,folder.name,folder.description,folder.metadata_revision??1,folder.created_at,folder.updated_at));
    statements.push(event(env,'folder',id(folder.id),'restore',null,actor,{name:folder.name,parentId:folder.parent_id}));
  }
  const taskIds=new Set<string>();
  const taskOwners=new Map<string,string>();
  const validStates=new Set(['todo','in_progress','blocked','done','cancelled']);
  for(const item of records){
    if(!item||typeof item!=='object'||!item.record||!Array.isArray(item.revisions)||!Array.isArray(item.tags))fail('INVALID_SNAPSHOT');
    const row=item.record,recordId=id(row.id),folder=row.folder_id===null?null:id(row.folder_id),recordName=name(row.name);
    if(folder&&!knownFolders.has(folder)&&!(await env.DB.prepare('SELECT 1 FROM folders WHERE id=?').bind(folder).first()))fail('FOLDER_NOT_FOUND');
    if(await env.DB.prepare('SELECT 1 FROM records WHERE id=?').bind(recordId).first())fail('IMPORT_CONFLICT','Record ID already exists');
    const archived=row.status==='archived';
    // Archived records are not part of the active virtual namespace.
    if(!archived){
      const k=key(folder,recordName);
      if(stagedNames.has(k))fail('PATH_CONFLICT');stagedNames.add(k);
      if(await env.DB.prepare("SELECT 1 FROM records WHERE folder_id IS ? AND name=? AND status!='archived' UNION ALL SELECT 1 FROM folders WHERE parent_id IS ? AND name=? LIMIT 1")
        .bind(folder,recordName,folder,recordName).first())fail('PATH_CONFLICT');
    }
    if(!['document','checkpoint','task_list'].includes(String(row.kind))||!['draft','active','completed','superseded','archived'].includes(String(row.status)))fail('INVALID_SNAPSHOT');
    const content=string(row.content),history=string(row.history_metadata,2_000_000);
    string(row.description,5000);
    const revision=Number(row.revision);
    if(!Number.isSafeInteger(revision)||revision<1||item.revisions.length<1)fail('INVALID_SNAPSHOT_HISTORY');
    const firstRevision=Number(item.revisions[0]?.revision);
    if(!Number.isSafeInteger(firstRevision)||firstRevision<1||firstRevision+item.revisions.length-1!==revision)
      fail('INVALID_SNAPSHOT_HISTORY');
    if(await sha256(content)!==row.content_sha256)fail('SNAPSHOT_HASH_MISMATCH');
    for(const [index,v] of item.revisions.entries()){
      if(Number(v.revision)!==firstRevision+index||v.record_id!==recordId)fail('INVALID_SNAPSHOT_HISTORY');
      const text=Number(v.revision)===revision?content
        :historicalVersion({content,metadata:history},Number(v.revision));
      if(await sha256(text)!==v.content_sha256)fail('SNAPSHOT_HASH_MISMATCH','Revision '+v.revision+' of '+recordId+' did not match the archived hash');
    }
    const legacyCheckpoint=row.kind==='checkpoint';
    const restoredKind=legacyCheckpoint?'document':row.kind;
    // Snapshot-v2 exported before lifecycle migration can still hold archived
    // records inside folders. Detach them while preserving their original path.
    let archivedFromPath:string|null=null;
    if(archived){
      if(row.archived_from_path!=null)archivedFromPath=string(row.archived_from_path,2048);
      else {
        const names=[recordName];
        let current=folder,depth=0;
        while(current&&depth++<32){
          const staged=byId.get(current);
          const f=staged??await env.DB.prepare('SELECT id,parent_id,name FROM folders WHERE id=?').bind(current).first<AnyRow>();
          if(!f)throw new StorageError('FOLDER_NOT_FOUND');
          names.unshift(name(f.name));current=f.parent_id===null?null:id(f.parent_id);
        }
        archivedFromPath='/'+names.join('/');
      }
    }
    const previousFolder=archived?(row.archived_from_folder_id==null?folder:id(row.archived_from_folder_id)):null;
    statements.push(env.DB.prepare('INSERT INTO records(id,folder_id,name,kind,status,description,metadata_revision,created_at,updated_at,archived_from_path,archived_from_folder_id,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(recordId,archived?null:folder,recordName,restoredKind,row.status,row.description,
       Number(row.metadata_revision??1)+(legacyCheckpoint?1:0),row.created_at,row.updated_at,
       archivedFromPath,previousFolder,archived?row.archived_at??row.updated_at:null));
    statements.push(env.DB.prepare('INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,?,?)')
      .bind(recordId,content,revision,row.content_sha256));
    statements.push(env.DB.prepare('INSERT INTO record_histories(record_id,history_metadata) VALUES(?,?)').bind(recordId,history));
    for(const v of item.revisions){
      statements.push(env.DB.prepare('INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,?,?,?,?,?)')
        .bind(recordId,v.revision,v.content_sha256,v.message,v.actor,v.created_at));
    }
    if(row.kind==='task_list'){
      let tasks:unknown;
      try{tasks=JSON.parse(content);}catch{fail('INVALID_TASK_DOCUMENT');}
      if(!tasks||typeof tasks!=='object'||!Array.isArray((tasks as {tasks?:unknown}).tasks))fail('INVALID_TASK_DOCUMENT');
      for(const [position,task] of (tasks as {tasks:Array<AnyRow>}).tasks.entries()){
        const tid=id(task.id);
        if(taskIds.has(tid)||!validStates.has(String(task.status))||!Number.isInteger(task.priority)||
          typeof task.title!=='string'||!task.title.trim()||task.title.length>500||typeof task.details!=='string')fail('INVALID_TASK_DOCUMENT');
        taskIds.add(tid);
        taskOwners.set(tid,recordId);
        statements.push(env.DB.prepare('INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)')
          .bind(tid,recordId,task.title,task.details,task.status,task.priority,position,row.updated_at));
      }
    }
    // Legacy snapshot-v2 checkpoint rows are imported as documents with the checkpoint tag.
    const tagIds=[...new Set([...item.tags,...(legacyCheckpoint?['checkpoint']:[])].map(tag=>tagPlan.idFor(tag)))];
    for(const tagId of tagIds)statements.push(env.DB.prepare('INSERT INTO record_tags(record_id,tag_id) VALUES(?,?)').bind(recordId,tagId));
    if(row.status!=='archived')statements.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,?,?)'+INDEX_JOB_UPSERT)
      .bind(crypto.randomUUID(),recordId,revision,new Date().toISOString()));
    statements.push(event(env,'record',recordId,'restore',revision,actor,{name:recordName,folderId:archived?null:folder,kind:restoredKind,legacyCheckpoint,archivedFromPath}));
  }
  for(const link of links){
    const source=id(link.source_id),target=id(link.target_id),relation=string(link.relation,64);
    if(!relation.trim())fail('INVALID_LINK');
    for(const ref of [source,target]){
      if(!knownRecords.has(ref)&&!(await env.DB.prepare('SELECT 1 FROM records WHERE id=?').bind(ref).first()))fail('INVALID_LINK');
    }
    statements.push(env.DB.prepare('INSERT INTO record_links(source_id,target_id,relation) VALUES(?,?,?)').bind(source,target,relation));
    statements.push(event(env,'record',source,'link_restore',null,actor,{targetId:target,relation}));
  }
  if(taskIds.size&&await env.DB.prepare('SELECT 1 FROM tasks WHERE id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(JSON.stringify([...taskIds])).first())
    fail('IMPORT_CONFLICT','A task UUID already exists in the target library');
  if(format!=='recalloom-snapshot-v2'){
    const ranked=new Set<string>();
    for(const row of taskOrder){
      const taskId=id(row.task_id),owner=id(row.record_id);
      if(ranked.has(taskId)||taskOwners.get(taskId)!==owner||typeof row.position!=='number'||!Number.isFinite(row.position)||Math.abs(row.position)>Number.MAX_SAFE_INTEGER)fail('INVALID_SNAPSHOT_TASK_ORDER');
      ranked.add(taskId);
    }
    if(ranked.size!==taskIds.size)fail('INVALID_SNAPSHOT_TASK_ORDER','Every task must have exactly one saved position');
    const restoredOrder=targetTaskCount?taskOrder.slice().sort((a,b)=>Number(a.position)-Number(b.position)||(String(a.task_id)<String(b.task_id)?-1:1))
      .map((row,index)=>({...row,position:targetLastPosition+(index+1)*1024})):taskOrder;
    if(restoredOrder.some((row,index)=>!Number.isFinite(row.position)||targetTaskCount&&Number(row.position)<=(index?Number(restoredOrder[index-1]!.position):targetLastPosition)))
      fail('IMPORT_CONFLICT','Target task order has no numeric room for imported tasks');
    if(taskOrder.length)statements.push(env.DB.prepare(`INSERT INTO task_board_order(task_id,record_id,position)
      SELECT json_extract(value,'$.task_id'),json_extract(value,'$.record_id'),json_extract(value,'$.position') FROM json_each(?)`).bind(JSON.stringify(restoredOrder)));
  }else statements.push(env.DB.prepare(`INSERT INTO task_board_order(task_id,record_id,position)
    SELECT t.id,t.record_id,base.position+ROW_NUMBER() OVER (
      ORDER BY t.record_id,CASE WHEN json_extract(c.content,'$.taskOrder')='manual' THEN 0 ELSE -t.priority END,t.position,t.id
    )*1024.0
    FROM tasks t JOIN record_contents c ON c.record_id=t.record_id
    CROSS JOIN (SELECT COALESCE(MAX(position),0) AS position FROM task_board_order) base
    WHERE NOT EXISTS (SELECT 1 FROM task_board_order bo WHERE bo.task_id=t.id)`));
  const bindingKeys=new Set<string>();
  for(const row of pathBindings){
    const source=id(row.source_id),target=string(row.target_expression,2048),key=JSON.stringify([source,target]);
    id(row.target_id);
    if(!knownRecords.has(source)||bindingKeys.has(key)||!target.startsWith('/')||parseWikiTarget(target,false)?.target!==target)fail('INVALID_SNAPSHOT_PATH_BINDING');
    bindingKeys.add(key);
  }
  statements.push(...await snapshotProjections(env,records.map(item=>item.record),folders,pathBindings));
  if(taskIds.size)statements.push(env.DB.prepare('UPDATE task_order_state SET version=version+1 WHERE id=1'));
  if(statements.length>700)fail('ATOMIC_IMPORT_LIMIT','This snapshot exceeds the single-transaction import limit; use a D1 database backup for larger libraries');
  if(!dryRun){
    try{await tagBatch(env,statements);}
    catch(error){
      if(error instanceof Error&&/(?:UNIQUE|PRIMARY KEY) constraint failed:\s*task_order_state\.id/i.test(error.message))
        fail('IMPORT_CONFLICT','Target library changed during import validation; restart the import');
      throw error;
    }
  }
  return {dryRun,validated:true,folders:folders.length,records:records.length,links:links.length,taskOrder:taskOrder.length,pathBindings:pathBindings.length,statements:statements.length};
}
function event(env:Env,entityType:'folder'|'record',entityId:string,type:string,revision:number|null,actor:string,details:unknown){
  return env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?)')
    .bind(entityType==='record'?entityId:null,type,revision,actor,new Date().toISOString(),entityType,entityId,JSON.stringify(details));
}
