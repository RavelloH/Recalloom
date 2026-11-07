import type {Env} from './types.js';
import {StorageError} from './types.js';
import {getRecord} from './storage.js';
import {sha256} from './version.js';
import {splitText} from './search.js';

const now=()=>new Date().toISOString();
type FolderRow={id:string;parentId:string|null;name:string;metadataRevision:number;depth:number};
type RecordRow={id:string;folderId:string;name:string;status:string;metadataRevision:number;revision:number};
type FolderSnapshot=FolderRow & {path:string};
type RecordSnapshot=RecordRow & {path:string};
type Inspection={id:string;path:string;folders:FolderSnapshot[];records:RecordSnapshot[];previewToken:string};
const MAX_FOLDERS=100;
const MAX_RECORDS=500;

async function inspectSubtree(env:Env,id:string,expectedMetadataRevision:number):Promise<Inspection>{
 const root=await env.DB.prepare('SELECT id,name,metadata_revision AS metadataRevision FROM folders WHERE id=?')
  .bind(id).first<{id:string;name:string;metadataRevision:number}>();
 if(!root)throw new StorageError('FOLDER_NOT_FOUND');
 if(root.metadataRevision!==expectedMetadataRevision)
  throw new StorageError('METADATA_CONFLICT','Folder changed; reload before deleting');
 const ancestors=(await env.DB.prepare(
  'WITH RECURSIVE a(id,parent_id,name,depth) AS ('+
  'SELECT id,parent_id,name,0 FROM folders WHERE id=? UNION ALL '+
  'SELECT f.id,f.parent_id,f.name,a.depth+1 FROM folders f JOIN a ON f.id=a.parent_id) '+
  'SELECT name FROM a ORDER BY depth DESC LIMIT 33'
 ).bind(id).all<{name:string}>()).results;
 if(ancestors.length>32)throw new StorageError('FOLDER_DEPTH_LIMIT');
 const path='/'+ancestors.map(x=>x.name).join('/');
 const folderRows=(await env.DB.prepare(
  'WITH RECURSIVE tree(id,depth) AS (SELECT id,0 FROM folders WHERE id=? UNION ALL '+
  'SELECT f.id,tree.depth+1 FROM folders f JOIN tree ON f.parent_id=tree.id) '+
  'SELECT f.id,f.parent_id AS parentId,f.name,f.metadata_revision AS metadataRevision,tree.depth '+
  'FROM tree JOIN folders f ON tree.id=f.id ORDER BY tree.depth,f.id LIMIT ?'
 ).bind(id,MAX_FOLDERS+1).all<FolderRow>()).results;
 if(folderRows.length>MAX_FOLDERS)throw new StorageError('FOLDER_OPERATION_LIMIT','Delete at most 100 nested folders in one atomic operation');
 const paths=new Map<string,string>();
 const folders=folderRows.map(f=>{
  const current=f.id===id?path:(paths.get(f.parentId??'')??path)+'/'+f.name;
  paths.set(f.id,current);
  return {...f,path:current};
 });
 const folderIds=JSON.stringify(folders.map(f=>f.id));
 const recordRows=(await env.DB.prepare(
  'SELECT r.id,r.folder_id AS folderId,r.name,r.status,r.metadata_revision AS metadataRevision,'+
  'c.revision FROM records r JOIN record_contents c ON c.record_id=r.id '+
  'WHERE r.folder_id IN (SELECT value FROM json_each(?)) ORDER BY r.id LIMIT ?'
 ).bind(folderIds,MAX_RECORDS+1).all<RecordRow>()).results;
 if(recordRows.length>MAX_RECORDS)throw new StorageError('FOLDER_OPERATION_LIMIT','Delete at most 500 records in one atomic operation');
 const records=recordRows.map(r=>({...r,path:(paths.get(r.folderId)??path)+'/'+r.name}));
 const previewToken=await sha256(JSON.stringify({id,expectedMetadataRevision,folders,records}));
 return {id,path,folders,records,previewToken};
}

export async function previewDeleteFolder(env:Env,id:string,expectedMetadataRevision:number){
 const x=await inspectSubtree(env,id,expectedMetadataRevision);
 return {id,path:x.path,dryRun:true,previewToken:x.previewToken,
  foldersToDelete:x.folders.length,recordsToArchive:x.records.filter(r=>r.status!=='archived').length,
  alreadyArchived:x.records.filter(r=>r.status==='archived').length,
  recordsPermanentlyDeleted:0,previewPaths:x.records.slice(0,12).map(r=>r.path)};
}

/** One atomic transaction: guard the preview, detach every record, then delete leaves first.
 * A failed assertion, unexpected child or FK conflict rolls back the entire batch. */
export async function deleteFolder(env:Env,id:string,expectedMetadataRevision:number,previewToken:string,actor='agent'){
 const x=await inspectSubtree(env,id,expectedMetadataRevision);
 if(!previewToken||previewToken!==x.previewToken)
  throw new StorageError('STALE_DELETE_PREVIEW','Folder contents changed; run dryRun again');
 const folders=JSON.stringify(x.folders.map(f=>({id:f.id,parentId:f.parentId,name:f.name,metadataRevision:f.metadataRevision})));
 const records=JSON.stringify(x.records.map(r=>({
  id:r.id,folderId:r.folderId,name:r.name,status:r.status,metadataRevision:r.metadataRevision,revision:r.revision,path:r.path
 })));
 const ts=now();
 const statements:D1PreparedStatement[]=[
  // The CHECK constraint deliberately aborts the entire D1 batch on any
  // subtree version/name mismatch or newly introduced direct child record.
  env.DB.prepare(
   'INSERT INTO lifecycle_guards(value) SELECT CASE WHEN '+
   '(SELECT COUNT(*) FROM folders f JOIN json_each(?) j ON f.id=json_extract(j.value,\'$.id\') '+
   'WHERE f.parent_id IS json_extract(j.value,\'$.parentId\') AND f.name=json_extract(j.value,\'$.name\') '+
   'AND f.metadata_revision=json_extract(j.value,\'$.metadataRevision\'))=? AND '+
   '(SELECT COUNT(*) FROM records r JOIN record_contents c ON c.record_id=r.id '+
   'JOIN json_each(?) j ON r.id=json_extract(j.value,\'$.id\') '+
   'WHERE r.folder_id=json_extract(j.value,\'$.folderId\') AND r.name=json_extract(j.value,\'$.name\') '+
   'AND r.status=json_extract(j.value,\'$.status\') AND r.metadata_revision=json_extract(j.value,\'$.metadataRevision\') '+
   'AND c.revision=json_extract(j.value,\'$.revision\'))=? AND '+
   '(SELECT COUNT(*) FROM records WHERE folder_id IN (SELECT json_extract(value,\'$.id\') FROM json_each(?)))=? '+
   'THEN 1 ELSE 0 END'
  ).bind(folders,x.folders.length,records,x.records.length,folders,x.records.length)
 ];
 if(x.records.length){
  statements.push(env.DB.prepare(
   'UPDATE records SET status=\'archived\',folder_id=NULL,'+
   'archived_from_path=COALESCE(archived_from_path,(SELECT json_extract(value,\'$.path\') FROM json_each(?) WHERE json_extract(value,\'$.id\')=records.id)),'+
   'archived_from_folder_id=COALESCE(archived_from_folder_id,folder_id),archived_at=COALESCE(archived_at,?),'+
   'updated_at=?,metadata_revision=metadata_revision+1 '+
   'WHERE id IN (SELECT json_extract(value,\'$.id\') FROM json_each(?))'
  ).bind(records,ts,ts,records));
  statements.push(env.DB.prepare(
   'INSERT INTO index_jobs(id,record_id,revision,created_at) '+
   'SELECT lower(hex(randomblob(16))),r.id,c.revision,? FROM records r JOIN record_contents c ON c.record_id=r.id '+
   'WHERE r.id IN (SELECT json_extract(value,\'$.id\') FROM json_each(?))'
  ).bind(ts,records));
  statements.push(env.DB.prepare(
   'INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) '+
   'SELECT json_extract(value,\'$.id\'),\'metadata\',json_extract(value,\'$.revision\'),?,?,'+
   '\'record\',json_extract(value,\'$.id\'),'+
   'json_object(\'status\',\'archived\',\'archivedFromPath\',json_extract(value,\'$.path\'),\'source\',\'folder_delete\') '+
   'FROM json_each(?)'
  ).bind(actor,ts,records));
 }
 for(const f of [...x.folders].reverse()){
  statements.push(env.DB.prepare('DELETE FROM folders WHERE id=? AND metadata_revision=?').bind(f.id,f.metadataRevision));
 }
 statements.push(env.DB.prepare(
  'INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) '+
  'SELECT NULL,\'folder_delete\',NULL,?,?,'+
  '\'folder\',json_extract(value,\'$.id\'),json_object(\'name\',json_extract(value,\'$.name\'),\'parentId\',json_extract(value,\'$.parentId\')) '+
  'FROM json_each(?)'
 ).bind(actor,ts,folders));
 statements.push(env.DB.prepare('DELETE FROM lifecycle_guards'));
 try{await env.DB.batch(statements);}catch(error){
  const message=error instanceof Error?error.message:String(error);
  if(/lifecycle_guards|FOREIGN KEY constraint failed/i.test(message))
   throw new StorageError('STALE_DELETE_PREVIEW','Folder contents changed during deletion; preview again');
  throw error;
 }
 return {id,path:x.path,deleted:true,foldersDeleted:x.folders.length,
  recordsArchived:x.records.filter(r=>r.status!=='archived').length,recordsPermanentlyDeleted:0};
}

/** The only record deletion path. The caller must have read the archived record
 * and both versions; external vector deletion is durably queued before CASCADE. */
export async function deleteArchivedRecord(env:Env,id:string,expectedMetadataRevision:number,expectedRevision:number,dryRun=true,actor='agent'){
 const row=await getRecord(env,id);
 if(row.status!=='archived')throw new StorageError('RECORD_NOT_ARCHIVED','Archive the record before permanent deletion');
 if(row.metadata_revision!==expectedMetadataRevision||row.revision!==expectedRevision)
  throw new StorageError('METADATA_CONFLICT','Record changed; re-read before permanent deletion');
 const [versions,tasks,relations,wiki,chunkRows]=await Promise.all([
  env.DB.prepare('SELECT COUNT(*) AS n FROM revisions WHERE record_id=?').bind(id).first<{n:number}>(),
  env.DB.prepare('SELECT COUNT(*) AS n FROM tasks WHERE record_id=?').bind(id).first<{n:number}>(),
  env.DB.prepare('SELECT COUNT(*) AS n FROM record_links WHERE source_id=? OR target_id=?').bind(id,id).first<{n:number}>(),
  env.DB.prepare('SELECT COUNT(*) AS n FROM record_references WHERE target_id=?').bind(id).first<{n:number}>(),
  env.DB.prepare('SELECT chunk_id FROM search_chunks WHERE record_id=?').bind(id).all<{chunk_id:string}>()
 ]);
 const count=Math.max(splitText(row.name+'\n'+row.content).length,
  ...chunkRows.results.map(r=>Number(r.chunk_id.split(':').at(-1))+1).filter(Number.isFinite),0);
 if(count>8000)throw new StorageError('VECTOR_CLEANUP_LIMIT','Too many vector IDs to safely queue');
 const ids=[...new Set([...chunkRows.results.map(r=>r.chunk_id),
  ...Array.from({length:count},(_,i)=>id+':'+i)])];
 const impact={id,archivedFromPath:row.archived_from_path,
  revisions:Number(versions?.n??0),tasks:Number(tasks?.n??0),
  manualRelations:Number(relations?.n??0),incomingWikiReferences:Number(wiki?.n??0),
  vectorIdsToRemove:ids.length};
 if(dryRun)return {...impact,dryRun:true,deleted:false};
 const ts=now();
 try{await env.DB.batch([
  env.DB.prepare(
   'INSERT INTO lifecycle_guards(value) SELECT CASE WHEN EXISTS('+
   'SELECT 1 FROM records r JOIN record_contents c ON c.record_id=r.id '+
   'WHERE r.id=? AND r.status=\'archived\' AND r.metadata_revision=? AND c.revision=?) THEN 1 ELSE 0 END'
  ).bind(id,expectedMetadataRevision,expectedRevision),
  env.DB.prepare(
   'INSERT INTO vector_delete_jobs(record_id,chunk_ids,created_at) VALUES(?,?,?)'
  ).bind(id,JSON.stringify(ids),ts),
  // ON DELETE SET NULL preserves incoming Wiki references. Mark their
  // resolution state missing in the same transaction, not falsely resolved.
  env.DB.prepare("UPDATE record_references SET resolution_status='missing' WHERE target_id=?").bind(id),
  env.DB.prepare('DELETE FROM records WHERE id=? AND status=\'archived\' AND metadata_revision=?')
   .bind(id,expectedMetadataRevision),
  env.DB.prepare(
   'INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(id,'record_delete',expectedRevision,actor,ts,'record',id,JSON.stringify(impact)),
  env.DB.prepare('DELETE FROM lifecycle_guards')
 ]);}catch(error){
  const message=error instanceof Error?error.message:String(error);
  if(/lifecycle_guards/i.test(message))
   throw new StorageError('METADATA_CONFLICT','Archived record changed during permanent deletion');
  throw error;
 }
 return {...impact,dryRun:false,deleted:true,vectorCleanupQueued:true};
}

/** Cleanup jobs are intentionally NOT FK-linked to records; failed external
 * operations survive irreversible D1 deletion and can be retried by cron. */
export async function processVectorDeleteJobs(env:Env,limit=3){
 const cutoff=new Date(Date.now()-5*60*1000).toISOString();
 const jobs=(await env.DB.prepare(
  'SELECT record_id AS recordId,chunk_ids AS chunkIds FROM vector_delete_jobs '+
  'WHERE attempts<10 AND (state IN (\'pending\',\'failed\') OR (state=\'running\' AND (started_at IS NULL OR started_at<?))) '+
  'ORDER BY created_at LIMIT ?'
 ).bind(cutoff,Math.max(1,Math.min(limit,10))).all<{recordId:string;chunkIds:string}>()).results;
 const results:Array<{recordId:string;deleted?:boolean;error?:string}>=[];
 for(const job of jobs){
  const claim=await env.DB.prepare(
   'UPDATE vector_delete_jobs SET state=\'running\',started_at=?,attempts=attempts+1 WHERE record_id=? AND attempts<10 '+
   'AND (state IN (\'pending\',\'failed\') OR (state=\'running\' AND (started_at IS NULL OR started_at<?)))'
  ).bind(now(),job.recordId,cutoff).run();
  if(!claim.meta.changes)continue;
  try{
   const ids=JSON.parse(job.chunkIds) as string[];
   if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid vector cleanup manifest');
   for(let i=0;i<ids.length;i+=100)await env.VECTORIZE.deleteByIds(ids.slice(i,i+100));
   await env.DB.prepare('DELETE FROM vector_delete_jobs WHERE record_id=?').bind(job.recordId).run();
   results.push({recordId:job.recordId,deleted:true});
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   await env.DB.prepare('UPDATE vector_delete_jobs SET state=\'failed\',started_at=NULL,last_error=? WHERE record_id=?')
    .bind(message.slice(0,600),job.recordId).run();
   results.push({recordId:job.recordId,error:message});
  }
 }
 return {processed:results.length,results};
}
