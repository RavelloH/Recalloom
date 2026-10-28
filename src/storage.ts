import type { Env, EditInput, RecordKind, RecordStatus, StoredRecord, Task, TaskStatus } from './types.js';
import { StorageError } from './types.js';
import { sha256, initialVersion, nextVersion, historicalVersion, editContent } from './version.js';

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
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
export async function createFolder(env: Env, name: string, parentId: string|null, description='') {
  name=nameCheck(name);
  if (parentId && !(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(parentId).first()))
    throw new StorageError('FOLDER_NOT_FOUND');
  const id=newId(), timestamp=now();
  await env.DB.prepare('INSERT INTO folders(id,parent_id,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .bind(id,parentId,name,description,timestamp,timestamp).run();
  return {id,parentId,name,description};
}
export async function browse(env: Env, folderId: string|null=null, limit=50) {
  if (folderId && !(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))
    throw new StorageError('FOLDER_NOT_FOUND');
  const [folders,records]=await Promise.all([
    env.DB.prepare('SELECT id,parent_id,name,description,updated_at FROM folders WHERE parent_id IS ? ORDER BY name LIMIT ?').bind(folderId,bounded(limit,200)).all(),
    env.DB.prepare('SELECT r.id,r.folder_id,r.name,r.kind,r.status,r.description,r.updated_at,c.revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.folder_id IS ? ORDER BY r.updated_at DESC LIMIT ?')
      .bind(folderId,bounded(limit,200)).all()
  ]);
  return {folderId,folders:folders.results,records:records.results};
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
    env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at) VALUES(?,?,?,?,?)')
      .bind(id,'create',1,actor,ts)
  ]);
  return {id,name,kind,revision:1,contentSha256:digest};
}
export async function readRecord(env:Env, id:string, options:{revision?:number;lineStart?:number;maxLines?:number;metadataOnly?:boolean}={}) {
  const row=await getRecord(env,id);
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
  const metadata={id:row.id,name:row.name,folderId:row.folder_id,kind:row.kind,status:row.status,description:row.description,revision:targetRevision,currentRevision:row.revision,contentSha256,updatedAt:row.updated_at};
  if(options.metadataOnly)return metadata;
  let content=targetRevision!==row.revision
    ?historicalVersion({content:row.content,metadata:row.history_metadata},targetRevision)
    :row.content;
  const lines=content.split(/\r\n|\n|\r/),totalLines=lines.length;
  const start=options.lineStart===undefined?1:options.lineStart;
  if (!Number.isInteger(start)||start<1||start>totalLines+1) throw new StorageError('INVALID_LINE_RANGE');
  if (options.maxLines!==undefined) {
    const take=bounded(options.maxLines,2000);
    content=lines.slice(start-1,start-1+take).join('\n');
    return {...metadata,content,totalLines,lineStart:start,returnedLines:Math.min(take,Math.max(0,totalLines-start+1)),truncated:start-1+take<totalLines};
  }
  if (content.length>300_000) throw new StorageError('READ_REQUIRES_RANGE');
  return {...metadata,content,totalLines};
}
async function commitContent(env:Env,row:StoredRecord,content:string,expectedRevision:number,message:string,actor:string,tasks?:Task[]) {
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
  q.push(env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at) VALUES(?,?,?,?,?)').bind(row.id,'update',rev,actor,ts));
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
  if(row.kind==='task_list')throw new StorageError('TASK_LIST_RESTORE_NOT_IMPLEMENTED');
  const historic=historicalVersion({content:row.content,metadata:row.history_metadata},targetRevision);
  return commitContent(env,row,historic,expectedRevision,'Restored revision '+targetRevision,actor);
}
export async function listVersions(env:Env,id:string,limit=50) {
  await getRecord(env,id);
  const res=await env.DB.prepare('SELECT revision,content_sha256,message,actor,created_at FROM revisions WHERE record_id=? ORDER BY revision DESC LIMIT ?')
    .bind(id,bounded(limit,200)).all();
  return res.results;
}
export async function updateMeta(env:Env,id:string,updates:{name?:string;folderId?:string|null;status?:RecordStatus;description?:string},actor='agent') {
  const row=await getRecord(env,id);
  const ts=now(),name=updates.name===undefined?row.name:nameCheck(updates.name);
  const folderId=updates.folderId===undefined?row.folder_id:updates.folderId;
  if(folderId && !(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))throw new StorageError('FOLDER_NOT_FOUND');
  const status=updates.status??row.status;
  const statements=[
    env.DB.prepare('UPDATE records SET name=?,folder_id=?,status=?,description=?,updated_at=? WHERE id=?')
      .bind(name,folderId,status,updates.description??row.description,ts,id),
    env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at) VALUES(?,?,?,?,?)')
      .bind(id,'metadata',row.revision,actor,ts)
  ];
  // Search vectors contain the record name and are suppressed when archived.
  // Reindex name/status changes even though they do not advance content revisions.
  if(name!==row.name||status!==row.status)
    statements.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,?,?)')
      .bind(newId(),id,row.revision,ts));
  await env.DB.batch(statements);
  return {id,name,folderId,status:updates.status??row.status};
}
export async function tagRecord(env:Env,id:string,tag:string,action:'add'|'remove',actor='agent') {
  await getRecord(env,id);
  tag=tag.trim().toLowerCase();
  if(!tag||tag.length>64)throw new StorageError('INVALID_TAG');
  const ts=now();
  if(action==='add') {
    const tagId=newId();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO tags(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING').bind(tagId,tag),
      env.DB.prepare('INSERT OR IGNORE INTO record_tags(record_id,tag_id) SELECT ?,id FROM tags WHERE name=?').bind(id,tag),
      env.DB.prepare('INSERT INTO change_events(record_id,event_type,actor,created_at) VALUES(?,?,?,?)').bind(id,'tag_add',actor,ts)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM record_tags WHERE record_id=? AND tag_id IN (SELECT id FROM tags WHERE name=?)').bind(id,tag),
      env.DB.prepare('INSERT INTO change_events(record_id,event_type,actor,created_at) VALUES(?,?,?,?)').bind(id,'tag_remove',actor,ts)
    ]);
  }
  return {id,tag,action};
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
  const result=await commitContent(env,row,content,expectedRevision,'Task '+action,actor,tasks);
  return {...result,tasks};
}
export async function getTasks(env:Env,recordId?:string,status?:TaskStatus,limit=100) {
  const where:string[]=[];const args:(string|number)[]=[];
  if(recordId){where.push('t.record_id=?');args.push(recordId);}
  if(status){where.push('t.status=?');args.push(status);}
  const rows=await env.DB.prepare('SELECT t.* FROM tasks t JOIN records r ON r.id=t.record_id WHERE r.status != \'archived\' '+(where.length?'AND '+where.join(' AND '):'')+' ORDER BY t.updated_at DESC LIMIT ?')
    .bind(...args,bounded(limit,200)).all();
  return rows.results;
}
export async function context(env:Env,folderId:string|null=null,limit=25) {
  const info=folderId?await env.DB.prepare('SELECT id,parent_id,name,description FROM folders WHERE id=?').bind(folderId).first():null;
  if(folderId&&!info)throw new StorageError('FOLDER_NOT_FOUND');
  const list=await env.DB.prepare('SELECT r.id,r.name,r.kind,r.status,r.description,r.updated_at,c.revision FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.folder_id IS ? AND r.status != \'archived\' ORDER BY r.updated_at DESC LIMIT ?')
    .bind(folderId,bounded(limit,80)).all();
  const ids=list.results.map(r=>String(r.id));
  const todo=ids.length?await env.DB.prepare('SELECT id,record_id,title,status,priority FROM tasks WHERE record_id IN ('+ids.map(()=>'?').join(',')+') AND status NOT IN (\'done\',\'cancelled\') ORDER BY priority DESC LIMIT 60').bind(...ids).all():{results:[]};
  return {folder:info,records:list.results,openTasks:todo.results};
}
export async function changesSince(env:Env,cursor=0,limit=50) {
  const res=await env.DB.prepare('SELECT * FROM change_events WHERE seq>? ORDER BY seq LIMIT ?').bind(cursor,bounded(limit,200)).all();
  const rows=res.results as Array<{seq:number}>;
  return {events:rows,nextCursor:rows.at(-1)?.seq??cursor};
}

export async function manageFolder(env:Env,id:string,changes:{name?:string;parentId?:string|null;description?:string},actor='agent') {
  const folder=await env.DB.prepare('SELECT id,parent_id,name,description FROM folders WHERE id=?')
    .bind(id).first<{id:string;parent_id:string|null;name:string;description:string}>();
  if(!folder)throw new StorageError('FOLDER_NOT_FOUND');
  const parentId=changes.parentId===undefined?folder.parent_id:changes.parentId;
  const name=changes.name===undefined?folder.name:nameCheck(changes.name);
  if(parentId) {
    if(!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(parentId).first()))throw new StorageError('FOLDER_NOT_FOUND');
    const cycle=await env.DB.prepare(
      'WITH RECURSIVE subtree(id) AS (SELECT id FROM folders WHERE id=? UNION ALL SELECT f.id FROM folders f JOIN subtree s ON f.parent_id=s.id) SELECT id FROM subtree WHERE id=? LIMIT 1'
    ).bind(id,parentId).first();
    if(cycle)throw new StorageError('FOLDER_CYCLE');
  }
  const ts=now();
  await env.DB.batch([
    env.DB.prepare('UPDATE folders SET name=?,parent_id=?,description=?,updated_at=? WHERE id=?')
      .bind(name,parentId,changes.description??folder.description,ts,id),
    env.DB.prepare('INSERT INTO change_events(record_id,event_type,actor,created_at) VALUES(NULL,?,?,?)')
      .bind('folder:'+id+':updated',actor,ts)
  ]);
  return {id,name,parentId,description:changes.description??folder.description};
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
