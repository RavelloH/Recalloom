import type {Env,RecordKind,StoredRecord} from '../types.js';
import {StorageError} from '../types.js';
import {sha256,initialVersion,historicalVersion} from '../version.js';
import {prepareWikiProjection,insertProjection,pinPathBindings,resolveNewWikiTarget} from '../wiki-references.js';
import {now,newId,event,recordExtras,normalizeTags,bounded,nameCheck} from './internal.js';
import {resolvePath} from './folders.js';
export async function getRecord(env: Env, id: string): Promise<StoredRecord> {
  const row = await env.DB.prepare('SELECT r.*,c.content,h.history_metadata,c.revision,c.content_sha256 FROM records r JOIN record_contents c ON c.record_id=r.id JOIN record_histories h ON h.record_id=r.id WHERE r.id=?').bind(id).first<StoredRecord>();
  if (!row) throw new StorageError('RECORD_NOT_FOUND');
  return row;
}

export async function revisionContent(env:Env,row:StoredRecord,targetRevision:number,expectedSha?:string):Promise<string>{
 if(!Number.isInteger(targetRevision)||targetRevision<1||targetRevision>row.revision)
  throw new StorageError('REVISION_NOT_FOUND');
 const expected=expectedSha??(await env.DB.prepare(
  'SELECT content_sha256 FROM revisions WHERE record_id=? AND revision=?'
 ).bind(row.id,targetRevision).first<{content_sha256:string}>())?.content_sha256;
 if(!expected)throw new StorageError('REVISION_NOT_FOUND');
 const content=targetRevision===row.revision
  ?row.content
  :historicalVersion({content:row.content,metadata:row.history_metadata},targetRevision);
 if(await sha256(content)!==expected)
  throw new StorageError('HISTORY_INTEGRITY_ERROR','Historical revision '+targetRevision+' failed its checksum');
 return content;
}

export async function createRecord(env: Env, input:{name:string;folderId?:string|null;kind?:RecordKind;description?:string;content?:string;tags?:string[]}, actor='agent') {
  const id=newId(), ts=now(), name=nameCheck(input.name), folderId=input.folderId??null,kind=input.kind??'document',tags=normalizeTags(input.tags);
  if (folderId && !(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))
    throw new StorageError('FOLDER_NOT_FOUND');
  const content = kind==='task_list' ? JSON.stringify({tasks:[]},null,2) : (input.content??'');
  if (kind==='task_list' && input.content && input.content.trim()!==content)
    throw new StorageError('TASK_LIST_CONTENT_MANAGED','Use tasks to modify task lists');
  if (content.length > 500_000) throw new StorageError('CONTENT_TOO_LARGE');
  const version=initialVersion(content),digest=await sha256(content);
  const wikiRefs=kind==='document'?await prepareWikiProjection(env,id,content,1,resolvePath):[];
  const existingFolder=await env.DB.prepare('SELECT id FROM folders WHERE parent_id IS ? AND name=?')
   .bind(folderId,name).first();
  const virtualPrefix=(await recordExtras(env,folderId,id)).path;
  const newPath=existingFolder?null:virtualPrefix+(folderId?'/':'')+name;
  const statements=[
    env.DB.prepare('INSERT INTO records(id,folder_id,name,kind,status,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,folderId,name,kind,'active',input.description??'',ts,ts),
    env.DB.prepare('INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,?,?)')
      .bind(id,content,1,digest),
    env.DB.prepare('INSERT INTO record_histories(record_id,history_metadata) VALUES(?,?)').bind(id,version.metadata),
    env.DB.prepare('INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id,1,digest,'Created',actor,ts),
    env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,?,?)')
      .bind(newId(),id,1,ts),
    ...(wikiRefs.length?[pinPathBindings(env,wikiRefs),insertProjection(env,wikiRefs)]:[]),
    ...resolveNewWikiTarget(env,id,newPath),
    ...tags.flatMap(tag=>[
      env.DB.prepare('INSERT INTO tags(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING').bind(newId(),tag),
      env.DB.prepare('INSERT OR IGNORE INTO record_tags(record_id,tag_id) SELECT ?,id FROM tags WHERE name=?').bind(id,tag)
    ]),
    event(env,'record',id,'create',1,actor,{name,folderId,kind,tags})
  ];
  await env.DB.batch(statements);
  return {id,name,kind,tags,revision:1,contentSha256:digest};
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
  const metadata={id:row.id,name:row.name,folderId:row.folder_id,path:row.status==='archived'?(row.archived_from_path??'/'+row.name):extras.path+(row.folder_id?'/':'')+row.name,archivedFromPath:row.archived_from_path,archivedFromFolderId:row.archived_from_folder_id,archivedAt:row.archived_at,tags:extras.tags,kind:row.kind,status:row.status,description:row.description,metadataRevision:row.metadata_revision,revision:targetRevision,currentRevision:row.revision,contentSha256,updatedAt:row.updated_at};
  if(options.metadataOnly)return metadata;
  let content=targetRevision!==row.revision
    ?await revisionContent(env,row,targetRevision,contentSha256)
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
