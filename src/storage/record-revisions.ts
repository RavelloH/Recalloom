import type {Env,EditInput,StoredRecord,Task} from '../types.js';
import {StorageError} from '../types.js';
import {sha256,nextVersion,editContent} from '../version.js';
import {prepareWikiProjection,deleteProjection,insertProjection,pinPathBindings} from '../wiki-references.js';
import {now,newId,event,bounded} from './internal.js';
import {resolvePath} from './folders.js';
import {getRecord,revisionContent} from './record-core.js';
export async function commitContent(env:Env,row:StoredRecord,content:string,expectedRevision:number,message:string,actor:string,tasks?:Task[],taskEvent?:unknown) {
  if (expectedRevision!==row.revision) throw new StorageError('VERSION_CONFLICT','Latest revision is '+row.revision);
  if (content.length>500_000) throw new StorageError('CONTENT_TOO_LARGE');
  if (content===row.content) return {id:row.id,revision:row.revision,changed:false,contentSha256:row.content_sha256};
  const rev=row.revision+1,ts=now(),digest=await sha256(content);
  const version=nextVersion({content:row.content,metadata:row.history_metadata},content,rev);
  const wikiRefs=row.kind==='document'?await prepareWikiProjection(env,row.id,content,rev,resolvePath):null;
  const q=[
    env.DB.prepare('UPDATE record_contents SET content=?,revision=?,content_sha256=? WHERE record_id=? AND revision=?')
      .bind(content,rev,digest,row.id,expectedRevision),
    env.DB.prepare('UPDATE record_histories SET history_metadata=? WHERE record_id=?')
      .bind(version.metadata,row.id),
    // Unique revision collision rolls back the entire batch on stale concurrent edits.
    env.DB.prepare('INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,?,?,?,?,?)')
      .bind(row.id,rev,digest,message,actor,ts),
    env.DB.prepare('UPDATE records SET updated_at=? WHERE id=?').bind(ts,row.id)
  ];
  if(wikiRefs){
   if(wikiRefs.length)q.push(pinPathBindings(env,wikiRefs));
   q.push(deleteProjection(env,row.id));
   if(wikiRefs.length)q.push(insertProjection(env,wikiRefs));
  }
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
  const historic=await revisionContent(env,row,targetRevision);
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
