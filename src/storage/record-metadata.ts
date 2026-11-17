import {INDEX_JOB_UPSERT} from '../index-queue.js';
import type {Env,RecordStatus} from '../types.js';
import {StorageError} from '../types.js';
import {now,newId,event,recordExtras,nameCheck} from './internal.js';
import {getRecord} from './record-core.js';
import {assignTag} from '../tags/mutations.js';
import { existingVectors, prepareDocumentTags } from '../tags/engine.js';
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
 // A description-only edit does not invalidate vectors but does affect Clef decisions.
 // If an index is pending, its own final tagging phase will use the latest description.
 let tagPlan: Awaited<ReturnType<typeof prepareDocumentTags>> | null = null;
 if (description !== row.description && name === row.name && status === row.status &&
     status !== 'archived') {
   const idx = await env.DB.prepare(
     'SELECT state,indexed_revision FROM index_jobs WHERE record_id=?'
   ).bind(id).first<{state:string;indexed_revision:number|null}>();
   if (idx?.state === 'done' && idx.indexed_revision === row.revision) {
     const vectors = await existingVectors(env,id);
     tagPlan = await prepareDocumentTags(env,id,vectors,{description});
   }
 }
 const next=row.metadata_revision+1,ts=now();
 const stmts=[
  env.DB.prepare('UPDATE records SET name=?,folder_id=?,status=?,description=?,archived_from_path=?,archived_from_folder_id=?,archived_at=?,updated_at=?,metadata_revision=? WHERE id=? AND metadata_revision=?')
   .bind(name,folderId,status,description,archivedFromPath,archivedFromFolderId,archivedAt,ts,next,id,row.metadata_revision),
  env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)')
   .bind(id,'metadata',row.revision,actor,ts,'record',id,JSON.stringify({name,folderId,status,description,metadataRevision:next,archivedFromPath}),id,next)
 ];
 if(name!==row.name||status!==row.status)
  stmts.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) SELECT ?,?,?,? WHERE changes()>0 AND EXISTS(SELECT 1 FROM records WHERE id=? AND metadata_revision=?)'+INDEX_JOB_UPSERT)
   .bind(newId(),id,row.revision,ts,id,next));
 if (tagPlan) {
   stmts.unshift(...tagPlan.guards);
   stmts.push(...tagPlan.statements);
 }
 const result=await env.DB.batch(stmts);
 // D1 includes trigger writes in meta.changes. Task-list visibility also
 // advances the ordering version, so a successful update can report > 1.
 if((result[tagPlan?.guards.length ?? 0]?.meta?.changes??0)<1)
   throw new StorageError('METADATA_CONFLICT','Current metadataRevision changed; re-read the record');
 const updated = tagPlan ? await getRecord(env,id) : null;
 return {id,name,folderId,status,metadataRevision:updated?.metadata_revision??next,changed:true,archivedFromPath};
}

export async function tagRecord(env:Env,id:string,tag:string,action:'add'|'remove',actor='agent',expectedMetadataRevision?:number){
 const row=await getRecord(env,id);
 return assignTag(env,id,{tag,action,expectedMetadataRevision:expectedMetadataRevision??row.metadata_revision},actor);
}
