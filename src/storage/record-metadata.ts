import type {Env,RecordStatus} from '../types.js';
import {StorageError} from '../types.js';
import {now,newId,event,recordExtras,nameCheck} from './internal.js';
import {getRecord} from './record-core.js';
export async function updateMeta(env:Env,id:string,updates:{
  name?:string;folderId?:string|null;status?:RecordStatus;description?:string;expectedMetadataRevision?:number
},actor='agent'){
 const row=await getRecord(env,id),expected=updates.expectedMetadataRevision;
 if(expected!==undefined&&expected!==row.metadata_revision)
  throw new StorageError('METADATA_CONFLICT','Current metadataRevision is '+row.metadata_revision);
 const name=updates.name===undefined?row.name:nameCheck(updates.name);
 const status=updates.status??row.status;
 const description=updates.description??row.description;
 const archiving=row.status!=='archived'&&status==='archived';
 const restoring=row.status==='archived'&&status!=='archived';
 if(status==='archived'&&updates.folderId!==undefined)
  throw new StorageError('ARCHIVED_RECORD_NO_FOLDER','Archived records cannot be placed in active folders');
 let folderId=row.folder_id;
 let archivedFromPath=row.archived_from_path;
 let archivedFromFolderId=row.archived_from_folder_id;
 let archivedAt=row.archived_at;
 if(archiving){
  const extras=await recordExtras(env,row.folder_id,row.id);
  archivedFromPath=extras.path+(row.folder_id?'/':'')+row.name;
  archivedFromFolderId=row.folder_id;
  archivedAt=now();
  folderId=null;
 }else if(restoring){
  folderId=updates.folderId===undefined?row.archived_from_folder_id:updates.folderId;
  archivedFromPath=null;archivedFromFolderId=null;archivedAt=null;
 }else if(status!=='archived'){
  folderId=updates.folderId===undefined?row.folder_id:updates.folderId;
 }
 if(folderId&&!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))
  throw new StorageError(restoring?'RESTORE_DESTINATION_REQUIRED':'FOLDER_NOT_FOUND',
   restoring?'Original folder no longer exists; choose an existing folderId (null for root)':'Folder not found');
 if(name===row.name&&folderId===row.folder_id&&status===row.status&&description===row.description)
  return {id,name,folderId,status,metadataRevision:row.metadata_revision,changed:false,archivedFromPath};
 const next=row.metadata_revision+1,ts=now();
 const stmts=[
  env.DB.prepare('UPDATE records SET name=?,folder_id=?,status=?,description=?,archived_from_path=?,archived_from_folder_id=?,archived_at=?,updated_at=?,metadata_revision=? WHERE id=? AND metadata_revision=?')
   .bind(name,folderId,status,description,archivedFromPath,archivedFromFolderId,archivedAt,ts,next,id,row.metadata_revision),
  env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)')
   .bind(id,'metadata',row.revision,actor,ts,'record',id,JSON.stringify({name,folderId,status,description,metadataRevision:next,archivedFromPath}),id,next)
 ];
 if(name!==row.name||status!==row.status)
  stmts.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) SELECT ?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)')
   .bind(newId(),id,row.revision,ts,id,next));
 const result=await env.DB.batch(stmts);
 if((result[0]?.meta?.changes??0)!==1)throw new StorageError('METADATA_CONFLICT','Current metadataRevision changed; re-read the record');
 return {id,name,folderId,status,metadataRevision:next,changed:true,archivedFromPath};
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
