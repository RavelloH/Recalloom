import type {Env} from '../types.js';
import {StorageError} from '../types.js';
import {bounded} from './internal.js';

type ArchiveCursor={updatedAt:string;id:string;query:string};

export async function archivedRecords(env:Env,limit=50,cursor?:string,query=''){
 const size=bounded(limit,100),filter=query.trim().slice(0,200);
 let from:ArchiveCursor|undefined;
 if(cursor){
  try{
   from=JSON.parse(cursor) as ArchiveCursor;
   if(!from||typeof from.updatedAt!=='string'||typeof from.id!=='string'||from.query!==filter
     ||!from.updatedAt||!from.id)throw Error();
  }catch{throw new StorageError('INVALID_CURSOR');}
 }
 const rows=(await env.DB.prepare(
  "SELECT r.id,r.name,r.kind,r.status,r.description,r.folder_id AS folderId,r.archived_from_path AS archivedFromPath,"+
  "r.archived_from_folder_id AS archivedFromFolderId,r.archived_at AS archivedAt,r.metadata_revision AS metadataRevision,"+
  "r.updated_at AS updatedAt,c.revision FROM records r JOIN record_contents c ON c.record_id=r.id "+
  "WHERE r.status='archived' AND (?='' OR instr(lower(r.name),lower(?))>0 OR instr(lower(coalesce(r.archived_from_path,'')),lower(?))>0) "+
  "AND (? IS NULL OR r.updated_at<? OR (r.updated_at=? AND r.id>?)) ORDER BY r.updated_at DESC,r.id LIMIT ?"
 ).bind(filter,filter,filter,from?.updatedAt??null,from?.updatedAt??'',from?.updatedAt??'',from?.id??'',size+1).all()).results as Array<{id:string;updatedAt:string;archivedFromPath:string|null}>;
 const items=rows.slice(0,size).map(row=>{
  const path=String((row as Record<string,unknown>).archivedFromPath??'');
  const parts=path.split('/').filter(Boolean);
  return {...row,folderName:parts.length>1?parts[parts.length-2]:null};
 });
 const last=items.at(-1);
 return {items,page:{hasMore:rows.length>size,nextCursor:rows.length>size?JSON.stringify({updatedAt:last?.updatedAt,id:last?.id,query:filter}):null}};
}
