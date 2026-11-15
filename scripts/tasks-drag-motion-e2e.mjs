/** Task drag geometry, motion, cancellation and keyboard regression.
 * Run through scripts/run-editor-e2e.mjs tasks-drag-motion-e2e.mjs. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright-core';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Use scripts/run-editor-e2e.mjs and its isolated local Worker');
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executablePath=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe',
 '/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path)):undefined;
const secretLine=readFileSync(join(root,'.dev.vars'),'utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local MCP_AUTH_SECRET is required');

const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executablePath?{executablePath}:{})});
const context=await browser.newContext({viewport:{width:1440,height:980},reducedMotion:'no-preference',colorScheme:'light'});
const page=await context.newPage();
page.setDefaultTimeout(16000);
const faults=[];
page.on('pageerror',error=>faults.push(error.message));
let mutationRequests=0;
page.on('request',request=>{
 if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/tasks/mutate')mutationRequests++;
});

let sessionCookie='';
if(engine==='webkit')await page.route('**/api/**',async route=>{
 const request=route.request();
 if(new URL(request.url()).pathname==='/api/auth/login'){
  const response=await route.fetch();
  sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});return;
 }
 if(sessionCookie){await route.fulfill({response:await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}})});return;}
 await route.continue();
});

const runId=Date.now().toString(36).toUpperCase();
const prefix='TDM_'+runId+'_';
const artifactDir=join(root,'tmp','tasks-drag-motion-'+engine+'-'+runId);
mkdirSync(artifactDir,{recursive:true});

const api=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{
 const response=await fetch('/api'+path,{method,headers:body?{'content-type':'application/json'}:undefined,
  body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
},{path,method,body});
const requireApi=async(path,method='GET',body,expected=200)=>{
 const response=await api(path,method,body);
 assert.equal(response.status,expected,path+' '+method+' failed: '+JSON.stringify(response.data).slice(0,500));
 return response.data;
};
const taskPath=listId=>'/tasks/view?'+new URLSearchParams({recordId:listId,statuses:'todo,in_progress,blocked,done,cancelled',limit:'20'});
const readTasks=async listId=>(await requireApi(taskPath(listId))).items;
const waitForMutation=()=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tasks/mutate'&&
 response.request().method()==='POST',{timeout:10000});
const waitForDragCleanup=()=>page.waitForFunction(()=>!document.body.classList.contains('tasks-drag-active')&&
 !document.querySelector('.tasks-drag-preview')&&!document.querySelector('.tasks-drop-slot'),undefined,{timeout:16000});

async function startMotionProbe(sourceId){
 return page.evaluate(id=>{
  const source=document.querySelector('[data-task-id="'+CSS.escape(id)+'"]');
  if(!source)throw Error('Missing motion source '+id);
  const sourceRect=source.getBoundingClientRect();
  const probe={sourceId:id,sourceHeight:sourceRect.height,frames:[],lastPointer:null,done:false};
  const pointer=event=>{probe.lastPointer={x:event.clientX,y:event.clientY,time:performance.now()};};
  document.addEventListener('dragover',pointer,true);
  probe.stop=()=>{probe.done=true;document.removeEventListener('dragover',pointer,true);};
  window.__taskDragMotionProbe=probe;
  const matrix=element=>{
   const value=getComputedStyle(element).transform;
   if(!value||value==='none')return {x:0,y:0};
   const parsed=new DOMMatrixReadOnly(value);return {x:parsed.m41,y:parsed.m42};
  };
  const frame=()=>{
   const preview=document.querySelector('.tasks-drag-preview'),slot=document.querySelector('.tasks-drop-slot');
   const previewStyle=preview?getComputedStyle(preview):null,slotStyle=slot?getComputedStyle(slot):null;
   const previewTransform=preview?matrix(preview):null;
   probe.frames.push({
    time:performance.now(),active:document.body.classList.contains('tasks-drag-active'),pointer:probe.lastPointer,
    preview:preview&&previewStyle?{tx:previewTransform.x,ty:previewTransform.y,width:preview.offsetWidth,height:preview.offsetHeight,
     borderWidth:previewStyle.borderTopWidth,borderColor:previewStyle.borderTopColor,background:previewStyle.backgroundColor}:null,
    slot:slot&&slotStyle?{width:slot.offsetWidth,height:slot.offsetHeight,position:slotStyle.position,display:slotStyle.display,
     parentKey:slot.parentElement?.getAttribute('data-task-drop-key')??null,
     parentStatus:slot.parentElement?.getAttribute('data-task-drop-status')??null,
     parentLayout:slot.parentElement?.getAttribute('data-task-drop-layout')??null}:null,
    siblings:[...document.querySelectorAll('[data-task-id][data-task-record-id]')].filter(element=>element!==source).map(element=>{
     const transform=matrix(element),rect=element.getBoundingClientRect();
     return {id:element.getAttribute('data-task-id'),y:rect.y,ty:transform.y,running:element.getAnimations().some(animation=>
      animation.playState==='running'||animation.playState==='pending')};
    })
   });
   if(!probe.done&&probe.frames.length<300)requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);return {sourceHeight:sourceRect.height};
 },sourceId);
}

async function stopMotionProbe(){
 return page.evaluate(async()=>{
  const probe=window.__taskDragMotionProbe;if(!probe)return null;
  probe.stop();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return {sourceId:probe.sourceId,sourceHeight:probe.sourceHeight,frames:probe.frames};
 });
}

function assertMotion(probe,label,{layout,status=null,key=null}){
 assert.ok(probe?.frames.length>3,label+' captured animation frames');
 const active=probe.frames.filter(frame=>frame.active&&frame.preview&&frame.pointer);
 assert.ok(active.length>=2,label+' has live pointer/preview frames: '+JSON.stringify(probe.frames.slice(-8)));
 const following=active.filter(frame=>Math.abs(frame.preview.tx-frame.pointer.x-16)<6&&Math.abs(frame.preview.ty-frame.pointer.y-13)<6);
 assert.ok(following.length>=2,label+' preview follows pointer offset: '+JSON.stringify(active.slice(-8)));
 const pointerRange=Math.hypot(Math.max(...active.map(frame=>frame.pointer.x))-Math.min(...active.map(frame=>frame.pointer.x)),
  Math.max(...active.map(frame=>frame.pointer.y))-Math.min(...active.map(frame=>frame.pointer.y)));
 const previewRange=Math.hypot(Math.max(...active.map(frame=>frame.preview.tx))-Math.min(...active.map(frame=>frame.preview.tx)),
  Math.max(...active.map(frame=>frame.preview.ty))-Math.min(...active.map(frame=>frame.preview.ty)));
 assert.ok(pointerRange>70&&previewRange>70,label+' preview travels with the real mouse: '+JSON.stringify({pointerRange,previewRange}));
 const styled=active.find(frame=>parseFloat(frame.preview.borderWidth)>0&&frame.preview.borderColor!=='rgba(0, 0, 0, 0)'&&
  frame.preview.background!=='rgba(0, 0, 0, 0)');
 assert.ok(styled,label+' portaled preview keeps visible workspace theme styles');
 const slots=probe.frames.map(frame=>frame.slot).filter(Boolean);
 assert.ok(slots.some(slot=>slot.parentLayout===layout&&(!status||slot.parentStatus===status)&&(!key||slot.parentKey===key)&&
  slot.position==='relative'&&slot.display!=='none'&&slot.height>=probe.sourceHeight*.75),
 label+' slot occupies source-sized layout space: '+JSON.stringify(slots.slice(-8)));
 const intermediate=probe.frames.flatMap(frame=>frame.siblings).find(sibling=>sibling.running&&
  Math.abs(sibling.ty)>1&&Math.abs(sibling.ty)<probe.sourceHeight-1);
 assert.ok(intermediate,label+' captures a real intermediate sibling transform: '+JSON.stringify(probe.frames.slice(-12)));
}

async function beginMouseDrag(sourceId){
 const handle=page.locator('[data-task-id="'+sourceId+'"] [data-task-drag]').first();
 await handle.scrollIntoViewIfNeeded();
 await page.waitForFunction(id=>{
  const button=document.querySelector('[data-task-id="'+CSS.escape(id)+'"] [data-task-drag]');
  return Boolean(button&&!button.disabled&&button.getAttribute('draggable')==='true');
 },sourceId);
 const bounds=await handle.boundingBox();assert.ok(bounds,'Source drag handle is visible');
 await startMotionProbe(sourceId);
 const start={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
 await page.mouse.move(start.x,start.y);await page.mouse.down();
 await page.mouse.move(start.x+14,start.y+11,{steps:6});
 await page.waitForFunction(()=>document.body.classList.contains('tasks-drag-active')&&
  document.querySelector('.tasks-drag-preview')&&document.querySelector('.tasks-drop-slot'));
 return start;
}

async function moveDrag(start,destination){
 const middle={x:start.x+(destination.x-start.x)*.55,y:start.y+(destination.y-start.y)*.55};
 await page.mouse.move(middle.x,middle.y,{steps:14});await page.waitForTimeout(45);
 await page.mouse.move(destination.x,destination.y,{steps:18});await page.waitForTimeout(120);
 // The in-flow slot can replace the node under a stationary cursor. A final
 // real mouse sample makes Chromium dispatch dragover to that new hit target.
 await page.mouse.move(destination.x+1,destination.y+1,{steps:2});await page.waitForTimeout(30);
}

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');

 const list=await requireApi('/records','POST',{name:'Task drag motion '+runId,kind:'task_list'},201);
 let revision=list.revision??1;
 const seeded=[];
 for(let index=1;index<=5;index++){
  const title=prefix+String(index);
  const result=await requireApi('/tasks/mutate','POST',{recordId:list.id,action:'add',expectedRevision:revision,
   changes:{title,details:'Motion fixture '+index,status:'todo',priority:0}});
  revision=result.revision;
  const task=result.tasks.find(item=>item.title===title);assert.ok(task,'Seed mutation returns '+title);seeded.push(task);
 }
 assert.equal((await readTasks(list.id)).length,5,'Fixture contains exactly five tasks');
 const otherList=await requireApi('/records','POST',{name:'Task drag segment '+runId,kind:'task_list'},201);
 const otherResult=await requireApi('/tasks/mutate','POST',{recordId:otherList.id,action:'add',expectedRevision:otherList.revision??1,
  changes:{title:prefix+'OTHER',details:'Mixed board segment fixture',status:'blocked',priority:0}});
 const otherTask=otherResult.tasks.find(item=>item.title===prefix+'OTHER');assert.ok(otherTask,'Mixed board fixture task exists');

 await page.goto(base+'/records/'+list.id);
 const workspace=page.locator('[data-task-workspace]');await workspace.waitFor();
 const viewGroup=page.getByRole('group',{name:'任务视图'});
 const boardMode=viewGroup.getByRole('button',{name:'看板',exact:true});
 const listMode=viewGroup.getByRole('button',{name:'列表',exact:true});
 await boardMode.waitFor();
 await page.waitForFunction(id=>document.querySelectorAll('[data-task-column="todo"] [data-task-record-id="'+CSS.escape(id)+'"]').length===5,list.id);

 // Board: drag the first task into an empty status column while sampling the
 // portaled preview, real flex slot and source-column FLIP animation.
 const boardSource=seeded[0];
 const inProgress=page.locator('[data-task-column="in_progress"] [data-task-drop-container]');
 const columnBounds=await inProgress.boundingBox();assert.ok(columnBounds,'Target board column is visible');
 const boardStart=await beginMouseDrag(boardSource.id);
 const boardMutation=waitForMutation();
 await moveDrag(boardStart,{x:columnBounds.x+columnBounds.width/2,y:columnBounds.y+Math.min(110,columnBounds.height/3)});
 await page.waitForFunction(()=>document.querySelector('.tasks-drop-slot')?.parentElement?.getAttribute('data-task-drop-status')==='in_progress');
 await page.mouse.up();
 const boardResponse=await boardMutation;assert.ok(boardResponse.ok(),'Board drag mutation succeeds');await boardResponse.finished();
 await waitForDragCleanup();
 const boardProbe=await stopMotionProbe();
 assertMotion(boardProbe,'Board drag',{layout:'card',status:'in_progress'});
 const moved=await requireApi('/tasks/'+boardSource.id);
 assert.equal(moved.item.status,'in_progress','Board drag persists the destination status');
 assert.equal(moved.item.recordId,list.id,'Board drag keeps the source task list');

 // A board column may contain several task lists. Moving to the canonical end
 // of one list must reserve space at that recordId segment, not column end.
 await page.goto(base+'/tasks');
 const scopedColumns=Promise.all(['in_progress','blocked'].map(status=>page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/api/tasks/view'&&url.searchParams.get('query')===prefix&&url.searchParams.get('statuses')===status;
 })));
 await page.getByPlaceholder('搜索任务…').fill(prefix);
 await scopedColumns;
 await page.waitForFunction(({sourceId,otherId})=>Boolean(
  document.querySelector('[data-task-column="in_progress"] [data-task-id="'+CSS.escape(sourceId)+'"]')&&
  document.querySelector('[data-task-column="blocked"] [data-task-id="'+CSS.escape(otherId)+'"]')),
 {sourceId:boardSource.id,otherId:otherTask.id});
 const blocked=page.locator('[data-task-column="blocked"] [data-task-drop-container]');
 const blockedBounds=await blocked.boundingBox();assert.ok(blockedBounds,'Mixed target board column is visible');
 const segmentStart=await beginMouseDrag(boardSource.id);
 await moveDrag(segmentStart,{x:blockedBounds.x+blockedBounds.width/2,y:blockedBounds.y+Math.min(100,blockedBounds.height/3)});
 await page.waitForFunction(recordId=>{
  const slot=document.querySelector('.tasks-drop-slot'),container=slot?.parentElement;
  if(!slot||container?.getAttribute('data-task-drop-status')!=='blocked')return false;
  const expected=[...container.children].find(element=>element.matches('[data-task-id][data-task-record-id]')&&
   element.getAttribute('data-task-record-id')>recordId);
  const nextTask=[...container.children].slice([...container.children].indexOf(slot)+1)
   .find(element=>element.matches('[data-task-id][data-task-record-id]'));
  return expected?slot.nextElementSibling===expected:!nextTask;
 },list.id);
 const segmentMutation=waitForMutation();
 await page.mouse.up();
 const segmentResponse=await segmentMutation;assert.ok(segmentResponse.ok(),'Mixed board drag mutation succeeds');await segmentResponse.finished();
 await waitForDragCleanup();await stopMotionProbe();
 assert.equal((await requireApi('/tasks/'+boardSource.id)).item.status,'blocked','Mixed board drag persists destination status');

 // List: move the last canonical task before the first and assert the exact
 // API order, in addition to the same live geometry/motion contract.
 await listMode.click();
 const group=page.locator('[data-task-list-id="'+list.id+'"]');await group.waitFor();
 await page.waitForFunction(id=>document.querySelector('[data-task-list-id="'+CSS.escape(id)+'"]')?.querySelectorAll('[data-task-id]').length===5,list.id);
 const beforeList=await readTasks(list.id),beforeIds=beforeList.map(item=>item.id);
 const listSource=beforeIds.at(-1),listTarget=beforeIds[0];assert.ok(listSource&&listTarget&&listSource!==listTarget);
 const targetRow=group.locator('[data-task-id="'+listTarget+'"]');
 await targetRow.scrollIntoViewIfNeeded();
 const rowBounds=await targetRow.boundingBox();assert.ok(rowBounds,'Target list row is visible');
 const listStart=await beginMouseDrag(listSource);
 const listMutation=waitForMutation();
 await moveDrag(listStart,{x:rowBounds.x+Math.min(120,rowBounds.width/2),y:rowBounds.y+rowBounds.height*.25});
 await page.waitForFunction(({listId,targetId})=>{
  const slot=document.querySelector('.tasks-drop-slot'),target=document.querySelector('[data-task-id="'+CSS.escape(targetId)+'"]');
  return slot?.parentElement?.getAttribute('data-task-drop-key')==='list:'+listId&&slot.nextElementSibling===target;
 },{listId:list.id,targetId:listTarget});
 await page.mouse.up();
 const listResponse=await listMutation;assert.ok(listResponse.ok(),'List drag mutation succeeds');await listResponse.finished();
 await waitForDragCleanup();
 const listProbe=await stopMotionProbe();
 assertMotion(listProbe,'List drag',{layout:'row',key:'list:'+list.id});
 const afterListIds=(await readTasks(list.id)).map(item=>item.id);
 assert.deepEqual(afterListIds,[listSource,...beforeIds.filter(id=>id!==listSource)],'List drag persists the exact manual order');

 // Releasing after leaving every valid drop container must discard the last
 // valid target and submit no stale move.
 const invalidBefore=(await readTasks(list.id)).map(item=>item.id),invalidRequests=mutationRequests;
 const invalidSource=invalidBefore[2],invalidTarget=invalidBefore[0];
 const invalidTargetBounds=await group.locator('[data-task-id="'+invalidTarget+'"]').boundingBox();assert.ok(invalidTargetBounds);
 const invalidStart=await beginMouseDrag(invalidSource);
 await moveDrag(invalidStart,{x:invalidTargetBounds.x+100,y:invalidTargetBounds.y+invalidTargetBounds.height*.2});
 await page.waitForFunction(targetId=>document.querySelector('.tasks-drop-slot')?.nextElementSibling?.getAttribute('data-task-id')===targetId,invalidTarget);
 await page.mouse.move(5,5,{steps:18});await page.waitForTimeout(120);
 await page.waitForFunction(sourceId=>document.querySelector('.tasks-drop-slot')?.nextElementSibling?.getAttribute('data-task-id')===sourceId,invalidSource);
 await page.mouse.up();await waitForDragCleanup();await stopMotionProbe();await page.waitForTimeout(150);
 assert.equal(mutationRequests,invalidRequests,'Invalid final drop submits no stale mutation');
 assert.deepEqual((await readTasks(list.id)).map(item=>item.id),invalidBefore,'Invalid final drop preserves API order');

 // A rejected move must clean up the transient UI and announce failure only
 // after the async action rejects.
 const failureBefore=(await readTasks(list.id)).map(item=>item.id),failureSource=failureBefore[3],failureTarget=failureBefore[0];
 const failMutation=route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"DRAG_TEST_FAILURE"}'});
 await page.route('**/api/tasks/mutate',failMutation,{times:1});
 const failureBounds=await group.locator('[data-task-id="'+failureTarget+'"]').boundingBox();assert.ok(failureBounds);
 const failureStart=await beginMouseDrag(failureSource),failureResponsePromise=waitForMutation();
 await moveDrag(failureStart,{x:failureBounds.x+100,y:failureBounds.y+failureBounds.height*.2});
 await page.waitForFunction(targetId=>document.querySelector('.tasks-drop-slot')?.nextElementSibling?.getAttribute('data-task-id')===targetId,failureTarget);
 await page.mouse.up();const failureResponse=await failureResponsePromise;
 assert.equal(failureResponse.status(),503,'Rejected drag receives the injected failure');
 await waitForDragCleanup();await stopMotionProbe();
 await page.waitForFunction(()=>document.querySelector('.tasks-drag-live')?.textContent==='无法移动任务');
 assert.deepEqual((await readTasks(list.id)).map(item=>item.id),failureBefore,'Rejected drag preserves API order');

 // Escape must fully tear down the transient DOM and submit no mutation.
 const cancelBefore=(await readTasks(list.id)).map(item=>item.id),cancelRequests=mutationRequests;
 const cancelSource=cancelBefore[2],cancelTarget=cancelBefore[0];
 const cancelTargetRow=group.locator('[data-task-id="'+cancelTarget+'"]');
 const cancelBounds=await cancelTargetRow.boundingBox();assert.ok(cancelBounds);
 const cancelStart=await beginMouseDrag(cancelSource);
 await moveDrag(cancelStart,{x:cancelBounds.x+Math.min(110,cancelBounds.width/2),y:cancelBounds.y+cancelBounds.height*.2});
 await page.keyboard.press('Escape');await page.mouse.up();await waitForDragCleanup();await stopMotionProbe();
 await page.waitForTimeout(250);
 assert.equal(mutationRequests,cancelRequests,'Escape cancellation submits no task mutation');
 assert.deepEqual((await readTasks(list.id)).map(item=>item.id),cancelBefore,'Escape cancellation preserves API order');

 // Keyboard drag uses the same slot and persistence path: grab the first row,
 // move it to the end, and commit with Enter.
 const keyboardBefore=(await readTasks(list.id)).map(item=>item.id),keyboardSource=keyboardBefore[0];
 const keyboardHandle=group.locator('[data-task-id="'+keyboardSource+'"] [data-task-drag]');
 await keyboardHandle.focus();await page.keyboard.press('Space');
 await page.waitForFunction(id=>document.querySelector('[data-task-id="'+CSS.escape(id)+'"] [data-task-drag]')?.getAttribute('aria-pressed')==='true'&&
  Boolean(document.querySelector('.tasks-drag-preview')&&document.querySelector('.tasks-drop-slot')),keyboardSource);
 await page.keyboard.press('End');
 await page.waitForFunction(id=>{
  const slot=document.querySelector('.tasks-drop-slot'),container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(id)+'"]');
  return slot?.parentElement===container&&!slot?.nextElementSibling?.matches?.('[data-task-id]');
 },list.id);
 const keyboardMutation=waitForMutation();await page.keyboard.press('Enter');
 const keyboardResponse=await keyboardMutation;assert.ok(keyboardResponse.ok(),'Keyboard drag mutation succeeds');await keyboardResponse.finished();
 await waitForDragCleanup();
 const keyboardAfter=(await readTasks(list.id)).map(item=>item.id);
 assert.deepEqual(keyboardAfter,[...keyboardBefore.slice(1),keyboardSource],'Keyboard End + Enter persists the task at the list end');

 assert.deepEqual(faults,[],'Browser runtime errors');
 console.log('PASS task drag motion:',engine,'board/list preview, in-flow slot, FLIP frames, Escape and keyboard order');
}catch(error){
 const failureScreenshot=join(artifactDir,'failure.png');
 await page.screenshot({path:failureScreenshot,fullPage:true}).catch(()=>undefined);
 console.error('Task drag motion regression failed',JSON.stringify({engine,url:page.url(),faults,artifactDir,failureScreenshot}));
 throw error;
}finally{
 await browser.close();
}
