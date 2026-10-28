import type { Env, EditInput, RecordKind, RecordStatus, StoredRecord, Task, TaskStatus } from './types.js';
import { StorageError } from './types.js';
import { sha256, initialVersion, nextVersion, historicalVersion, editContent } from './version.js';

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const event=(env:Env,entityType:'record'|'folder',entityId:string,operation:string,revision:number|null,actor:string,details:unknown=null)=>env.DB.prepare(
  'INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?)'
).bind(entityType==='record'?entityId:null,operation,revision,actor,now(),entityType,entityId,JSON.stringify(details));
async function recordExtras(env:Env,folderId:string|null,recordId:string){
  const [tags,parents]=await Promise.all([
    env.DB.prepare('SELECT t.name FROM tags t JOIN record_tags rt ON rt.tag_id=t.id WHERE rt.record_id=? ORDER BY t.name').bind(recordId).all<{name:string}>(),
    folderId?env.DB.prepare('WITH RECURSIVE a(id,parent_id,name,depth) AS (SELECT id,parent_id,name,0 FROM folders WHERE id=? UNION ALL SELECT f.id,f.parent_id,f.name,a.depth+1 FROM folders f JOIN a ON f.id=a.parent_id) SELECT name FROM a ORDER BY depth DESC').bind(folderId).all<{name:string}>():Promise.resolve({results:[] as {name:string}[]})
  ]);
  return {tags:tags.results.map(t=>t.name),path:'/'+[...parents.results.map(p=>p.name)].join('/')};
}
const bounded = (n: number, max=100) => Math.min(max,Math.max(1,Math.floor(n||20)));
const nameCheck = (name: string) => {
  if (!name.trim() || name.includes('/') || name.includes('\\') || name.length > 180)
    throw new StorageError('INVALID_NAME','Name must contain 1-180 characters, without path separators');
  return name.trim();
};
export async function getRecord(env: Env, id: string): Promise<StoredRecord> {
  const row = await env.DB.prepare('SELECT r.*,c.content,h.history_metadata,c.revision,c.content_sha256 FROM records r JOIN record_contents c ON c.record_id=r.id JOIN record_histories h ON h.record_id=r.id WHERE r.id=?').bind(id).first<StoredRecord>();
  if (!row) throw new StorageError('RECORD_NOT_FOUND');
  return row;
}
export async function createFolder(env: Env, name: string, parentId: string|null, description='', actor='agent') {
  name=nameCheck(name);
  if (parentId && !(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(parentId).first()))
    throw new StorageError('FOLDER_NOT_FOUND');
  const id=newId(), timestamp=now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO folders(id,parent_id,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,parentId,name,description,timestamp,timestamp),
    event(env,'folder',id,'create',null,actor,{name,parentId,description})
  ]);
  return {id,parentId,name,description,metadataRevision:1};
}
type BrowseCursor={folderId:string|null;folderDone:boolean;recordDone:boolean;lastFolder?:{name:string;id:string};lastRecord?:{updatedAt:string;id:string}};
export async function browse(env:Env,folderId:string|null=null,limit=50,cursor?:string|null){
  if(folderId&&!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))throw new StorageError('FOLDER_NOT_FOUND');
  const size=bounded(limit,100);
  let state:BrowseCursor={folderId,folderDone:false,recordDone:false};
  if(cursor){
    try{
      const value=JSON.parse(cursor) as BrowseCursor;
      if(value.folderId!==folderId||typeof value.folderDone!=='boolean'||typeof value.recordDone!=='boolean')throw Error();
      state=value;
    }catch{throw new StorageError('INVALID_CURSOR');}
  }
  const [folderRows,recordRows]=await Promise.all([
    state.folderDone?Promise.resolve({results:[] as Array<Record<string,unknown>>}):
      env.DB.prepare('SELECT id,parent_id AS parentId,name,description,metadata_revision AS metadataRevision,updated_at AS updatedAt FROM folders WHERE parent_id IS ? AND (? IS NULL OR name>? OR (name=? AND id>?)) ORDER BY name,id LIMIT ?')
        .bind(folderId,state.lastFolder?.name??null,state.lastFolder?.name??'',state.lastFolder?.name??'',state.lastFolder?.id??'',size+1).all(),
    state.recordDone?Promise.resolve({results:[] as Array<Record<string,unknown>>}):
      env.DB.prepare("SELECT r.id,r.folder_id AS folderId,r.name,r.kind,r.status,r.description,r.metadata_revision AS metadataRevision,r.updated_at AS updatedAt,c.revision,(SELECT json_group_array(t.name) FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=r.id) AS tags FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.folder_id IS ? AND (? IS NULL OR r.updated_at<? OR (r.updated_at=? AND r.id>?)) ORDER BY r.updated_at DESC,r.id LIMIT ?")
        .bind(folderId,state.lastRecord?.updatedAt??null,state.lastRecord?.updatedAt??'',state.lastRecord?.updatedAt??'',state.lastRecord?.id??'',size+1).all()
  ]);
  const folders=folderRows.results.slice(0,size) as Array<Record<string,unknown>>;
  const records=recordRows.results.slice(0,size) as Array<Record<string,unknown>>;
  const folderDone=state.folderDone||folderRows.results.length<=size,recordDone=state.recordDone||recordRows.results.length<=size;
  const next:BrowseCursor={folderId,folderDone,recordDone,
    lastFolder:folders.length?{name:String(folders.at(-1)?.name),id:String(folders.at(-1)?.id)}:state.lastFolder,
    lastRecord:records.length?{updatedAt:String(records.at(-1)?.updatedAt),id:String(records.at(-1)?.id)}:state.lastRecord};
  const items:Array<Record<string,unknown>>=[
    ...folders.map(row=>({entityType:'folder',...row})),
    ...records.map(row=>({entityType:'record',...row,tags:JSON.parse(String(row.tags??'[]'))}))
  ];
  const hasMore=!folderDone||!recordDone;
  return {folderId,items,page:{hasMore,nextCursor:hasMore?JSON.stringify(next):null}};
}
export async function createRecord(env: Env, input:{name:string;folderId?:string|null;kind?:RecordKind;description?:string;content?:string}, actor='agent') {
  const id=newId(), ts=now(), name=nameCheck(input.name), folderId=input.folderId??null,kind=input.kind??'document';
  if (folderId && !(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))
    throw new StorageError('FOLDER_NOT_FOUND');
  const content = kind==='task_list' ? JSON.stringify({tasks:[]},null,2) : (input.content??'');
  if (kind==='task_list' && input.content && input.content.trim()!==content)
    throw new StorageError('TASK_LIST_CONTENT_MANAGED','Use tasks to modify task lists');
  if (content.length > 500_000) throw new StorageError('CONTENT_TOO_LARGE');
  const version=initialVersion(content),digest=await sha256(content);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO records(id,folder_id,name,kind,status,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,folderId,name,kind,'active',input.description??'',ts,ts),
    env.DB.prepare('INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,?,?)')
      .bind(id,content,1,digest),
    env.DB.prepare('INSERT INTO record_histories(record_id,history_metadata) VALUES(?,?)').bind(id,version.metadata),
    env.DB.prepare('INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id,1,digest,'Created',actor,ts),
    env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,?,?)')
      .bind(newId(),id,1,ts),
    event(env,'record',id,'create',1,actor,{name,folderId,kind})
  ]);
  return {id,name,kind,revision:1,contentSha256:digest};
}
export async function readRecord(env:Env, id:string, options:{revision?:number;lineStart?:number;maxLines?:number;metadataOnly?:boolean}={}) {
  const row=options.metadataOnly
    ?await env.DB.prepare('SELECT r.*,c.revision,c.content_sha256 FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=?').bind(id).first<StoredRecord>()
    :await getRecord(env,id);
  if(!row)throw new StorageError('RECORD_NOT_FOUND');
  if (options.revision!==undefined && (!Number.isInteger(options.revision)||options.revision<1||options.revision>row.revision))
    throw new StorageError('REVISION_NOT_FOUND');
  const targetRevision=options.revision??row.revision;
  let contentSha256=row.content_sha256;
  if(targetRevision!==row.revision) {
    const historical=await env.DB.prepare('SELECT content_sha256 FROM revisions WHERE record_id=? AND revision=?')
      .bind(id,targetRevision).first<{content_sha256:string}>();
    if(!historical)throw new StorageError('REVISION_NOT_FOUND');
    contentSha256=historical.content_sha256;
  }
  const extras=await recordExtras(env,row.folder_id,row.id);
  const metadata={id:row.id,name:row.name,folderId:row.folder_id,path:extras.path+(row.folder_id?'/':'')+row.name,tags:extras.tags,kind:row.kind,status:row.status,description:row.description,metadataRevision:row.metadata_revision,revision:targetRevision,currentRevision:row.revision,contentSha256,updatedAt:row.updated_at};
  if(options.metadataOnly)return metadata;
  let content=targetRevision!==row.revision
    ?historicalVersion({content:row.content,metadata:row.history_metadata},targetRevision)
    :row.content;
  const lines=content.split(/\r\n|\n|\r/),totalLines=lines.length;
  const start=options.lineStart===undefined?1:options.lineStart;
  if (!Number.isInteger(start)||start<1||start>totalLines+1) throw new StorageError('INVALID_LINE_RANGE');
  if (options.maxLines!==undefined || options.lineStart!==undefined) {
    const take=bounded(options.maxLines??200,2000);
    content=lines.slice(start-1,start-1+take).join('\n');
    return {...metadata,content,totalLines,lineStart:start,returnedLines:Math.min(take,Math.max(0,totalLines-start+1)),truncated:start-1+take<totalLines};
  }
  if (content.length>300_000) throw new StorageError('READ_REQUIRES_RANGE');
  return {...metadata,content,totalLines};
}
async function commitContent(env:Env,row:StoredRecord,content:string,expectedRevision:number,message:string,actor:string,tasks?:Task[],taskEvent?:unknown) {
  if (expectedRevision!==row.revision) throw new StorageError('VERSION_CONFLICT','Latest revision is '+row.revision);
  if (content.length>500_000) throw new StorageError('CONTENT_TOO_LARGE');
  if (content===row.content) return {id:row.id,revision:row.revision,changed:false,contentSha256:row.content_sha256};
  const rev=row.revision+1,ts=now(),digest=await sha256(content);
  const encoded=nextVersion({content:row.content,metadata:row.history_metadata},content,rev);
  const q=[
    env.DB.prepare('UPDATE record_contents SET content=?,revision=?,content_sha256=? WHERE record_id=? AND revision=?')
      .bind(content,rev,digest,row.id,expectedRevision),
    env.DB.prepare('UPDATE record_histories SET history_metadata=? WHERE record_id=?').bind(encoded.metadata,row.id),
    // A stale concurrent writer will collide with this unique revision and roll back the whole batch.
    env.DB.prepare('INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,?,?,?,?,?)')
      .bind(row.id,rev,digest,message,actor,ts),
    env.DB.prepare('UPDATE records SET updated_at=? WHERE id=?').bind(ts,row.id)
  ];
  if (tasks) {
    q.push(env.DB.prepare('DELETE FROM tasks WHERE record_id=?').bind(row.id));
    for (const [position,task] of tasks.entries()) {
      q.push(env.DB.prepare('INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(task.id,row.id,task.title,task.details,task.status,task.priority,position,ts));
    }
  }
  q.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,?,?)').bind(newId(),row.id,rev,ts));
  q.push(event(env,'record',row.id,'update',rev,actor,taskEvent));
  try { await env.DB.batch(q); }
  catch(error) {
    const latest=await env.DB.prepare('SELECT revision FROM record_contents WHERE record_id=?').bind(row.id).first<{revision:number}>();
    if(latest?.revision!==expectedRevision) throw new StorageError('VERSION_CONFLICT','Latest revision is '+latest?.revision);
    throw error;
  }
  return {id:row.id,revision:rev,changed:true,contentSha256:digest};
}
export async function editRecord(env:Env,id:string,expectedRevision:number,edit:EditInput|string,message='Edited',actor='agent',dryRun=false) {
  const row=await getRecord(env,id);
  if(row.kind==='task_list')throw new StorageError('TASK_LIST_CONTENT_MANAGED');
  if(row.revision!==expectedRevision)throw new StorageError('VERSION_CONFLICT','Latest revision is '+row.revision);
  const x=typeof edit==='string'?{content:edit,replacements:0}:editContent(row.content,edit);
  if (dryRun) return {id,revision:row.revision,changed:x.content!==row.content,dryRun:true,replacements:x.replacements,contentPreview:x.content.slice(0,4000)};
  const outcome=await commitContent(env,row,x.content,expectedRevision,message,actor);
  return {...outcome,replacements:x.replacements};
}
export async function restoreRecord(env:Env,id:string,targetRevision:number,expectedRevision:number,actor='agent') {
  const row=await getRecord(env,id);
  const historic=historicalVersion({content:row.content,metadata:row.history_metadata},targetRevision);
  if(row.kind!=='task_list')return commitContent(env,row,historic,expectedRevision,'Restored revision '+targetRevision,actor);
  let tasks:Task[];
  try {
    const parsed:unknown=JSON.parse(historic);
    if(!parsed||typeof parsed!=='object'||!Array.isArray((parsed as {tasks?:unknown}).tasks))throw Error('invalid');
    tasks=(parsed as {tasks:Task[]}).tasks;
    const ids=new Set<string>();
    for(const task of tasks){
      if(typeof task.id!=='string'||ids.has(task.id)||typeof task.title!=='string'||typeof task.details!=='string'
        ||!['todo','in_progress','blocked','done','cancelled'].includes(task.status)||!Number.isInteger(task.priority))throw Error('invalid task');
      ids.add(task.id);
    }
  }catch {throw new StorageError('INVALID_TASK_DOCUMENT','Historical task list cannot be projected safely');}
  return commitContent(env,row,historic,expectedRevision,'Restored task list revision '+targetRevision,actor,tasks,{action:'restore',targetRevision,taskCount:tasks.length});
}
export async function listVersions(env:Env,id:string,limit=50,cursor?:number){
  await getRecord(env,id);
  const size=bounded(limit,200);
  if(cursor!==undefined&&(!Number.isInteger(cursor)||cursor<1))throw new StorageError('INVALID_CURSOR');
  const rows=(await env.DB.prepare('SELECT revision,content_sha256 AS contentSha256,message,actor,created_at AS createdAt FROM revisions WHERE record_id=? AND revision<? ORDER BY revision DESC LIMIT ?')
    .bind(id,cursor??2147483647,size+1).all()).results;
  const items=rows.slice(0,size);
  return {items,page:{hasMore:rows.length>size,nextCursor:rows.length>size?items.at(-1)?.revision??null:null}};
}
export async function updateMeta(env:Env,id:string,updates:{
  name?:string;folderId?:string|null;status?:RecordStatus;description?:string;expectedMetadataRevision?:number
},actor='agent'){
  const row=await getRecord(env,id),expected=updates.expectedMetadataRevision;
  if(expected!==undefined&&expected!==row.metadata_revision)
    throw new StorageError('METADATA_CONFLICT','Current metadataRevision is '+row.metadata_revision);
  const name=updates.name===undefined?row.name:nameCheck(updates.name);
  const folderId=updates.folderId===undefined?row.folder_id:updates.folderId;
  const status=updates.status??row.status;
  const description=updates.description??row.description;
  if(folderId&&!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))throw new StorageError('FOLDER_NOT_FOUND');
  if(name===row.name&&folderId===row.folder_id&&status===row.status&&description===row.description)
    return {id,name,folderId,status,metadataRevision:row.metadata_revision,changed:false};
  const next=row.metadata_revision+1,ts=now();
  const stmts=[
    env.DB.prepare('UPDATE records SET name=?,folder_id=?,status=?,description=?,updated_at=?,metadata_revision=? WHERE id=? AND metadata_revision=?')
      .bind(name,folderId,status,description,ts,next,id,row.metadata_revision),
    // Guard follow-on effects if another agent won the optimistic metadata update.
    env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)')
      .bind(id,'metadata',row.revision,actor,ts,'record',id,JSON.stringify({name,folderId,status,description,metadataRevision:next}),id,next)
  ];
  if(name!==row.name||status!==row.status)
    stmts.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) SELECT ?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)')
      .bind(newId(),id,row.revision,ts,id,next));
  const res=await env.DB.batch(stmts);
  if((res[0]?.meta?.changes??0)===0)throw new StorageError('METADATA_CONFLICT','Current metadataRevision changed; re-read the record');
  return {id,name,folderId,status,metadataRevision:next,changed:true};
}
export async function tagRecord(env:Env,id:string,tag:string,action:'add'|'remove',actor='agent'){
  await getRecord(env,id);
  tag=tag.trim().toLowerCase();
  if(!tag||tag.length>64)throw new StorageError('INVALID_TAG');
  const existing=await env.DB.prepare('SELECT 1 AS found FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=? AND t.name=?').bind(id,tag).first();
  if((action==='add'&&existing)||(action==='remove'&&!existing))return {id,tag,action,changed:false};
  const ts=now();
  if(action==='add'){
    await env.DB.batch([
      env.DB.prepare('INSERT INTO tags(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING').bind(newId(),tag),
      env.DB.prepare('INSERT OR IGNORE INTO record_tags(record_id,tag_id) SELECT ?,id FROM tags WHERE name=?').bind(id,tag),
      event(env,'record',id,'tag_add',null,actor,{tag})
    ]);
  }else{
    await env.DB.batch([
      env.DB.prepare('DELETE FROM record_tags WHERE record_id=? AND tag_id IN (SELECT id FROM tags WHERE name=?)').bind(id,tag),
      event(env,'record',id,'tag_remove',null,actor,{tag})
    ]);
  }
  return {id,tag,action,changed:true};
}
export async function taskOperation(env:Env,recordId:string,expectedRevision:number,action:'add'|'update'|'remove',taskId:string|undefined,changes:Partial<Task>,actor='agent') {
  const row=await getRecord(env,recordId);
  if(row.kind!=='task_list')throw new StorageError('NOT_A_TASK_LIST');
  if(row.revision!==expectedRevision)throw new StorageError('VERSION_CONFLICT','Latest revision is '+row.revision);
  let parsed: {tasks:Task[]};
  try { parsed=JSON.parse(row.content); if(!Array.isArray(parsed.tasks))throw Error(); }
  catch {throw new StorageError('INVALID_TASK_DOCUMENT');}
  const tasks=parsed.tasks;
  const validStates:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];
  if(action==='add'){
    const title=changes.title?.trim();
    if(!title||title.length>500)throw new StorageError('INVALID_TASK');
    tasks.push({id:newId(),title,details:changes.details??'',status:changes.status??'todo',priority:changes.priority??0});
  } else {
    const index=tasks.findIndex(t=>t.id===taskId);
    if(index<0)throw new StorageError('TASK_NOT_FOUND');
    if(action==='remove') tasks.splice(index,1);
    else tasks[index]={...tasks[index]!,...changes,id:tasks[index]!.id};
  }
  if(tasks.some(t=>!t.title.trim()||!validStates.includes(t.status)||!Number.isInteger(t.priority)))throw new StorageError('INVALID_TASK');
  const content=JSON.stringify({tasks},null,2);
  const affected=action==='add'?tasks.at(-1):action==='remove'?undefined:tasks.find(t=>t.id===taskId);
  const message='Task '+action+': '+(affected?.title??taskId??'task')+' ['+(affected?.id??taskId??'new')+']';
  const result=await commitContent(env,row,content,expectedRevision,message,actor,tasks,{action,taskId:affected?.id??taskId,title:affected?.title,changes});
  return {...result,tasks};
}
type TaskCursor={recordId?:string;status?:TaskStatus;updatedAt:string;id:string};
export async function getTasks(env:Env,recordId?:string,status?:TaskStatus,limit=100,cursor?:string){
  const size=bounded(limit,200);
  let next:TaskCursor|undefined;
  if(cursor){
    try{
      next=JSON.parse(cursor) as TaskCursor;
      if(next.recordId!==recordId||next.status!==status||typeof next.updatedAt!=='string'||typeof next.id!=='string')throw Error();
    }catch{throw new StorageError('INVALID_CURSOR');}
  }
  const clauses=["r.status!='archived'"];
  const bind:(string|number)[]=[];
  if(recordId){clauses.push('t.record_id=?');bind.push(recordId);}
  if(status){clauses.push('t.status=?');bind.push(status);}
  if(next){clauses.push('(t.updated_at<? OR (t.updated_at=? AND t.id>?))');bind.push(next.updatedAt,next.updatedAt,next.id);}
  const rows=(await env.DB.prepare('SELECT t.id,t.record_id AS recordId,t.title,t.details,t.status,t.priority,t.position,t.updated_at AS updatedAt FROM tasks t JOIN records r ON r.id=t.record_id WHERE '+clauses.join(' AND ')+' ORDER BY t.updated_at DESC,t.id LIMIT ?')
    .bind(...bind,size+1).all()).results as Array<Record<string,unknown>>;
  const items=rows.slice(0,size);
  const hasMore=rows.length>size;
  const last=items.at(-1);
  return {items,page:{hasMore,nextCursor:hasMore?JSON.stringify({recordId,status,updatedAt:last?.updatedAt,id:last?.id}):null}};
}
export async function changesSince(env:Env,cursor=0,limit=50){
  const size=bounded(limit,200);
  const result=await env.DB.prepare('SELECT * FROM change_events WHERE seq>? ORDER BY seq LIMIT ?').bind(cursor,size+1).all();
  const rows=result.results as Array<{seq:number;record_id:string|null;event_type:string;entity_type?:string;entity_id?:string;details_json?:string}>;
  const items=rows.slice(0,size).map(({details_json,record_id,event_type,entity_type,entity_id,...rest})=>({
    ...rest,entityType:entity_type??(record_id?'record':null),entityId:entity_id??record_id,
    operation:event_type,details:details_json?JSON.parse(details_json):null
  }));
  const hasMore=rows.length>size;
  return {items,page:{hasMore,nextCursor:items.at(-1)?.seq??cursor}};
}
export async function manageFolder(env:Env,id:string,changes:{
  name?:string;parentId?:string|null;description?:string;expectedMetadataRevision?:number
},actor='agent'){
  const folder=await env.DB.prepare('SELECT id,parent_id,name,description,metadata_revision FROM folders WHERE id=?')
    .bind(id).first<{id:string;parent_id:string|null;name:string;description:string;metadata_revision:number}>();
  if(!folder)throw new StorageError('FOLDER_NOT_FOUND');
  if(changes.expectedMetadataRevision!==undefined&&changes.expectedMetadataRevision!==folder.metadata_revision)
    throw new StorageError('METADATA_CONFLICT','Current metadataRevision is '+folder.metadata_revision);
  const parentId=changes.parentId===undefined?folder.parent_id:changes.parentId;
  const name=changes.name===undefined?folder.name:nameCheck(changes.name);
  const description=changes.description??folder.description;
  if(parentId){
    if(!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(parentId).first()))throw new StorageError('FOLDER_NOT_FOUND');
    const cycle=await env.DB.prepare(
      'WITH RECURSIVE subtree(id) AS (SELECT id FROM folders WHERE id=? UNION ALL SELECT f.id FROM folders f JOIN subtree s ON f.parent_id=s.id) SELECT id FROM subtree WHERE id=? LIMIT 1'
    ).bind(id,parentId).first();
    if(cycle)throw new StorageError('FOLDER_CYCLE');
  }
  if(parentId===folder.parent_id&&name===folder.name&&description===folder.description)
    return {id,name,parentId,description,metadataRevision:folder.metadata_revision,changed:false};
  const next=folder.metadata_revision+1,ts=now();
  const result=await env.DB.batch([
    env.DB.prepare('UPDATE folders SET name=?,parent_id=?,description=?,updated_at=?,metadata_revision=? WHERE id=? AND metadata_revision=?')
      .bind(name,parentId,description,ts,next,id,folder.metadata_revision),
    env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) SELECT NULL,?,NULL,?,?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM folders WHERE id=? AND metadata_revision=?)')
      .bind('folder_update',actor,ts,'folder',id,JSON.stringify({name,parentId,description,metadataRevision:next,previousName:folder.name,previousParentId:folder.parent_id}),id,next)
  ]);
  if((result[0]?.meta?.changes??0)===0)throw new StorageError('METADATA_CONFLICT','Current metadataRevision changed; re-read the folder');
  return {id,name,parentId,description,metadataRevision:next,changed:true};
}
export async function resolvePath(env:Env,path:string) {
  if(!path.startsWith('/')||path.length>2048)throw new StorageError('INVALID_VIRTUAL_PATH');
  const segments=path.split('/').filter(Boolean);
  if(!segments.length)return {kind:'folder',id:null,path:'/'};
  let folderId:string|null=null;
  for(let i=0;i<segments.length;i++) {
    const name=segments[i]!;
    const child: {id:string}|null=await env.DB.prepare('SELECT id FROM folders WHERE parent_id IS ? AND name=?').bind(folderId,name).first<{id:string}>();
    if(child) {
      folderId=child.id;
      if(i===segments.length-1)return {kind:'folder',id:child.id,path};
      continue;
    }
    if(i!==segments.length-1)throw new StorageError('PATH_NOT_FOUND');
    const record=await env.DB.prepare('SELECT id FROM records WHERE folder_id IS ? AND name=?').bind(folderId,name).first<{id:string}>();
    if(!record)throw new StorageError('PATH_NOT_FOUND');
    return {kind:'record',id:record.id,path};
  }
  throw new StorageError('PATH_NOT_FOUND');
}
