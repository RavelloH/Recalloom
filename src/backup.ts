import type { Env } from './types.js';
import { StorageError } from './types.js';
import { historicalVersion, sha256 } from './version.js';

type AnyRow=Record<string,unknown>;
export type SnapshotPage={
  format:'recalloom-snapshot-v2';
  watermark:number;
  totalRecords:number;
  cursor:string|null;
  nextCursor:string|null;
  folders:AnyRow[];
  records:Array<{record:AnyRow;revisions:AnyRow[];tags:string[]}>;
  links:AnyRow[];
  pageHash:string;
};
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
const cursorEncode=(x:{watermark:number;lastId:string;totalRecords:number}):string=>btoa(JSON.stringify(x));
const cursorDecode=(c:string):{watermark:number;lastId:string;totalRecords:number}=>{
  try{
    const v=JSON.parse(atob(c)) as {watermark:number;lastId:string;totalRecords:number};
    if(!Number.isSafeInteger(v.watermark)||v.watermark<0||!uuid.test(v.lastId)||!Number.isSafeInteger(v.totalRecords)||v.totalRecords<0)throw Error();
    return v;
  }catch{return fail('INVALID_SNAPSHOT_CURSOR');}
};
export const pageHash=async(page:Omit<SnapshotPage,'pageHash'>)=>sha256(JSON.stringify({format:page.format,watermark:page.watermark,totalRecords:page.totalRecords,cursor:page.cursor,nextCursor:page.nextCursor,folders:page.folders,records:page.records,links:page.links}));

export async function exportSnapshot(env:Env,cursor:string|null=null,limit=2):Promise<SnapshotPage>{
  const pageSize=Math.min(5,Math.max(1,Math.floor(limit)));
  const state=cursor?cursorDecode(cursor):null;
  const watermark=state?.watermark??await maxSeq(env);
  if(await maxSeq(env)!==watermark)fail('SNAPSHOT_CHANGED','Library changed during backup; restart the export');
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
      env.DB.prepare('SELECT * FROM revisions WHERE record_id=? ORDER BY revision').bind(recordId).all(),
      env.DB.prepare('SELECT t.name FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=? ORDER BY t.name').bind(recordId).all()
    ]);
    records.push({record:row,revisions:versions.results,tags:tags.results.map(x=>String(x.name))});
  }
  const done=recordRows.results.length<=pageSize;
  const links=done?(await env.DB.prepare('SELECT * FROM record_links ORDER BY source_id,target_id,relation').all()).results:[];
  if(await maxSeq(env)!==watermark)fail('SNAPSHOT_CHANGED','Library changed while exporting; discard all pages');
  const nextCursor=done?null:cursorEncode({watermark,lastId:id(selection.at(-1)?.id),totalRecords});
  const payload={format:'recalloom-snapshot-v2' as const,watermark,totalRecords,cursor,nextCursor,folders:folders.results,records,links};
  return {...payload,pageHash:await pageHash(payload)};
}

type ImportInput={pages:SnapshotPage[]};
export async function importSnapshot(env:Env,bundle:unknown,dryRun=true,actor='agent'){
  if(!bundle||typeof bundle!=='object'||!Array.isArray((bundle as ImportInput).pages))fail('INVALID_SNAPSHOT');
  const pages=(bundle as ImportInput).pages;
  if(pages.length<1||pages.length>100||JSON.stringify(bundle).length>6_000_000)fail('SNAPSHOT_TOO_LARGE');
  const watermark=pages[0]?.watermark,expected=pages[0]?.totalRecords;
  let previous:string|null=null;
  const folders:AnyRow[]=[],records:SnapshotPage['records']=[],links:AnyRow[]=[];
  for(const [index,page] of pages.entries()){
    if(page.format!=='recalloom-snapshot-v2'||page.watermark!==watermark||page.totalRecords!==expected||
      page.cursor!==previous||page.pageHash!==await pageHash({
        format:page.format,watermark:page.watermark,totalRecords:page.totalRecords,cursor:page.cursor,
        nextCursor:page.nextCursor,folders:page.folders,records:page.records,links:page.links
      }))fail('SNAPSHOT_INTEGRITY_ERROR');
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
  const knownFolders=new Set(folders.map(f=>id(f.id)));
  if(knownFolders.size!==folders.length)fail('DUPLICATE_SNAPSHOT_ID');
  const knownRecords=new Set(records.map(v=>id(v.record.id)));
  if(knownRecords.size!==records.length)fail('DUPLICATE_SNAPSHOT_ID');
  const stagedNames=new Set<string>();
  const key=(parent:string|null,recordName:string)=>JSON.stringify([parent,recordName]);
  const statements:D1PreparedStatement[]=[];
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
  const validStates=new Set(['todo','in_progress','blocked','done','cancelled']);
  for(const item of records){
    if(!item||typeof item!=='object'||!item.record||!Array.isArray(item.revisions)||!Array.isArray(item.tags))fail('INVALID_SNAPSHOT');
    const row=item.record,recordId=id(row.id),folder=row.folder_id===null?null:id(row.folder_id),recordName=name(row.name);
    if(folder&&!knownFolders.has(folder)&&!(await env.DB.prepare('SELECT 1 FROM folders WHERE id=?').bind(folder).first()))fail('FOLDER_NOT_FOUND');
    if(await env.DB.prepare('SELECT 1 FROM records WHERE id=?').bind(recordId).first())fail('IMPORT_CONFLICT','Record ID already exists');
    const k=key(folder,recordName);
    if(stagedNames.has(k))fail('PATH_CONFLICT');stagedNames.add(k);
    if(await env.DB.prepare('SELECT 1 FROM records WHERE folder_id IS ? AND name=? UNION ALL SELECT 1 FROM folders WHERE parent_id IS ? AND name=? LIMIT 1')
      .bind(folder,recordName,folder,recordName).first())fail('PATH_CONFLICT');
    if(!['document','checkpoint','task_list'].includes(String(row.kind))||!['draft','active','completed','superseded','archived'].includes(String(row.status)))fail('INVALID_SNAPSHOT');
    const content=string(row.content),history=string(row.history_metadata,2_000_000);
    string(row.description,5000);
    const revision=Number(row.revision);
    if(!Number.isSafeInteger(revision)||revision<1||item.revisions.length!==revision)fail('INVALID_SNAPSHOT_HISTORY');
    if(await sha256(content)!==row.content_sha256)fail('SNAPSHOT_HASH_MISMATCH');
    for(const [index,v] of item.revisions.entries()){
      if(Number(v.revision)!==index+1||v.record_id!==recordId)fail('INVALID_SNAPSHOT_HISTORY');
      const text=index+1===revision?content:historicalVersion({content,metadata:history},index+1);
      if(await sha256(text)!==v.content_sha256)fail('SNAPSHOT_HASH_MISMATCH','Revision '+(index+1)+' of '+recordId+' did not match the archived hash');
    }
    const legacyCheckpoint=row.kind==='checkpoint';
    const restoredKind=legacyCheckpoint?'document':row.kind;
    statements.push(env.DB.prepare('INSERT INTO records(id,folder_id,name,kind,status,description,metadata_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(recordId,folder,recordName,restoredKind,row.status,row.description,Number(row.metadata_revision??1)+(legacyCheckpoint?1:0),row.created_at,row.updated_at));
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
        statements.push(env.DB.prepare('INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)')
          .bind(tid,recordId,task.title,task.details,task.status,task.priority,position,row.updated_at));
      }
    }
    // Legacy snapshot-v2 checkpoint rows are imported as documents with the checkpoint tag.
    for(const tag of [...new Set([...item.tags, ...(legacyCheckpoint?['checkpoint']:[])].map(t=>typeof t==='string'?t.trim().toLowerCase():t))]){
      if(typeof tag!=='string'||!tag.trim()||tag.length>64)fail('INVALID_TAG');
      statements.push(env.DB.prepare('INSERT INTO tags(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING').bind(crypto.randomUUID(),tag));
      statements.push(env.DB.prepare('INSERT INTO record_tags(record_id,tag_id) SELECT ?,id FROM tags WHERE name=?').bind(recordId,tag));
    }
    if(row.status!=='archived')statements.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,?,?)')
      .bind(crypto.randomUUID(),recordId,revision,new Date().toISOString()));
    statements.push(event(env,'record',recordId,'restore',revision,actor,{name:recordName,folderId:folder,kind:restoredKind,legacyCheckpoint}));
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
  if(statements.length>700)fail('ATOMIC_IMPORT_LIMIT','This snapshot exceeds the single-transaction import limit; use a D1 database backup for larger libraries');
  if(!dryRun)await env.DB.batch(statements);
  return {dryRun,validated:true,folders:folders.length,records:records.length,links:links.length,statements:statements.length};
}
function event(env:Env,entityType:'folder'|'record',entityId:string,type:string,revision:number|null,actor:string,details:unknown){
  return env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?)')
    .bind(entityType==='record'?entityId:null,type,revision,actor,new Date().toISOString(),entityType,entityId,JSON.stringify(details));
}
