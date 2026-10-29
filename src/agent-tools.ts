import type { Env } from './types.js';
import { StorageError } from './types.js';
import { readRecord, getRecord } from './storage.js';
import { historicalVersion } from './version.js';
import { createTwoFilesPatch } from 'diff';
export { getOutline } from './outline.js';

const capped=(n:number|undefined,max:number,defaultValue:number)=>Math.min(max,Math.max(1,n??defaultValue));
type ReadSpec={id:string;revision?:number;offsetChars?:number};
export async function readMany(env:Env,items:ReadSpec[],maxChars=20000){
  // The budget covers the returned JSON, not just the document bodies.
  const budget=Math.min(60000,Math.max(1000,maxChars));
  const results:Array<Record<string,unknown>>=[];
  let remaining=budget-150;
  for(const [index,spec] of items.entries()){
    if(index>=12||remaining<300)break;
    try{
      const metadata=await readRecord(env,spec.id,{revision:spec.revision,metadataOnly:true});
      const row=await getRecord(env,spec.id);
      const content=(spec.revision!==undefined&&spec.revision!==row.revision)
        ?historicalVersion({content:row.content,metadata:row.history_metadata},spec.revision):row.content;
      const offset=spec.offsetChars??0;
      if(!Number.isInteger(offset)||offset<0||offset>content.length)throw new StorageError('INVALID_CONTENT_OFFSET');
      const header={...metadata,offsetChars:offset,totalChars:content.length};
      const overhead=JSON.stringify({...header,content:'',nextOffsetChars:null,truncated:false}).length+10;
      // Reserve space for JSON escaping, UTF-16 surrogate pairs and remaining items.
      const maxSlice=Math.max(0,Math.min(content.length-offset,Math.floor((remaining-overhead)/6)));
      let stop=offset+maxSlice;
      if(stop<content.length&&stop>offset&&/[\uD800-\uDBFF]/.test(content[stop-1]!))stop--;
      let part=content.slice(offset,stop);
      let item:Record<string,unknown>={...header,content:part,nextOffsetChars:stop<content.length?stop:null,truncated:stop<content.length};
      while(part.length>0 && JSON.stringify(item).length>remaining){
        stop=Math.max(offset,stop-Math.max(1,Math.ceil(part.length/8)));
        if(stop>offset&&/[\uD800-\uDBFF]/.test(content[stop-1]!))stop--;
        part=content.slice(offset,stop);
        item={...header,content:part,nextOffsetChars:stop<content.length?stop:null,truncated:stop<content.length};
      }
      if(JSON.stringify(item).length>remaining)break;
      results.push(item);
      remaining-=JSON.stringify(item).length+1;
      if(stop===offset&&stop<content.length)break;
    }catch(error){
      const item={id:spec.id,error:error instanceof StorageError?error.code:'READ_FAILED'};
      if(JSON.stringify(item).length>remaining)break;
      results.push(item);remaining-=JSON.stringify(item).length+1;
    }
  }
  return {items:results,page:{nextIndex:results.length<items.length?results.length:null},budgetChars:budget,usedChars:budget-remaining};
}
export async function diffRevisions(env:Env,id:string,fromRevision:number,toRevision:number) {
  const row=await getRecord(env,id);
  if(!Number.isInteger(fromRevision)||!Number.isInteger(toRevision)||fromRevision<1||toRevision<1
    ||fromRevision>row.revision||toRevision>row.revision)throw new StorageError('REVISION_NOT_FOUND');
  const version=(n:number)=>n===row.revision?row.content:historicalVersion({content:row.content,metadata:row.history_metadata},n);
  const before=version(fromRevision),after=version(toRevision);
  if(before.length+after.length>200_000)throw new StorageError('DIFF_REQUIRES_SMALLER_RECORD');
  const diff=createTwoFilesPatch(id+'@'+fromRevision,id+'@'+toRevision,before,after,'','',{context:3});
  return {id,fromRevision,toRevision,changed:before!==after,diff:diff.slice(0,120000),truncated:diff.length>120000};
}
type TagCursor={count:number;name:string};
export async function listTags(env:Env,limit=100,cursor?:string){
  const size=capped(limit,200,100);
  let state:TagCursor|undefined;
  if(cursor){
    try{state=JSON.parse(cursor) as TagCursor;if(!Number.isInteger(state.count)||state.count<0||typeof state.name!=='string')throw Error();}
    catch{throw new StorageError('INVALID_CURSOR');}
  }
  const rows=(await env.DB.prepare("SELECT t.name,COUNT(rt.record_id) AS count FROM tags t LEFT JOIN record_tags rt ON rt.tag_id=t.id GROUP BY t.id HAVING (? IS NULL OR count<? OR (count=? AND t.name>?)) ORDER BY count DESC,t.name LIMIT ?")
    .bind(state?.name??null,state?.count??0,state?.count??0,state?.name??'',size+1).all()).results;
  const items=rows.slice(0,size),last=items.at(-1);
  const hasMore=rows.length>size;
  return {items,page:{hasMore,nextCursor:hasMore?JSON.stringify({count:last?.count,name:last?.name}):null}};
}
type LinkCursor={relation:string;sourceId:string;targetId:string};
export async function links(env:Env,id:string,action:'list'|'add'|'remove'='list',targetId?:string,relation='related',actor='agent',cursor?:string){
  await getRecord(env,id);
  if(action==='list'){
    let state:LinkCursor|undefined;
    if(cursor){try{
      state=JSON.parse(cursor) as LinkCursor;
      if(!state||typeof state.relation!=='string'||typeof state.sourceId!=='string'||typeof state.targetId!=='string')throw Error();
    }catch{throw new StorageError('INVALID_CURSOR');}}
    const rows=(await env.DB.prepare("SELECT source_id AS sourceId,target_id AS targetId,relation FROM record_links WHERE (source_id=? OR target_id=?) AND (? IS NULL OR relation>? OR (relation=? AND (source_id>? OR (source_id=? AND target_id>?)))) ORDER BY relation,source_id,target_id LIMIT 201")
      .bind(id,id,state?.relation??null,state?.relation??'',state?.relation??'',state?.sourceId??'',state?.sourceId??'',state?.targetId??'').all()).results;
    const items=rows.slice(0,200),last=items.at(-1),hasMore=rows.length>200;
    return {items,page:{hasMore,nextCursor:hasMore?JSON.stringify({relation:last?.relation,sourceId:last?.sourceId,targetId:last?.targetId}):null}};
  }
  if(!targetId||targetId===id)throw new StorageError('INVALID_LINK');
  await getRecord(env,targetId);
  relation=relation.trim();
  if(!relation||relation.length>64)throw new StorageError('INVALID_RELATION');
  const existing=await env.DB.prepare('SELECT 1 AS found FROM record_links WHERE source_id=? AND target_id=? AND relation=?').bind(id,targetId,relation).first();
  if((action==='add'&&existing)||(action==='remove'&&!existing))return {id,targetId,relation,changed:false};
  const stmt=action==='add'
    ?env.DB.prepare('INSERT INTO record_links(source_id,target_id,relation) VALUES(?,?,?)')
    :env.DB.prepare('DELETE FROM record_links WHERE source_id=? AND target_id=? AND relation=?');
  const event=env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id,'link_'+action,null,actor,new Date().toISOString(),'record',id,JSON.stringify({targetId,relation}));
  await env.DB.batch([stmt.bind(id,targetId,relation),event]);
  return {id,targetId,relation,changed:true};
}
type ContextCursor={folderId:string|null;depth:number;recordDone:boolean;taskDone:boolean;record?:{rank:number;updatedAt:string;id:string};task?:{priority:number;id:string}};
export async function getOverview(env:Env,folderId:string|null=null,depth=2,budget=12000,cursor?:string){
  const maxDepth=Math.min(5,Math.max(0,depth)),maxBudget=Math.min(30000,Math.max(1000,budget));
  if(folderId&&!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))throw new StorageError('FOLDER_NOT_FOUND');
  let state:ContextCursor={folderId,depth:maxDepth,recordDone:false,taskDone:false};
  if(cursor){
    try{
      const parsed=JSON.parse(cursor) as ContextCursor;
      if(parsed.folderId!==folderId||parsed.depth!==maxDepth||typeof parsed.recordDone!=='boolean'||typeof parsed.taskDone!=='boolean')throw Error();
      state=parsed;
    }catch{throw new StorageError('INVALID_CURSOR');}
  }
  const tree="WITH RECURSIVE tree(id,depth) AS (SELECT id,CASE WHEN ? IS NULL THEN 1 ELSE 0 END FROM folders WHERE (? IS NULL AND parent_id IS NULL) OR id=? UNION ALL SELECT f.id,t.depth+1 FROM folders f JOIN tree t ON f.parent_id=t.id WHERE t.depth<?) ";
  const membership="((? IS NULL AND r.folder_id IS NULL) OR r.folder_id IN (SELECT id FROM tree))";
  const args=[folderId,folderId,folderId,maxDepth,folderId];
  // No special checkpoint/project ordering in a general knowledge library.
  const rank="0";
  const folder=folderId
    ?await env.DB.prepare('SELECT id,name,description FROM folders WHERE id=?').bind(folderId).first<{id:string;name:string;description:string}>()
    :{id:null,name:'Library',description:''};
  const recCursor=state.record;
  const taskCursor=state.task;
  const [recRows,taskRows]=await Promise.all([
    state.recordDone?Promise.resolve({results:[] as Array<Record<string,unknown>>}):
      env.DB.prepare(tree+"SELECT r.id,r.folder_id AS folderId,r.name,r.kind,r.status,substr(r.description,1,200) AS description,c.revision,r.updated_at AS updatedAt,"+rank+" AS rank,(SELECT json_group_array(t.name) FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=r.id) AS tags,substr(c.content,1,1200) AS excerpt FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.status!='archived' AND "+membership+
      " AND (? IS NULL OR "+rank+">? OR ("+rank+"=? AND (r.updated_at<? OR (r.updated_at=? AND r.id>?)))) ORDER BY rank,r.updated_at DESC,r.id LIMIT 81")
        .bind(...args,recCursor?.id??null,recCursor?.rank??0,recCursor?.rank??0,recCursor?.updatedAt??'',recCursor?.updatedAt??'',recCursor?.id??'').all(),
    state.taskDone?Promise.resolve({results:[] as Array<Record<string,unknown>>}):
      env.DB.prepare(tree+"SELECT t.id,t.record_id AS recordId,substr(t.title,1,400) AS title,t.status,t.priority FROM tasks t JOIN records r ON r.id=t.record_id WHERE r.status!='archived' AND "+membership+
      " AND t.status NOT IN ('done','cancelled') AND (? IS NULL OR t.priority<? OR (t.priority=? AND t.id>?)) ORDER BY t.priority DESC,t.id LIMIT 81")
        .bind(...args,taskCursor?.id??null,taskCursor?.priority??0,taskCursor?.priority??0,taskCursor?.id??'').all()
  ]);
  const records:Array<Record<string,unknown>>=[],openTasks:Array<Record<string,unknown>>=[];
  const rs=recRows.results,ts=taskRows.results;
  let remaining=maxBudget-300-JSON.stringify(folder).length,taskBudget=Math.floor(maxBudget*0.4);
  for(const task of ts){
    const size=JSON.stringify(task).length+1;
    if(size>taskBudget||size>remaining)break;
    openTasks.push(task);remaining-=size;taskBudget-=size;
  }
  for(const record of rs){
    const item={...record,tags:JSON.parse(String(record.tags??'[]'))} as Record<string,unknown>;
    const overhead=JSON.stringify({...item,excerpt:''}).length+2;
    if(overhead>=remaining)break;
    item.excerpt=String(item.excerpt??'').slice(0,Math.floor((remaining-overhead)/6));
    const size=JSON.stringify(item).length+1;
    if(size>remaining)break;
    records.push(item);remaining-=size;
  }
  const lastRecord=records.at(-1),lastTask=openTasks.at(-1);
  const recordDone=state.recordDone||records.length===rs.length,taskDone=state.taskDone||openTasks.length===ts.length;
  const next:ContextCursor={
    folderId,depth:maxDepth,recordDone,taskDone,
    record:lastRecord?{rank:Number(lastRecord.rank),updatedAt:String(lastRecord.updatedAt),id:String(lastRecord.id)}:state.record,
    task:lastTask?{priority:Number(lastTask.priority),id:String(lastTask.id)}:state.task
  };
  const hasMore=!recordDone||!taskDone;
  return {folder,folderId,depth:maxDepth,records,openTasks,page:{hasMore,nextCursor:hasMore?JSON.stringify(next):null},budgetChars:maxBudget,usedChars:maxBudget-remaining};
}
export { exportSnapshot, importSnapshot } from './backup.js';
