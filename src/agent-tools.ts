import type { Env } from './types.js';
import { StorageError } from './types.js';
import { readRecord, getRecord, listVersions } from './storage.js';
import { historicalVersion, sha256 } from './version.js';
import { createTwoFilesPatch } from 'diff';

const capped=(n:number|undefined,max:number,defaultValue:number)=>Math.min(max,Math.max(1,n??defaultValue));
export async function readMany(env:Env,ids:string[],maxChars=20000,revision?:number) {
  const budget=Math.min(60000,Math.max(1000,maxChars));
  const results:unknown[]=[];
  let remaining=budget;
  for(const id of ids.slice(0,12)) {
    try {
      const value=await readRecord(env,id,{revision,maxLines:Math.min(500,Math.max(5,Math.floor(remaining/40)))});
      const raw=JSON.stringify(value);
      if(raw.length>remaining) {
        results.push({id,truncated:true,preview:raw.slice(0,Math.max(0,remaining))});
        remaining=0;break;
      }
      results.push(value);
      remaining-=raw.length;
      if(remaining<500)break;
    }catch(e){results.push({id,error:e instanceof StorageError?e.code:'READ_FAILED'});}
  }
  return {results,remainingChars:remaining,requested:ids.length,returned:results.length,hasMore:results.length<ids.length};
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
export async function listTags(env:Env,limit=100){
  const result=await env.DB.prepare("SELECT t.name,COUNT(rt.record_id) AS count FROM tags t LEFT JOIN record_tags rt ON rt.tag_id=t.id GROUP BY t.id ORDER BY count DESC,t.name LIMIT ?")
    .bind(capped(limit,200,100)).all();
  return {tags:result.results};
}
export async function links(env:Env,id:string,action:'list'|'add'|'remove'='list',targetId?:string,relation='related',actor='agent'){
  await getRecord(env,id);
  if(action!=='list'){
    if(!targetId||targetId===id)throw new StorageError('INVALID_LINK');
    await getRecord(env,targetId);
    if(!relation.trim()||relation.length>64)throw new StorageError('INVALID_RELATION');
    const stmt=action==='add'
      ?env.DB.prepare('INSERT OR IGNORE INTO record_links(source_id,target_id,relation) VALUES(?,?,?)')
      :env.DB.prepare('DELETE FROM record_links WHERE source_id=? AND target_id=? AND relation=?');
    const operation=await stmt.bind(id,targetId,relation).run();
    if(operation.meta.changes){
      await env.DB.prepare('INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,'link_'+action,null,actor,new Date().toISOString(),'record',id,JSON.stringify({targetId,relation})).run();
    }
    return {id,targetId,relation,changed:Boolean(operation.meta.changes)};
  }
  const result=await env.DB.prepare("SELECT source_id,target_id,relation FROM record_links WHERE source_id=? OR target_id=? ORDER BY relation,source_id,target_id LIMIT 200")
    .bind(id,id).all();
  return {id,links:result.results};
}
export async function projectContext(env:Env,folderId:string|null=null,depth=2,budget=12000){
  const maxDepth=Math.min(5,Math.max(0,depth)),maxBudget=Math.min(30000,Math.max(1000,budget));
  if(folderId&&!(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folderId).first()))throw new StorageError('FOLDER_NOT_FOUND');
  const result=await env.DB.prepare(
    "WITH RECURSIVE tree(id,depth) AS (SELECT id,CASE WHEN ? IS NULL THEN 1 ELSE 0 END FROM folders WHERE (? IS NULL AND parent_id IS NULL) OR id=? UNION ALL SELECT f.id,t.depth+1 FROM folders f JOIN tree t ON f.parent_id=t.id WHERE t.depth<?) "+
    "SELECT r.id,r.folder_id,r.name,r.kind,r.status,r.description,c.revision,r.updated_at "+
    "FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.status!='archived' AND "+
    "((? IS NULL AND r.folder_id IS NULL) OR r.folder_id IN (SELECT id FROM tree WHERE id IS NOT NULL)) "+
    "ORDER BY CASE WHEN r.kind='checkpoint' THEN 0 WHEN r.kind='task_list' THEN 1 ELSE 2 END,r.updated_at DESC LIMIT 60"
  ).bind(folderId,folderId,folderId,maxDepth,folderId).all();
  let used=0;const records:unknown[]=[];
  for(const row of result.results as Array<{id:string;name:string;description:string;kind:string;revision:number;updated_at:string}>){
    const snippet=await env.DB.prepare('SELECT substr(content,1,1500) AS text FROM record_contents WHERE record_id=?').bind(row.id).first<{text:string}>();
    const item={...row,excerpt:snippet?.text??''},len=JSON.stringify(item).length;
    if(used+len>maxBudget)break;
    records.push(item);used+=len;
  }
  const openTasks=await env.DB.prepare("SELECT t.id,t.title,t.status,t.priority,t.record_id FROM tasks t JOIN records r ON r.id=t.record_id WHERE r.status!='archived' AND t.status NOT IN ('done','cancelled') AND ((? IS NULL AND r.folder_id IS NULL) OR r.folder_id IN (WITH RECURSIVE tree(id,depth) AS (SELECT id,CASE WHEN ? IS NULL THEN 1 ELSE 0 END FROM folders WHERE (? IS NULL AND parent_id IS NULL) OR id=? UNION ALL SELECT f.id,t.depth+1 FROM folders f JOIN tree t ON f.parent_id=t.id WHERE t.depth<?) SELECT id FROM tree WHERE id IS NOT NULL)) ORDER BY t.priority DESC LIMIT 30")
    .bind(folderId,folderId,folderId,folderId,maxDepth).all();
  return {folderId,depth:maxDepth,records,openTasks:openTasks.results,truncated:records.length<result.results.length,budgetUsed:used};
}
/** A self-contained paginated backup stream. The history metadata preserves text-version's reverse deltas. */
export async function exportSnapshot(env:Env,cursor=0,limit=2){
  const count=capped(limit,5,2),offset=Math.max(0,Math.floor(cursor));
  const [folders,records]=(await Promise.all([
    offset===0?env.DB.prepare('SELECT * FROM folders ORDER BY id').all():Promise.resolve({results:[]}),
    env.DB.prepare('SELECT r.*,c.content,c.revision,c.content_sha256,h.history_metadata FROM records r JOIN record_contents c ON c.record_id=r.id JOIN record_histories h ON h.record_id=r.id ORDER BY r.id LIMIT ? OFFSET ?').bind(count+1,offset).all()
  ]));
  const data=[];
  for(const row of records.results.slice(0,count)){
    const id=String(row.id);
    const [history,tags]=await Promise.all([
      env.DB.prepare('SELECT * FROM revisions WHERE record_id=? ORDER BY revision').bind(id).all(),
      env.DB.prepare('SELECT t.name FROM record_tags rt JOIN tags t ON t.id=rt.tag_id WHERE rt.record_id=?').bind(id).all()
    ]);
    data.push({record:row,revisions:history.results,tags:tags.results.map(x=>x.name)});
  }
  const done=records.results.length<=count;
  const linksRows=done?await env.DB.prepare('SELECT * FROM record_links ORDER BY source_id').all():{results:[]};
  return {format:'recalloom-snapshot-v1',cursor:offset,nextCursor:done?null:offset+count,folders:folders.results,links:linksRows.results,records:data};
}

/**
 * Import a page of a Recalloom snapshot. Preserves record IDs, reverse-diff
 * history and audit metadata. Never overwrites existing records or folders.
 * Folder pages must precede their child records; linked records must exist.
 */
export async function importSnapshot(env:Env,bundle:unknown,dryRun=true){
  if(!bundle||typeof bundle!=='object')throw new StorageError('INVALID_SNAPSHOT');
  const input=bundle as {format?:string;folders?:unknown[];records?:unknown[];links?:unknown[]};
  if(input.format!=='recalloom-snapshot-v1'||!Array.isArray(input.records)||input.records.length>5)
    throw new StorageError('INVALID_SNAPSHOT');
  const folders=Array.isArray(input.folders)?input.folders:[];
  const links=Array.isArray(input.links)?input.links:[];
  if(folders.length>1000||links.length>2000)throw new StorageError('SNAPSHOT_TOO_LARGE');
  const uuid=/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i;
  const idCheck=(x:unknown)=>{if(typeof x!=='string'||!uuid.test(x))throw new StorageError('INVALID_SNAPSHOT_ID');return x;};
  const statements:D1PreparedStatement[]=[];
  let importedFolders=0,importedRecords=0,importedLinks=0;
  // Snapshot export includes all folders on page zero.
  const pending=[...folders] as Array<{id:string;parent_id:string|null;name:string;description:string;metadata_revision:number;created_at:string;updated_at:string}>;
  const folderIds=new Set(pending.map(f=>idCheck(f.id)));
  for(let index=0;pending.length;index++){
    if(index>folders.length)throw new StorageError('INVALID_FOLDER_HIERARCHY');
    const next=pending.findIndex(f=>!f.parent_id||!folderIds.has(f.parent_id));
    if(next<0)throw new StorageError('INVALID_FOLDER_HIERARCHY');
    const [folder]=pending.splice(next,1);
    if(!folder||typeof folder.name!=='string')throw new StorageError('INVALID_SNAPSHOT');
    folderIds.delete(folder.id);
    if(await env.DB.prepare('SELECT id FROM folders WHERE id=?').bind(folder.id).first())
      throw new StorageError('IMPORT_CONFLICT','Folder '+folder.id+' already exists');
    statements.push(env.DB.prepare('INSERT INTO folders(id,parent_id,name,description,created_at,updated_at,metadata_revision) VALUES(?,?,?,?,?,?,?)')
      .bind(folder.id,folder.parent_id,folder.name,folder.description??'',folder.created_at,folder.updated_at,folder.metadata_revision??1));
    importedFolders++;
  }
  for(const item of input.records as Array<{
    record:Record<string,unknown>;revisions:Array<Record<string,unknown>>;tags:string[]
  }>){
    const row=item.record,id=idCheck(row?.id);
    if(await env.DB.prepare('SELECT id FROM records WHERE id=?').bind(id).first())
      throw new StorageError('IMPORT_CONFLICT','Record '+id+' already exists');
    if(typeof row.content!=='string'||typeof row.history_metadata!=='string'
      ||!Number.isInteger(row.revision)||!Array.isArray(item.revisions)||!Array.isArray(item.tags)
      ||row.content.length>500000||item.revisions.length!==row.revision)throw new StorageError('INVALID_SNAPSHOT');
    if(await sha256(row.content)!==row.content_sha256)throw new StorageError('SNAPSHOT_HASH_MISMATCH');
    for(const rev of item.revisions){
      if(typeof rev.revision!=='number'||rev.revision<1||typeof rev.content_sha256!=='string'
        ||!rev.actor||!rev.created_at)throw new StorageError('INVALID_SNAPSHOT');
      const content=rev.revision===row.revision?row.content:historicalVersion({content:row.content,metadata:row.history_metadata},rev.revision);
      if(await sha256(content)!==rev.content_sha256)throw new StorageError('SNAPSHOT_HASH_MISMATCH');
    }
    statements.push(env.DB.prepare('INSERT INTO records(id,folder_id,name,kind,status,description,created_at,updated_at,metadata_revision) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(id,row.folder_id??null,row.name,row.kind,row.status,row.description,row.created_at,row.updated_at,row.metadata_revision??1));
    statements.push(env.DB.prepare('INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,?,?)')
      .bind(id,row.content,row.revision,row.content_sha256));
    statements.push(env.DB.prepare('INSERT INTO record_histories(record_id,history_metadata) VALUES(?,?)').bind(id,row.history_metadata));
    for(const rev of item.revisions){
      statements.push(env.DB.prepare('INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,?,?,?,?,?)')
        .bind(id,rev.revision,rev.content_sha256,rev.message,rev.actor,rev.created_at));
    }
    if(row.kind==='task_list'){
      const parsed=JSON.parse(row.content) as {tasks?:Array<{id:string;title:string;details:string;status:string;priority:number}>};
      if(!Array.isArray(parsed.tasks))throw new StorageError('INVALID_SNAPSHOT');
      for(const [i,task] of parsed.tasks.entries()){
        statements.push(env.DB.prepare('INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)')
          .bind(idCheck(task.id),id,task.title,task.details,task.status,task.priority,i,row.updated_at));
      }
    }
    for(const tag of item.tags){
      if(typeof tag!=='string'||!tag.trim())throw new StorageError('INVALID_SNAPSHOT');
      statements.push(env.DB.prepare('INSERT INTO tags(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING').bind(crypto.randomUUID(),tag));
      statements.push(env.DB.prepare('INSERT INTO record_tags(record_id,tag_id) SELECT ?,id FROM tags WHERE name=?').bind(id,tag));
    }
    // Imported active content will be re-embedded into the destination Vectorize.
    if(row.status!=='archived')statements.push(env.DB.prepare('INSERT INTO index_jobs(id,record_id,revision,created_at) VALUES(?,?,?,?)')
      .bind(crypto.randomUUID(),id,row.revision,new Date().toISOString()));
    importedRecords++;
  }
  for(const link of links as Array<{source_id:string;target_id:string;relation:string}>){
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO record_links(source_id,target_id,relation) VALUES(?,?,?)')
      .bind(idCheck(link.source_id),idCheck(link.target_id),link.relation));
    importedLinks++;
  }
  if(statements.length>700)throw new StorageError('SNAPSHOT_TOO_LARGE');
  if(!dryRun)await env.DB.batch(statements);
  return {dryRun,importedFolders,importedRecords,importedLinks,statementCount:statements.length};
}
