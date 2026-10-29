import * as store from '../src/storage.js';
import * as agent from '../src/agent-tools.js';
import type { Env } from '../src/types.js';

function check(cond:unknown,message:string):asserts cond {
  if(!cond)throw Error('INTEGRATION_ASSERT_FAILED: '+message);
}
export default {
  async fetch(_request:Request,env:Env){
    try {
      const folder=await store.createFolder(env,'Test-'+crypto.randomUUID(),null,'Integration test');
      const rec=await store.createRecord(env,{name:'empty.md',folderId:folder.id,content:''},'integration');
      const first=await store.readRecord(env,rec.id);
      check('content' in first && first.content==='','empty record');
      const second=await store.editRecord(env,rec.id,1,'hello','First edit','integration');
      check(second.revision===2,'revision increment');
      const third=await store.editRecord(env,rec.id,2,{mode:'replace',oldText:'hello',newText:'hello world'},'Second edit','integration');
      check(third.revision===3,'replace revision');
      let conflict=false;
      try {await store.editRecord(env,rec.id,1,'bad','Stale edit','integration');}
      catch(e){conflict=String(e).includes('VERSION_CONFLICT')||(e instanceof Error&&e.message.includes('Latest revision'));}
      check(conflict,'stale edit must fail');
      const old=await store.readRecord(env,rec.id,{revision:1});
      check('content' in old && old.content==='','restore empty historical revision');
      check(old.contentSha256===first.contentSha256,'historical revision hash must match original');
      const oldMetadata=await store.readRecord(env,rec.id,{revision:1,metadataOnly:true});
      check(oldMetadata.contentSha256===first.contentSha256,'metadata-only historical hash');
      const latest=await store.readRecord(env,rec.id,{revision:3});
      check('content' in latest && latest.content==='hello world','latest revision');
      const restored=await store.restoreRecord(env,rec.id,1,3,'integration');
      check(restored.revision===4,'restore creates revision');
      const restoredRead=await store.readRecord(env,rec.id);
      check('content' in restoredRead && restoredRead.content==='','restore content');
      const history=await store.listVersions(env,rec.id);
      check(history.items.length===4,'history preserved');
      await store.tagRecord(env,rec.id,'testing','add','integration');
      const tags=await store.readRecord(env,rec.id,{metadataOnly:true});
      check(tags.tags.includes('testing')&&tags.path.endsWith('/empty.md'),'metadata includes path and tags');
      const tagNoop=await store.tagRecord(env,rec.id,'testing','add','integration');
      check(tagNoop.changed===false,'idempotent tag');
      const list=await store.browse(env,folder.id);
      check(list.items.some(r=>r.id===rec.id),'folder browsing');
      const todo=await store.createRecord(env,{name:'tasks',folderId:folder.id,kind:'task_list'},'integration');
      const updated=await store.taskOperation(env,todo.id,1,'add',undefined,{title:'Ship initial implementation'},'integration');
      check(updated.revision===2&&updated.tasks.length===1,'add task');
      const taskId=updated.tasks[0]!.id;
      const finished=await store.taskOperation(env,todo.id,2,'update',taskId,{status:'done'},'integration');
      check(finished.revision===3,'update task');
      const tasks=await store.getTasks(env,todo.id);
      check(tasks.items.length===1&&tasks.items[0]!.status==='done','task projection');
      const taskRestore=await store.restoreRecord(env,todo.id,2,3,'integration');
      check(taskRestore.revision===4,'task_list restore creates revision');
      const restoredTasks=await store.getTasks(env,todo.id);
      check(restoredTasks.items[0]!.status==='todo'&&restoredTasks.items[0]!.id===taskId,'task projection restored with same stable task id');
      const taskHistory=await store.listVersions(env,todo.id);
      check(taskHistory.items.length===4&&String(taskHistory.items[0]!.message).includes('Restored task list'),'task history restored');
      const context=await agent.getOverview(env,folder.id);
      check(context.records.length===2,'context metadata');
      const events=await store.changesSince(env,0);
      check(events.items.length>=7&&typeof events.items[0]?.createdAt==='string','change cursor and camelCase timestamp');
      const path=await store.resolvePath(env,'/'+folder.name+'/empty.md');
      check(path.kind==='record'&&path.id===rec.id,'resolve stable virtual path');
      const sub=await store.createFolder(env,'Subfolder',folder.id);
      const page=await store.browse(env,folder.id,1);
      check(page.items.length<=1&&page.page.hasMore&&typeof page.page.nextCursor==='string','browse cursor pagination with strict overall limit');
      const next=await store.browse(env,folder.id,1,page.page.nextCursor);
      check(next.items.length>=1,'browse second page');
      const movedFolder=await store.manageFolder(env,sub.id,{name:'Renamed',expectedMetadataRevision:1});
      check(movedFolder.metadataRevision===2,'metadata revision advanced on folder rename');
      let staleFolder=false;
      try{await store.manageFolder(env,sub.id,{name:'stale',expectedMetadataRevision:1});}catch(e){staleFolder=e instanceof Error&&e.message.includes('metadataRevision');}
      check(staleFolder,'folder metadata compare-and-set');
      const found=await store.resolvePath(env,'/'+folder.name+'/Renamed');
      check(found.kind==='folder'&&found.id===sub.id,'rename virtual folder');
      let collision=false;
      try {await store.createRecord(env,{name:'Renamed',folderId:folder.id});}
      catch(e){collision=String(e).includes('PATH_CONFLICT');}
      check(collision,'cannot reuse folder name as record name');
      const indexJobCount=async()=>Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM index_jobs WHERE record_id=?').bind(rec.id).first<{n:number}>())?.n??0);
      const beforeIndex=await indexJobCount();
      const archived=await store.updateMeta(env,rec.id,{status:'archived',expectedMetadataRevision:1},'integration');
      check(archived.metadataRevision===2,'record metadata CAS success');
      let staleRecord=false;
      try{await store.updateMeta(env,rec.id,{status:'active',expectedMetadataRevision:1},'integration');}catch(e){staleRecord=e instanceof Error&&e.message.includes('metadataRevision');}
      check(staleRecord,'record metadata compare-and-set');
      check((await indexJobCount())===beforeIndex+1,'archive queues a cleanup job for same content revision');
      await store.updateMeta(env,rec.id,{status:'active'},'integration');
      check((await indexJobCount())===beforeIndex+2,'reactivate queues a rebuild job for same revision');
      await store.updateMeta(env,rec.id,{name:'renamed.md'},'integration');
      check((await indexJobCount())===beforeIndex+3,'rename queues a rebuild job');
      await store.updateMeta(env,rec.id,{description:'description only'},'integration');
      const noChange=await store.updateMeta(env,rec.id,{description:'description only'},'integration');
      check(noChange.changed===false,'metadata no-op does not generate events');
      check((await indexJobCount())===beforeIndex+3,'description-only update does not create unnecessary index job');
      const diffs=await agent.diffRevisions(env,rec.id,2,3);
      check(diffs.changed && diffs.diff.includes('hello world'),'version diff');
      const details=await agent.readMany(env,[{id:rec.id},{id:todo.id}],20000);
      check(details.items.length===2,'bounded read_many');
      const link=await agent.links(env,rec.id,'add',todo.id,'depends_on','integration');
      check(link.changed,'create record link');
      const listLinks=await agent.links(env,rec.id,'list');
      check(listLinks.items?.length===1,'read record links');
      const tagSummary=await agent.listTags(env);
      check(tagSummary.items.some((t:any)=>t.name==='testing'),'tag statistics');
      const project=await agent.getOverview(env,folder.id,2,10000);
      check(project.records.length>=2,'project context');
      const versionsPage=await store.listVersions(env,rec.id,2);
      check(versionsPage.items.length===2&&versionsPage.page.nextCursor!==null,'version history pagination');
      const tasksPage=await store.getTasks(env,todo.id,undefined,1);
      check(tasksPage.items.length===1,'task pagination');
      const eventsPage=await store.changesSince(env,0,2);
      check(eventsPage.page.hasMore,'cursor-based change pagination');
      const eventScan=await store.changesSince(env,0,200);
      check(eventScan.items.some(e=>e.entityType==='folder'),'structured folder changes');
      const snapshot=await agent.exportSnapshot(env,null,5);
      check(snapshot.format==='recalloom-snapshot-v2'&&snapshot.folders.length>=1,'versioned backup export');
      const originalRow=await store.getRecord(env,rec.id);
      const importedId=crypto.randomUUID();
      const originalVersions=await store.listVersions(env,rec.id);
      const backupRecord={...originalRow,id:importedId,name:'restored-'+importedId+'.md',folder_id:folder.id};
      const payload={
        format:'recalloom-snapshot-v2' as const,watermark:0,totalRecords:1,
        cursor:null,nextCursor:null,folders:[],links:[],records:[{
          record:backupRecord,
          revisions:originalVersions.items.map(v=>({record_id:importedId,revision:v.revision,content_sha256:v.contentSha256,message:v.message,actor:v.actor,created_at:v.createdAt})).reverse(),
          tags:['testing']
        }]
      };
      const backupPage={...payload,pageHash:await (await import('../src/backup.js')).pageHash(payload)};
      const validated=await agent.importSnapshot(env,{pages:[backupPage]},true);
      check(validated.dryRun && validated.records===1,'backup import validation');
      const imported=await agent.importSnapshot(env,{pages:[backupPage]},false);
      check(!imported.dryRun&&imported.records===1,'backup import creates revision-preserving clone');
      const restoredClone=await store.readRecord(env,importedId,{revision:3});
      check('content' in restoredClone && restoredClone.content==='hello world','backup import restored historical content');
      const clonedVersions=await store.listVersions(env,importedId);
      check(clonedVersions.items.length===4,'backup import preserved full audit history');

      // A single shared budget must still return valid structured chunks.
      const long=await store.createRecord(env,{folderId:folder.id,name:'long-'+crypto.randomUUID()+'.md',content:'😀 line: '+('Alpha beta gamma. '.repeat(260))},'integration');
      const bounded=await agent.readMany(env,[{id:long.id}],1100);
      check(bounded.items.length===1,'large record returns one structured item');
      const part=bounded.items[0]!;
      check(typeof part.content==='string'&&part.truncated===true&&typeof part.nextOffsetChars==='number','large record produces continuation offset');
      check(JSON.stringify(bounded).length<=1100,'read_many enforces overall response budget');
      const resumed=await agent.readMany(env,[{id:long.id,offsetChars:Number(part.nextOffsetChars)}],1100);
      check(String(resumed.items[0]?.content).length>0,'continuation can read remaining content');
      const budgeted=await agent.getOverview(env,folder.id,2,1200);
      check(budgeted.usedChars<=1200,'project context task and excerpt budget');

      // Validation cannot mutate data. Corruption and name collisions must fail early.
      const corrupt={...backupPage,pageHash:'0'.repeat(64)};
      let corruptRejected=false;
      try{await agent.importSnapshot(env,{pages:[corrupt]},true);}catch(e){corruptRejected=String(e).includes('SNAPSHOT_INTEGRITY_ERROR');}
      check(corruptRejected,'backup page hash integrity');
      const badPayload={...payload,records:[{...payload.records[0]!,record:{...backupRecord,id:crypto.randomUUID(),name:'renamed.md'}}]};
      const badPage={...badPayload,pageHash:await (await import('../src/backup.js')).pageHash(badPayload)};
      let duplicateRejected=false;
      try{await agent.importSnapshot(env,{pages:[badPage]},true);}catch(e){duplicateRejected=String(e).includes('PATH_CONFLICT');}
      check(duplicateRejected,'dryRun catches real path conflicts');

      // Context and browse both support repeatable, explicit continuation.
      const contextPage=await agent.getOverview(env,folder.id,2,1000);
      check(contextPage.page.hasMore&&typeof contextPage.page.nextCursor==='string','context has a usable continuation cursor');
      const contextPage2=await agent.getOverview(env,folder.id,2,1000,contextPage.page.nextCursor!);
      const firstContextIds=new Set([...contextPage.records,...contextPage.openTasks].map(x=>x.id));
      check(![...contextPage2.records,...contextPage2.openTasks].some(x=>firstContextIds.has(x.id)),'context keyset page never repeats records or tasks');
      const browsePage=await store.browse(env,folder.id,1);
      const firstBrowseIds=new Set(browsePage.items.map(x=>x.id));
      if(browsePage.page.nextCursor){
        const nextBrowse=await store.browse(env,folder.id,1,browsePage.page.nextCursor);
        check(!nextBrowse.items.some(x=>firstBrowseIds.has(x.id)),'browse keyset continuation does not repeat entries');
      }
      // New documents emitted after page 1 must invalidate a running backup.
      const firstPage=await agent.exportSnapshot(env,null,1);
      check(firstPage.nextCursor!==null,'multi-page backup issues a cursor');
      const secondPage=await agent.exportSnapshot(env,firstPage.nextCursor,1);
      check(firstPage.watermark===secondPage.watermark&&firstPage.records[0]?.record.id!==secondPage.records[0]?.record.id,'backup keyset follows a stable record order');
      let incompleteRejected=false;
      try{await agent.importSnapshot(env,{pages:[firstPage]},true);}catch(e){incompleteRejected=String(e).includes('INCOMPLETE_SNAPSHOT');}
      check(incompleteRejected,'incomplete snapshot cannot be imported');

      await store.createRecord(env,{folderId:folder.id,name:'new-during-export-'+crypto.randomUUID()+'.md',content:'New content'},'integration');
      let changedRejected=false;
      try{await agent.exportSnapshot(env,firstPage.nextCursor,1);}catch(e){changedRejected=e instanceof Error && /Library changed/.test(e.message);}
      check(changedRejected,'changed library invalidates all in-flight export pages');
      // Tags are created atomically, normalized and returned as document metadata.
      const tagged=await store.createRecord(env,{name:'stage-'+crypto.randomUUID()+'.md',folderId:folder.id,
        content:'# Overview\n\n## Architecture\nDetails\n',tags:['Checkpoint','Release','checkpoint']},'integration');
      const taggedRead=await store.readRecord(env,tagged.id);
      check(tagged.kind==='document'&&tagged.revision===1&&tagged.tags?.length===2,'tagged document creation');
      check(taggedRead.kind==='document'&&taggedRead.tags.includes('checkpoint')&&taggedRead.tags.includes('release'),'tags persist in metadata');
      const outline=await agent.getOutline(env,tagged.id);
      check(outline.headings.length===2&&outline.headings[1]!.lineStart===3&&outline.revision===1,'outline reflects Markdown source lines');
      const overview=await agent.getOverview(env,folder.id);
      check(overview.folder?.name===folder.name&&overview.records.some(r=>r.id===tagged.id),'general folder overview');
      // Historical snapshot-v2 checkpoint records can still be imported without altering their revisions.
      const legacyId=crypto.randomUUID();
      const legacyRecord={...originalRow,id:legacyId,name:'legacy-'+legacyId+'.md',kind:'checkpoint'};
      const legacyPayload={...payload,records:[{record:legacyRecord,
        revisions:originalVersions.items.map(v=>({record_id:legacyId,revision:v.revision,
          content_sha256:v.contentSha256,message:v.message,actor:v.actor,created_at:v.createdAt})).reverse(),
        tags:['Testing']}]};
      const legacyPage={...legacyPayload,pageHash:await (await import('../src/backup.js')).pageHash(legacyPayload)};
      const legacyDry=await agent.importSnapshot(env,{pages:[legacyPage]},true);
      check(legacyDry.validated,'legacy checkpoint snapshot validates');
      await agent.importSnapshot(env,{pages:[legacyPage]},false);
      const legacyRead=await store.readRecord(env,legacyId,{revision:3});
      check(legacyRead.kind==='document'&&legacyRead.tags.includes('checkpoint')&&legacyRead.tags.includes('testing'),'legacy checkpoint converted to tagged document');
      check(legacyRead.revision===3&&legacyRead.contentSha256===originalVersions.items.find(x=>x.revision===3)?.contentSha256,
        'legacy snapshot preserves original history SHA');
      return Response.json({ok:true,folderId:folder.id,recordId:rec.id,taskListId:todo.id,versions:history.items.length,events:events.items.length,virtualPaths:true,metadataIndexJobs:true,historicalHash:true,taskRestored:true,metadataCas:true,links:true,backup:true,pagination:true});
    } catch(error){
      return Response.json({ok:false,error:String(error),stack:error instanceof Error?error.stack:null},{status:500});
    }
  }
} satisfies ExportedHandler<Env>;
