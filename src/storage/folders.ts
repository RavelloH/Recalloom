import type {Env} from '../types.js';
import {StorageError} from '../types.js';
import {now,newId,event,bounded,nameCheck} from './internal.js';

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
      env.DB.prepare("SELECT r.id,r.folder_id AS folderId,r.name,r.kind,r.status,r.description,r.metadata_revision AS metadataRevision,r.updated_at AS updatedAt,c.revision,(SELECT json_group_array(t.name) FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=r.id) AS tags FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.folder_id IS ? AND r.status!='archived' AND (? IS NULL OR r.updated_at<? OR (r.updated_at=? AND r.id>?)) ORDER BY r.updated_at DESC,r.id LIMIT ?")
        .bind(folderId,state.lastRecord?.updatedAt??null,state.lastRecord?.updatedAt??'',state.lastRecord?.updatedAt??'',state.lastRecord?.id??'',size+1).all()
  ]);
  const folders=folderRows.results.slice(0,size) as Array<Record<string,unknown>>;
  const recordAllowance=Math.max(0,size-folders.length);
  const records=recordRows.results.slice(0,recordAllowance) as Array<Record<string,unknown>>;
  const folderDone=state.folderDone||folderRows.results.length<=size;
  const recordDone=state.recordDone||recordRows.results.length===0||(recordAllowance>0&&recordRows.results.length<=recordAllowance);
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
    const record=await env.DB.prepare("SELECT id FROM records WHERE folder_id IS ? AND name=? AND status!='archived'").bind(folderId,name).first<{id:string}>();
    if(!record)throw new StorageError('PATH_NOT_FOUND');
    return {kind:'record',id:record.id,path};
  }
  throw new StorageError('PATH_NOT_FOUND');
}
