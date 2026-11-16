import type {Env} from '../types.js';
import {StorageError} from '../types.js';
import {bounded} from './internal.js';

type ArchiveSort='archived'|'oldest'|'name'|'path';
type ArchiveCursor={value:string;id:string;query:string;kind:string;sort:ArchiveSort};

export async function archivedRecords(env:Env,limit=50,cursor?:string,query='',kind='',sort:ArchiveSort='archived'){
 const size=bounded(limit,100),filter=query.trim().slice(0,200);
 if(!['','document','task_list'].includes(kind)||!['archived','oldest','name','path'].includes(sort))throw new StorageError('INVALID_INPUT');
 const column=sort==='name'?'lower(r.name)':sort==='path'?"coalesce(r.archived_from_path,r.name)":"coalesce(r.archived_at,r.updated_at)";
 const descending=sort==='archived',operator=descending?'<':'>';
 let from:ArchiveCursor|undefined;
 if(cursor){
  try{
   from=JSON.parse(cursor) as ArchiveCursor;
   if(!from||typeof from.value!=='string'||typeof from.id!=='string'||!from.id||from.query!==filter||from.kind!==kind||from.sort!==sort)throw Error();
  }catch{throw new StorageError('INVALID_CURSOR');}
 }
 const where="r.status='archived' AND (?='' OR instr(lower(r.name),lower(?))>0 OR instr(lower(coalesce(r.archived_from_path,'')),lower(?))>0) AND (?='' OR r.kind=?)";
 const params=[filter,filter,filter,kind,kind];
 const [result,count]=await env.DB.batch([env.DB.prepare(
  "SELECT r.id,r.name,r.kind,r.status,r.description,r.folder_id AS folderId,r.archived_from_path AS archivedFromPath,"+
  "r.archived_from_folder_id AS archivedFromFolderId,r.archived_at AS archivedAt,r.metadata_revision AS metadataRevision,"+
  "r.updated_at AS updatedAt,c.revision,"+column+" AS sortValue FROM records r JOIN record_contents c ON c.record_id=r.id WHERE "+where+
  " AND (? IS NULL OR "+column+operator+"? OR ("+column+"=? AND r.id>?)) ORDER BY "+column+(descending?' DESC':' ASC')+",r.id LIMIT ?"
 ).bind(...params,from?.value??null,from?.value??'',from?.value??'',from?.id??'',size+1),
 env.DB.prepare("SELECT count(*) AS total FROM records r JOIN record_contents c ON c.record_id=r.id WHERE "+where).bind(...params)]);
 const rows=result.results as Array<{id:string;sortValue:string;archivedFromPath:string|null}>;
 const items=rows.slice(0,size).map(({sortValue:_sortValue,...row})=>{
  const path=String((row as Record<string,unknown>).archivedFromPath??'');
  const parts=path.split('/').filter(Boolean);
  return {...row,folderName:parts.length>1?parts[parts.length-2]:null};
 });
 const last=rows[size-1];
 return {items,total:Number((count.results[0] as {total:number}|undefined)?.total??0),page:{hasMore:rows.length>size,nextCursor:rows.length>size?JSON.stringify({value:last.sortValue,id:last.id,query:filter,kind,sort}):null}};
}
