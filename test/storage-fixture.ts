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
      check(history.length===4,'history preserved');
      await store.tagRecord(env,rec.id,'testing','add','integration');
      const tags=await store.readRecord(env,rec.id,{metadataOnly:true});
      check(tags.tags.includes('testing')&&tags.path.endsWith('/empty.md'),'metadata includes path and tags');
      const tagNoop=await store.tagRecord(env,rec.id,'testing','add','integration');
      check(tagNoop.changed===false,'idempotent tag');
      const list=await store.browse(env,folder.id);
      check(list.records.some(r=>r.id===rec.id),'folder browsing');
      const todo=await store.createRecord(env,{name:'tasks',folderId:folder.id,kind:'task_list'},'integration');
      const updated=await store.taskOperation(env,todo.id,1,'add',undefined,{title:'Ship initial implementation'},'integration');
      check(updated.revision===2&&updated.tasks.length===1,'add task');
      const taskId=updated.tasks[0]!.id;
      const finished=await store.taskOperation(env,todo.id,2,'update',taskId,{status:'done'},'integration');
      check(finished.revision===3,'update task');
      const tasks=await store.getTasks(env,todo.id);
      check(tasks.length===1&&tasks[0]!.status==='done','task projection');
      const taskRestore=await store.restoreRecord(env,todo.id,2,3,'integration');
      check(taskRestore.revision===4,'task_list restore creates revision');
      const restoredTasks=await store.getTasks(env,todo.id);
      check(restoredTasks[0]!.status==='todo'&&restoredTasks[0]!.id===taskId,'task projection restored with same stable task id');
      const taskHistory=await store.listVersions(env,todo.id);
      check(taskHistory.length===4&&String(taskHistory[0]!.message).includes('Restored task list'),'task history restored');
      const context=await store.context(env,folder.id);
      check(context.records.length===2,'context metadata');
      const events=await store.changesSince(env,0);
      check(events.events.length>=7,'change cursor');
      const path=await store.resolvePath(env,'/'+folder.name+'/empty.md');
      check(path.kind==='record'&&path.id===rec.id,'resolve stable virtual path');
      const sub=await store.createFolder(env,'Subfolder',folder.id);
      const page=await store.browse(env,folder.id,1,0);
      check(page.hasMore&&page.nextCursor===1,'browse cursor pagination');
      const next=await store.browse(env,folder.id,1,1);
      check(next.records.length>=1,'browse second page');
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
      const details=await agent.readMany(env,[rec.id,todo.id],20000);
      check(details.results.length===2,'bounded read_many');
      const link=await agent.links(env,rec.id,'add',todo.id,'depends_on','integration');
      check(link.changed,'create record link');
      const listLinks=await agent.links(env,rec.id,'list');
      check(listLinks.links?.length===1,'read record links');
      const tagSummary=await agent.listTags(env);
      check(tagSummary.tags.some((t:any)=>t.name==='testing'),'tag statistics');
      const project=await agent.projectContext(env,folder.id,2,10000);
      check(project.records.length>=2,'project context');
      const versionsPage=await store.listVersions(env,rec.id,2,0);
      check(versionsPage.versions.length===2&&versionsPage.nextCursor!==null,'version history pagination');
      const tasksPage=await store.getTasks(env,todo.id,undefined,1,0);
      check(tasksPage.tasks.length===1,'task pagination');
      const eventsPage=await store.changesSince(env,0,2);
      check(eventsPage.hasMore,'cursor-based change pagination');
      const eventScan=await store.changesSince(env,0,200);
      check(eventScan.events.some(e=>e.entityType==='folder'),'structured folder changes');
      const snapshot=await agent.exportSnapshot(env,0,5);
      check(snapshot.format==='recalloom-snapshot-v1'&&snapshot.folders.length>=1,'paged backup export');
      const originalRow=await store.getRecord(env,rec.id);
      const importedId=crypto.randomUUID();
      const originalVersions=await store.listVersions(env,rec.id);
      const backupRecord={...originalRow,id:importedId,name:'restored-'+importedId+'.md',folder_id:folder.id};
      const snapshotPage={format:'recalloom-snapshot-v1',folders:[],links:[],records:[{
        record:backupRecord,
        revisions:originalVersions.map(v=>({...v,record_id:importedId})).reverse(),
        tags:['testing']
      }]};
      const validated=await agent.importSnapshot(env,snapshotPage,true);
      check(validated.dryRun && validated.importedRecords===1,'backup import validation');
      const imported=await agent.importSnapshot(env,snapshotPage,false);
      check(!imported.dryRun&&imported.importedRecords===1,'backup import creates revision-preserving clone');
      const restoredClone=await store.readRecord(env,importedId,{revision:3});
      check('content' in restoredClone && restoredClone.content==='hello world','backup import restored historical content');
      const clonedVersions=await store.listVersions(env,importedId);
      check(clonedVersions.length===4,'backup import preserved full audit history');
      return Response.json({ok:true,folderId:folder.id,recordId:rec.id,taskListId:todo.id,versions:history.length,events:events.events.length,virtualPaths:true,metadataIndexJobs:true,historicalHash:true,taskRestored:true,metadataCas:true,links:true,backup:true,pagination:true});
    } catch(error){
      return Response.json({ok:false,error:String(error),stack:error instanceof Error?error.stack:null},{status:500});
    }
  }
} satisfies ExportedHandler<Env>;
