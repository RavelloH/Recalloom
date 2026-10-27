import * as store from '../src/storage.js';
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
      const latest=await store.readRecord(env,rec.id,{revision:3});
      check('content' in latest && latest.content==='hello world','latest revision');
      const restored=await store.restoreRecord(env,rec.id,1,3,'integration');
      check(restored.revision===4,'restore creates revision');
      const restoredRead=await store.readRecord(env,rec.id);
      check('content' in restoredRead && restoredRead.content==='','restore content');
      const history=await store.listVersions(env,rec.id);
      check(history.length===4,'history preserved');
      await store.tagRecord(env,rec.id,'testing','add','integration');
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
      const context=await store.context(env,folder.id);
      check(context.records.length===2,'context metadata');
      const events=await store.changesSince(env,0);
      check(events.events.length>=7,'change cursor');
      const path=await store.resolvePath(env,'/'+folder.name+'/empty.md');
      check(path.kind==='record'&&path.id===rec.id,'resolve stable virtual path');
      const sub=await store.createFolder(env,'Subfolder',folder.id);
      await store.manageFolder(env,sub.id,{name:'Renamed'});
      const found=await store.resolvePath(env,'/'+folder.name+'/Renamed');
      check(found.kind==='folder'&&found.id===sub.id,'rename virtual folder');
      let collision=false;
      try {await store.createRecord(env,{name:'Renamed',folderId:folder.id});}
      catch(e){collision=String(e).includes('PATH_CONFLICT');}
      check(collision,'cannot reuse folder name as record name');
      return Response.json({ok:true,folderId:folder.id,recordId:rec.id,taskListId:todo.id,versions:history.length,events:events.events.length,virtualPaths:true});
    } catch(error){
      return Response.json({ok:false,error:String(error),stack:error instanceof Error?error.stack:null},{status:500});
    }
  }
} satisfies ExportedHandler<Env>;
