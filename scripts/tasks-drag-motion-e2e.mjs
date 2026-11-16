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
const orderMotionEvidence=[];
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
const allStatuses='todo,in_progress,blocked,done,cancelled';
const taskPath=listId=>'/tasks/view?'+new URLSearchParams({recordId:listId,statuses:allStatuses,order:'board',limit:'20'});
const readTasks=async listId=>(await requireApi(taskPath(listId))).items;
const readBoard=async status=>(await requireApi('/tasks/view?'+new URLSearchParams({query:prefix,statuses:status,order:'board',limit:'100'}))).items;
const readGlobal=async()=>(await requireApi('/tasks/view?'+new URLSearchParams({query:prefix,statuses:allStatuses,order:'board',limit:'100'}))).items;
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

async function startOrderProbe(recordId){
 await page.evaluate(id=>{
  const probe={done:false,frames:[]};
  const matrix=element=>{
   const value=getComputedStyle(element).transform;
   if(!value||value==='none')return {x:0,y:0};
   const parsed=new DOMMatrixReadOnly(value);return {x:parsed.m41,y:parsed.m42};
  };
  const frame=()=>{
   probe.frames.push([...document.querySelectorAll('[data-task-record-id="'+CSS.escape(id)+'"][data-task-id]')].map(element=>({
    id:element.getAttribute('data-task-id'),top:element.getBoundingClientRect().top,transform:matrix(element),running:element.getAnimations().some(animation=>
     animation.playState==='running'||animation.playState==='pending')
   })));
   if(!probe.done&&probe.frames.length<120)requestAnimationFrame(frame);
  };
  probe.stop=()=>{probe.done=true;};window.__taskOrderProbe=probe;requestAnimationFrame(frame);
 },recordId);
}

async function stopOrderProbe(){
 return page.evaluate(async()=>{
  const probe=window.__taskOrderProbe;if(!probe)return [];
  probe.stop();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return probe.frames;
 });
}

function assertOrderMotion(frames,label){
 assert.ok(frames.length>2,label+' captures layout frames');
 const offsets=frames.flat().map(item=>Math.abs(item.transform.y)).filter(value=>value>1);
 const tracks=new Map();
 for(const item of frames.flat()){
  const values=tracks.get(item.id)??[];values.push(item.top);tracks.set(item.id,values);
 }
 const geometricIntermediate=[...tracks.entries()].map(([id,values])=>{
  const min=Math.min(...values),max=Math.max(...values);
  return {id,min,max,intermediate:values.find(value=>value>min+.5&&value<max-.5)};
 }).find(track=>track.max-track.min>1&&track.intermediate!==undefined);
 const transformRange=offsets.length>1?Math.max(...offsets)-Math.min(...offsets):0;
 assert.ok(geometricIntermediate||transformRange>.5,
  label+' animates real intermediate row positions: '+JSON.stringify(frames.slice(-16)));
 orderMotionEvidence.push({label,geometry:geometricIntermediate??null,transformRange,
  runningFrames:frames.flat().filter(item=>item.running).length});
}

async function waitForStableHandle(sourceId){
 await page.waitForFunction(async id=>{
  const selector='[data-task-id="'+CSS.escape(id)+'"] [data-task-drag]';
  const handles=[...document.querySelectorAll(selector)];
  if(handles.length!==1)return false;
  const element=handles[0];
  const region=element.closest('[data-task-list-id],[data-task-column]')??element.parentElement??element;
  const tracked=[];
  for(let node=element;node;node=node.parentElement){tracked.push(node);if(node===region)break;}
  let previous=null,stableFrames=0;
  for(let frame=0;frame<16;frame++){
   await new Promise(resolve=>requestAnimationFrame(resolve));
   const current=[...document.querySelectorAll(selector)];
   if(!element.isConnected||current.length!==1||current[0]!==element)return false;
   const rects=tracked.map(node=>node.getBoundingClientRect());
   const stable=previous&&rects.every((rect,index)=>{
    const before=previous[index];return before&&Math.abs(rect.x-before.x)<.05&&Math.abs(rect.y-before.y)<.05&&
     Math.abs(rect.width-before.width)<.05&&Math.abs(rect.height-before.height)<.05;
   });
   stableFrames=stable?stableFrames+1:0;previous=rects;
   if(stableFrames>=5)return true;
  }
  return false;
 },sourceId,{timeout:12000});
}

async function waitForPersistentHandle(sourceId){
 await page.waitForFunction(async id=>{
  const selector='[data-task-id="'+CSS.escape(id)+'"] [data-task-drag]';
  const handles=[...document.querySelectorAll(selector)];
  if(handles.length!==1||handles[0].disabled||handles[0].getAttribute('draggable')!=='true')return false;
  const handle=handles[0];
  for(let frame=0;frame<3;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));
  const current=[...document.querySelectorAll(selector)];
  return handle.isConnected&&current.length===1&&current[0]===handle;
 },sourceId,{timeout:12000});
}

async function beginMouseDrag(sourceId){
 await waitForPersistentHandle(sourceId);
 await page.evaluate(id=>document.querySelector('[data-task-id="'+CSS.escape(id)+'"] [data-task-drag]')?.scrollIntoView({block:'nearest',inline:'nearest'}),sourceId);
 await waitForPersistentHandle(sourceId);
 const handle=page.locator('[data-task-id="'+sourceId+'"] [data-task-drag]').first();
 await waitForStableHandle(sourceId);
 await handle.hover();
 await waitForStableHandle(sourceId);
 const settledHandle=page.locator('[data-task-id="'+sourceId+'"] [data-task-drag]').first();
 await settledHandle.scrollIntoViewIfNeeded();await waitForStableHandle(sourceId);
 const bounds=await settledHandle.boundingBox();assert.ok(bounds,'Source drag handle is visible');
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

async function moveHeld(destination){
 await page.mouse.move(destination.x,destination.y,{steps:28});
}

async function holdNextMutation({failure=false}={}){
 let releaseGate,captured;
 const gate=new Promise(resolve=>{releaseGate=resolve;});
 const capturedRequest=new Promise(resolve=>{captured=resolve;});
 const request=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Timed out waiting for the held task mutation')),10000);
  capturedRequest.then(value=>{clearTimeout(timer);resolve(value);},reject);
 });
 await page.route('**/api/tasks/mutate',async route=>{
  const input=route.request().postDataJSON();captured(input);await gate;
  if(failure){await route.fulfill({status:503,contentType:'application/json',body:'{"error":"DRAG_TEST_FAILURE"}'});return;}
  await route.fallback();
 },{times:1});
 return {request,release:()=>releaseGate()};
}

async function releaseHeld(destination){
 await page.mouse.move(destination.x+1,destination.y+1,{steps:2});await page.mouse.up();
}

async function assertDragTransientCleared(sourceId,label){
 const state=await page.evaluate(id=>({active:document.body.classList.contains('tasks-drag-active'),
  committing:document.body.classList.contains('tasks-drag-committing'),preview:Boolean(document.querySelector('.tasks-drag-preview')),
  slot:Boolean(document.querySelector('.tasks-drop-slot')),floating:Boolean(document.querySelector('[data-task-id="'+CSS.escape(id)+'"][data-task-drag-source], [data-task-id="'+CSS.escape(id)+'"].is-dragging'))}),sourceId);
 assert.deepEqual(state,{active:false,committing:false,preview:false,slot:false,floating:false},label+' clears all transient drag UI before the response');
}

async function waitForStableTarget(target){
 await target.evaluate(async element=>{
  let previous=null,stableFrames=0;
  const deadline=performance.now()+3000;
  while(performance.now()<deadline){
   await new Promise(resolve=>requestAnimationFrame(resolve));
   if(!element.isConnected)throw Error('Held drag target was detached while its geometry settled');
   const rect=element.getBoundingClientRect();
   const stable=previous&&Math.abs(rect.x-previous.x)<.05&&Math.abs(rect.y-previous.y)<.05&&
    Math.abs(rect.width-previous.width)<.05&&Math.abs(rect.height-previous.height)<.05;
   stableFrames=stable?stableFrames+1:0;previous=rect;
   if(stableFrames>=3)return;
  }
  throw Error('Held drag target geometry did not settle');
 });
}

async function moveHeldToTarget(target,yRatio){
 let destination=null;
 // The first dragover inserts the in-flow slot and can move the target by a
 // full card height. Re-sample the settled target before the decisive trusted
 // mouse input so WebKit crosses the current midpoint, not its stale position.
 for(let pass=0;pass<2;pass++){
  await waitForStableTarget(target);
  const bounds=await target.boundingBox();assert.ok(bounds,'Held drag target remains visible');
  destination={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height*yRatio};
  await moveHeld(destination);
 }
 return destination;
}

async function commitHeld(destination){
 const mutation=waitForMutation();
 await releaseHeld(destination);
 return mutation;
}

async function liveSlot(){
 return page.evaluate(()=>{
  const slot=document.querySelector('.tasks-drop-slot');if(!slot)return null;
  const task=(element,direction)=>{
   let current=element[direction];
   while(current&&!current.matches?.('[data-task-id][data-task-record-id]'))current=current[direction];
   return current?{id:current.getAttribute('data-task-id'),recordId:current.getAttribute('data-task-record-id'),rect:current.getBoundingClientRect()}:null;
  };
  const rect=slot.getBoundingClientRect(),style=getComputedStyle(slot),pointer=window.__taskDragMotionProbe?.lastPointer??null;
  return {status:slot.parentElement?.getAttribute('data-task-drop-status'),key:slot.parentElement?.getAttribute('data-task-drop-key'),
   rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},display:style.display,position:style.position,pointer,
   previous:task(slot,'previousElementSibling'),next:task(slot,'nextElementSibling')};
 });
}

async function cancelHeldDrag(){
 await page.keyboard.press('Escape');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.mouse.up();await waitForDragCleanup();await stopMotionProbe();
}

const beforeTarget=(ids,sourceId,targetId)=>{
 const next=ids.filter(id=>id!==sourceId),index=next.indexOf(targetId);assert.ok(index>=0,'Board target is present in API order');next.splice(index,0,sourceId);return next;
};
const afterTarget=(ids,sourceId,targetId)=>{
 const next=ids.filter(id=>id!==sourceId),index=next.indexOf(targetId);assert.ok(index>=0,'Board target is present in API order');next.splice(index+1,0,sourceId);return next;
};
async function waitForBoardDom(status,expected){
 await page.waitForFunction(({status,expected})=>{
  const container=document.querySelector('[data-task-column="'+CSS.escape(status)+'"] [data-task-drop-container]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{status,expected});
}

async function waitForBoardCounts(expected){
 await page.waitForFunction(values=>Object.entries(values).every(([status,count])=>
  document.querySelector('[data-task-column="'+CSS.escape(status)+'"] .tasks-column-count')?.textContent?.trim()===String(count)),expected);
}

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');

 const list=await requireApi('/records','POST',{name:'Task drag motion '+runId,kind:'task_list'},201);
 let revision=list.revision??1;
 const seeded=[];
 for(let index=1;index<=5;index++){
  const title=prefix+String(index);
  const result=await requireApi('/tasks/mutate','POST',{recordId:list.id,action:'add',expectedRevision:revision,
   changes:{title,details:'Motion fixture '+index,status:'todo',priority:[2,9,4,7,1][index-1]}});
  revision=result.revision;
  const task=result.tasks.find(item=>item.title===title);assert.ok(task,'Seed mutation returns '+title);seeded.push(task);
 }
 assert.equal((await readTasks(list.id)).length,5,'Fixture contains exactly five tasks');
 const otherList=await requireApi('/records','POST',{name:'Task drag segment '+runId,kind:'task_list'},201);
 const otherResult=await requireApi('/tasks/mutate','POST',{recordId:otherList.id,action:'add',expectedRevision:otherList.revision??1,
  changes:{title:prefix+'OTHER',details:'Mixed board segment fixture',status:'blocked',priority:0}});
 const otherTask=otherResult.tasks.find(item=>item.title===prefix+'OTHER');assert.ok(otherTask,'Mixed board fixture task exists');
 const liveList=await requireApi('/records','POST',{name:'Task drag live '+runId,kind:'task_list'},201);
 let liveRevision=liveList.revision??1;const liveInProgress=[],liveDone=[];
 for(let index=0;index<15;index++){
  const status=index<3?'in_progress':'done',title=prefix+'LIVE_'+status+'_'+index;
  const result=await requireApi('/tasks/mutate','POST',{recordId:liveList.id,action:'add',expectedRevision:liveRevision,
   changes:{title,details:'Live native placement fixture '+index,status,priority:0}});
  liveRevision=result.revision;
  const task=result.tasks.find(item=>item.title===title);assert.ok(task,'Live placement fixture exists: '+title);
  (status==='in_progress'?liveInProgress:liveDone).push(task);
 }
 const liveOther=await requireApi('/records','POST',{name:'Task drag live other '+runId,kind:'task_list'},201);
 let liveOtherRevision=liveOther.revision??1;const liveOtherDone=[];
 for(let index=0;index<5;index++){
  const title=prefix+'LIVE_OTHER_'+index;
  const result=await requireApi('/tasks/mutate','POST',{recordId:liveOther.id,action:'add',expectedRevision:liveOtherRevision,
   changes:{title,details:'Other record populated column '+index,status:index===0?'in_progress':'done',priority:0}});
  liveOtherRevision=result.revision;
  const task=result.tasks.find(item=>item.title===title);assert.ok(task,'Other live fixture exists: '+title);liveOtherDone.push(task);
 }
 const singletonFixtures=[];
 for(let index=0;index<2;index++){
  const singletonList=await requireApi('/records','POST',{name:'Task drag singleton '+runId+' '+index,kind:'task_list'},201);
  const title=prefix+'SINGLETON_'+index;
  const result=await requireApi('/tasks/mutate','POST',{recordId:singletonList.id,action:'add',expectedRevision:singletonList.revision??1,
   changes:{title,details:'One own task in a populated status '+index,status:'in_progress',priority:0}});
  const task=result.tasks.find(item=>item.title===title);assert.ok(task,'Singleton live fixture exists: '+title);
  singletonFixtures.push({recordId:singletonList.id,task});
 }

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
 await page.waitForFunction(id=>Boolean(document.querySelector('[data-task-column="in_progress"] [data-task-id="'+CSS.escape(id)+'"]')&&
  !document.querySelector('[data-task-column="todo"] [data-task-id="'+CSS.escape(id)+'"]')),boardSource.id);

 // Global board rank follows the pointer across task-list boundaries.
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

 // Keep the native mouse held while checking live placement. These cases
 // catch stale origin slots even when a later drop mutation would succeed.
 await page.waitForFunction(({sameIds,doneId,otherId})=>sameIds.every(id=>document.querySelector('[data-task-column="in_progress"] [data-task-id="'+CSS.escape(id)+'"]'))&&
  Boolean(document.querySelector('[data-task-column="done"] [data-task-id="'+CSS.escape(doneId)+'"]'))&&
  Boolean(document.querySelector('[data-task-column="done"] [data-task-id="'+CSS.escape(otherId)+'"]')),
 {sameIds:liveInProgress.map(task=>task.id),doneId:liveDone[0].id,otherId:liveOtherDone[1].id});
 const liveMutationBaseline=mutationRequests;
 const liveSource=liveInProgress[0],sameTarget=liveInProgress[2];
 const sameTargetRow=page.locator('[data-task-column="in_progress"] [data-task-id="'+sameTarget.id+'"]');
 await sameTargetRow.scrollIntoViewIfNeeded();
 await beginMouseDrag(liveSource.id);
 await moveHeldToTarget(sameTargetRow,.8);
 await page.waitForFunction(targetId=>{
  const slot=document.querySelector('.tasks-drop-slot'),target=document.querySelector('[data-task-id="'+CSS.escape(targetId)+'"]');
  if(!slot||!target||slot.parentElement?.getAttribute('data-task-drop-status')!=='in_progress')return false;
  let previous=slot.previousElementSibling;while(previous&&!previous.matches('[data-task-id][data-task-record-id]'))previous=previous.previousElementSibling;
  const slotRect=slot.getBoundingClientRect(),targetRect=target.getBoundingClientRect();
  return previous===target&&slotRect.height>40&&slotRect.top>targetRect.top+targetRect.height*.45;
 },sameTarget.id);
 const sameSlot=await liveSlot();assert.equal(sameSlot?.previous?.id,sameTarget.id,'Held same-column drag moves slot below the target task');
 assert.equal(sameSlot?.status,'in_progress');assert.ok(sameSlot.rect.height>40&&sameSlot.display!=='none','Same-column slot occupies visible geometry');
 await page.screenshot({path:join(artifactDir,'held-same-column.png'),fullPage:true});
 await cancelHeldDrag();

 const foreignBefore=(await readBoard('in_progress')).map(task=>task.id),singletonIds=new Set(singletonFixtures.map(fixture=>fixture.task.id));
 const orderedSingletonIds=foreignBefore.filter(id=>singletonIds.has(id));assert.equal(orderedSingletonIds.length,2,'Both singleton tasks are in board order');
 const foreignSource=singletonFixtures.find(fixture=>fixture.task.id===orderedSingletonIds[0]).task;
 const foreignTarget=singletonFixtures.find(fixture=>fixture.task.id===orderedSingletonIds[1]).task;
 const foreignExpected=afterTarget(foreignBefore,foreignSource.id,foreignTarget.id);
 const foreignTargetRow=page.locator('[data-task-column="in_progress"] [data-task-id="'+foreignTarget.id+'"]');
 await foreignTargetRow.scrollIntoViewIfNeeded();
 await beginMouseDrag(foreignSource.id);
 const foreignDestination=await moveHeldToTarget(foreignTargetRow,.8);
 await page.waitForFunction(targetId=>{
  const slot=document.querySelector('.tasks-drop-slot'),target=document.querySelector('[data-task-id="'+CSS.escape(targetId)+'"]');
  if(!slot||!target||slot.parentElement?.getAttribute('data-task-drop-status')!=='in_progress')return false;
  let previous=slot.previousElementSibling;while(previous&&!previous.matches('[data-task-id][data-task-record-id]'))previous=previous.previousElementSibling;
  return previous===target&&slot.getBoundingClientRect().height>40;
 },foreignTarget.id);
 const foreignSlot=await liveSlot();assert.equal(foreignSlot?.previous?.id,foreignTarget.id,'Single-own-task drag follows a foreign-record card downward');
 assert.equal(foreignSlot?.status,'in_progress');
 const foreignMutation=await commitHeld(foreignDestination);
 const foreignResponse=await foreignMutation;assert.ok(foreignResponse.ok(),'Foreign same-column board mutation succeeds');
 const foreignRequest=foreignResponse.request().postDataJSON(),foreignResult=await foreignResponse.json();
 assert.equal(foreignRequest.action,'board_reorder','Global board uses the cross-record reorder action');
 assert.equal(foreignResult.boardOrder?.taskId,foreignSource.id);assert.equal(typeof foreignResult.boardOrder?.position,'number');
 await foreignResponse.finished();await waitForDragCleanup();await stopMotionProbe();
 assert.deepEqual((await readBoard('in_progress')).map(task=>task.id),foreignExpected,'Foreign same-column board rank persists at the pointer position');
 await waitForBoardDom('in_progress',foreignExpected);

 const foreignUpSource=foreignSource,foreignUpTarget=foreignTarget;
 const foreignUpRow=page.locator('[data-task-column="in_progress"] [data-task-id="'+foreignUpTarget.id+'"]');
 await foreignUpRow.scrollIntoViewIfNeeded();
 await beginMouseDrag(foreignUpSource.id);
 await moveHeldToTarget(foreignUpRow,.2);
 await page.waitForFunction(targetId=>{
  const slot=document.querySelector('.tasks-drop-slot'),target=document.querySelector('[data-task-id="'+CSS.escape(targetId)+'"]');
  if(!slot||!target||slot.parentElement?.getAttribute('data-task-drop-status')!=='in_progress')return false;
  let next=slot.nextElementSibling;while(next&&!next.matches('[data-task-id][data-task-record-id]'))next=next.nextElementSibling;
  return next===target&&slot.getBoundingClientRect().height>40;
 },foreignUpTarget.id);
 const foreignUpSlot=await liveSlot();assert.equal(foreignUpSlot?.next?.id,foreignUpTarget.id,'Single-own-task drag follows a foreign-record card upward');
 assert.equal(foreignUpSlot?.status,'in_progress');await cancelHeldDrag();

 const doneTarget=liveDone[0],doneTargetRow=page.locator('[data-task-column="done"] [data-task-id="'+doneTarget.id+'"]');
 const doneBefore=(await readBoard('done')).map(task=>task.id),doneExpected=beforeTarget(doneBefore,foreignSource.id,doneTarget.id);
 await doneTargetRow.scrollIntoViewIfNeeded();
 await beginMouseDrag(foreignSource.id);
 const doneDestination=await moveHeldToTarget(doneTargetRow,.2);
 await page.waitForFunction(({targetId,otherRecordId})=>{
  const slot=document.querySelector('.tasks-drop-slot'),target=document.querySelector('[data-task-id="'+CSS.escape(targetId)+'"]');
  const container=slot?.parentElement;if(!slot||!target||container?.getAttribute('data-task-drop-status')!=='done')return false;
  let next=slot.nextElementSibling;while(next&&!next.matches('[data-task-id][data-task-record-id]'))next=next.nextElementSibling;
  const records=new Set([...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-record-id')));
  const slotRect=slot.getBoundingClientRect(),targetRect=target.getBoundingClientRect();
  const targetMoving=target.getAnimations().some(animation=>animation.playState==='running'||animation.playState==='pending');
  return next===target&&records.has(otherRecordId)&&!targetMoving&&slotRect.height>40&&slotRect.top<targetRect.top&&targetRect.top-slotRect.bottom<32;
 },{targetId:doneTarget.id,otherRecordId:liveOther.id});
 const crossSlot=await liveSlot();assert.equal(crossSlot?.next?.id,doneTarget.id,'Held cross-column drag places slot before the same-list target');
 assert.equal(crossSlot?.status,'done');assert.ok(crossSlot.rect.height>40&&crossSlot.position==='relative','Cross-column slot remains in flow');
 await page.screenshot({path:join(artifactDir,'held-cross-column.png'),fullPage:true});
 const crossControl=await holdNextMutation(),crossResponsePromise=waitForMutation();
 await releaseHeld(doneDestination);
 const pendingCrossRequest=await crossControl.request;
 assert.equal(pendingCrossRequest.action,'board_reorder');assert.equal(pendingCrossRequest.changes?.status,'done');
 await waitForDragCleanup();await waitForBoardDom('done',doneExpected);
 await page.waitForFunction(id=>!document.querySelector('[data-task-column="in_progress"] [data-task-id="'+CSS.escape(id)+'"]')&&
  Boolean(document.querySelector('[data-task-column="done"] [data-task-id="'+CSS.escape(id)+'"]')),foreignSource.id);
 await assertDragTransientCleared(foreignSource.id,'Pending cross-column board drop');await stopMotionProbe();
 crossControl.release();
 const crossResponse=await crossResponsePromise;assert.ok(crossResponse.ok(),'Foreign cross-column board mutation succeeds');
 const crossRequest=crossResponse.request().postDataJSON(),crossResult=await crossResponse.json();
 assert.equal(crossRequest.action,'board_reorder');assert.equal(crossRequest.changes?.status,'done');
 assert.equal(crossResult.boardOrder?.taskId,foreignSource.id);assert.equal(typeof crossResult.boardOrder?.position,'number');
 await crossResponse.finished();
 assert.deepEqual((await readBoard('done')).map(task=>task.id),doneExpected,'Foreign cross-column board rank persists at the pointer position');
 await waitForBoardDom('done',doneExpected);
 const inProgressAfterCross=foreignExpected.filter(id=>id!==foreignSource.id);
 assert.deepEqual((await readBoard('in_progress')).map(task=>task.id),inProgressAfterCross,'Cross-column board move removes the source from its previous rank');

 await page.reload();
 await page.getByPlaceholder('搜索任务…').fill(prefix);
 assert.deepEqual((await readBoard('in_progress')).map(task=>task.id),inProgressAfterCross,'Reload preserves same-column global board rank');
 assert.deepEqual((await readBoard('done')).map(task=>task.id),doneExpected,'Reload preserves cross-column global board rank');
 await waitForBoardDom('in_progress',inProgressAfterCross);await waitForBoardDom('done',doneExpected);

 const doneViewport=page.locator('[data-task-column="done"] .tasks-column-viewport');await doneViewport.evaluate(element=>{element.scrollTop=0;});
 await beginMouseDrag(foreignSource.id);
 const viewportBounds=await doneViewport.boundingBox();assert.ok(viewportBounds,'Scrollable done column is visible while held');
 await moveHeld({x:viewportBounds.x+viewportBounds.width/2,y:viewportBounds.y+70});
 await page.waitForFunction(()=>document.querySelector('.tasks-drop-slot')?.parentElement?.getAttribute('data-task-drop-status')==='done');
 const scrollStart=await liveSlot();assert.ok(scrollStart?.next?.id||scrollStart?.previous?.id,'Initial scrolled-column slot has a task neighbour');
 const initialNeighbour=scrollStart.next?.id??scrollStart.previous.id;
 const edgeTop=viewportBounds.y+viewportBounds.height-48;
 const edgeY=viewportBounds.y+viewportBounds.height-24;
 // Chromium may stop producing dragover events when the in-flow slot replaces
 // the element under a vertical pointer path. Sweep across distinct cards at
 // the inner edge so this test first proves that trusted input reached the
 // production auto-scroll zone, then judges the resulting scroll behavior.
 try{
  await moveHeld({x:viewportBounds.x+viewportBounds.width*.28,y:edgeY});
  await moveHeld({x:viewportBounds.x+viewportBounds.width*.72,y:edgeY});
  await page.waitForFunction(({edgeTop,edgeBottom})=>{
   const pointer=window.__taskDragMotionProbe?.lastPointer;
   return Boolean(pointer&&pointer.y>=edgeTop&&pointer.y<=edgeBottom);
  },{edgeTop,edgeBottom:viewportBounds.y+viewportBounds.height});
  await page.waitForFunction(({initialNeighbour})=>{
   const viewport=document.querySelector('[data-task-column="done"] .tasks-column-viewport'),slot=document.querySelector('.tasks-drop-slot');
   if(!viewport||!slot||viewport.scrollTop<60||slot.parentElement?.getAttribute('data-task-drop-status')!=='done')return false;
   const task=(direction)=>{let node=slot[direction];while(node&&!node.matches?.('[data-task-id][data-task-record-id]'))node=node[direction];return node?.getAttribute('data-task-id')??null;};
   const rect=slot.getBoundingClientRect(),viewportRect=viewport.getBoundingClientRect(),neighbour=task('nextElementSibling')??task('previousElementSibling');
   return neighbour!==initialNeighbour&&rect.bottom>=viewportRect.top&&rect.top<=viewportRect.bottom;
  },{initialNeighbour});
 }catch(error){
  const diagnostic=await page.evaluate(({requestedEdgeY,edgeTop})=>{
    const viewport=document.querySelector('[data-task-column="done"] .tasks-column-viewport'),slot=document.querySelector('.tasks-drop-slot');
    const pointer=window.__taskDragMotionProbe?.lastPointer??null,hit=pointer?document.elementFromPoint(pointer.x,pointer.y):null;
    const rect=element=>{const value=element?.getBoundingClientRect();return value?{x:value.x,y:value.y,width:value.width,height:value.height}:null;};
    const ancestors=[];for(let node=hit;node&&ancestors.length<12;node=node.parentElement)ancestors.push({tag:node.tagName,className:node.getAttribute?.('class')});
    const viewportRect=viewport?.getBoundingClientRect(),board=viewport?.closest('.tasks-board-viewport'),boardRect=board?.getBoundingClientRect();
    const clipping=value=>value?{left:Math.max(0,-value.left),top:Math.max(0,-value.top),
     right:Math.max(0,value.right-innerWidth),bottom:Math.max(0,value.bottom-innerHeight)}:null;
    return {requestedEdgeY,edgeTop,pointer,window:{width:innerWidth,height:innerHeight},
     hit:{tag:hit?.tagName,className:hit?.getAttribute?.('class'),insideViewport:Boolean(hit?.closest?.('.tasks-column-viewport')),ancestors},
     viewport:{rect:rect(viewport),scrollTop:viewport?.scrollTop,scrollHeight:viewport?.scrollHeight,clientHeight:viewport?.clientHeight,overflowY:viewport?getComputedStyle(viewport).overflowY:null},
     clipping:{viewport:clipping(viewportRect),board:clipping(boardRect),boardRect:rect(board)},
     slot:{rect:rect(slot),status:slot?.parentElement?.getAttribute('data-task-drop-status')}};
  },{requestedEdgeY:edgeY,edgeTop});
  throw new Error('Held column auto-scroll did not advance: '+JSON.stringify(diagnostic),{cause:error});
 }
 const scrolledSlot=await liveSlot(),scrollTop=await doneViewport.evaluate(element=>element.scrollTop);
 assert.ok(scrollTop>=60,'Held edge drag auto-scrolls the populated column');
 assert.notEqual(scrolledSlot?.next?.id??scrolledSlot?.previous?.id,initialNeighbour,'Slot advances to a later task while auto-scrolling');
 assert.equal(scrolledSlot?.status,'done');await cancelHeldDrag();
 assert.equal(mutationRequests,liveMutationBaseline+2,'Only the two committed live board placements mutate tasks');

 const blockedBefore=(await readBoard('blocked')).map(task=>task.id),blockedExpected=beforeTarget(blockedBefore,boardSource.id,otherTask.id);
 const blockedTarget=page.locator('[data-task-column="blocked"] [data-task-id="'+otherTask.id+'"]');await blockedTarget.scrollIntoViewIfNeeded();
 await beginMouseDrag(boardSource.id);
 const blockedDestination=await moveHeldToTarget(blockedTarget,.2);
 await page.waitForFunction(targetId=>{
  const slot=document.querySelector('.tasks-drop-slot'),container=slot?.parentElement;
  if(!slot||container?.getAttribute('data-task-drop-status')!=='blocked')return false;
  let next=slot.nextElementSibling;while(next&&!next.matches('[data-task-id][data-task-record-id]'))next=next.nextElementSibling;
  return next?.getAttribute('data-task-id')===targetId&&slot.getBoundingClientRect().height>40;
 },otherTask.id);
 const segmentMutation=await commitHeld(blockedDestination);
 const segmentResponse=await segmentMutation;assert.ok(segmentResponse.ok(),'Mixed board drag mutation succeeds');await segmentResponse.finished();
 await waitForDragCleanup();await stopMotionProbe();
 assert.equal((await requireApi('/tasks/'+boardSource.id)).item.status,'blocked','Mixed board drag persists destination status');
 assert.equal(segmentResponse.request().postDataJSON().action,'board_reorder');
 assert.deepEqual((await readBoard('blocked')).map(task=>task.id),blockedExpected,'Mixed board pointer rank persists across records');
 await waitForBoardDom('blocked',blockedExpected);

 // A rejected cross-column board move must expose its optimistic status and
 // counts before the response, then restore both columns after the failure.
 const boardFailureSource=boardSource.id,boardFailureTarget=doneTarget.id;
 const boardFailureBlockedBefore=(await readBoard('blocked')).map(task=>task.id),boardFailureDoneBefore=(await readBoard('done')).map(task=>task.id);
 const boardFailureBlockedOptimistic=boardFailureBlockedBefore.filter(id=>id!==boardFailureSource);
 const boardFailureDoneOptimistic=beforeTarget(boardFailureDoneBefore,boardFailureSource,boardFailureTarget);
 const boardFailureTargetRow=page.locator('[data-task-column="done"] [data-task-id="'+boardFailureTarget+'"]');
 await boardFailureTargetRow.scrollIntoViewIfNeeded();await beginMouseDrag(boardFailureSource);
 const boardFailureDestination=await moveHeldToTarget(boardFailureTargetRow,.2);
 await page.waitForFunction(targetId=>{
  const slot=document.querySelector('.tasks-drop-slot'),target=document.querySelector('[data-task-id="'+CSS.escape(targetId)+'"]');
  if(!slot||!target||slot.parentElement?.getAttribute('data-task-drop-status')!=='done')return false;
  let next=slot.nextElementSibling;while(next&&!next.matches('[data-task-id][data-task-record-id]'))next=next.nextElementSibling;
  return next===target&&slot.getBoundingClientRect().height>40;
 },boardFailureTarget);
 const boardFailureControl=await holdNextMutation({failure:true}),boardFailureResponsePromise=waitForMutation();
 await releaseHeld(boardFailureDestination);
 const pendingBoardFailureRequest=await boardFailureControl.request;
 assert.equal(pendingBoardFailureRequest.action,'board_reorder');assert.equal(pendingBoardFailureRequest.changes?.status,'done');
 await waitForDragCleanup();await waitForBoardDom('blocked',boardFailureBlockedOptimistic);await waitForBoardDom('done',boardFailureDoneOptimistic);
 await waitForBoardCounts({blocked:boardFailureBlockedOptimistic.length,done:boardFailureDoneOptimistic.length});
 await assertDragTransientCleared(boardFailureSource,'Pending rejected board drop');
 assert.equal(await page.locator('[data-task-workspace]').getByText('操作失败',{exact:true}).count(),0,'Board failure UI waits for the rejected response');
 await stopMotionProbe();boardFailureControl.release();
 const boardFailureResponse=await boardFailureResponsePromise;assert.equal(boardFailureResponse.status(),503,'Rejected board drag receives the injected failure');
 await waitForBoardDom('blocked',boardFailureBlockedBefore);await waitForBoardDom('done',boardFailureDoneBefore);
 await waitForBoardCounts({blocked:boardFailureBlockedBefore.length,done:boardFailureDoneBefore.length});
 await page.waitForFunction(()=>document.querySelector('.tasks-drag-live')?.textContent==='任务移动失败，已恢复原位置');
 await page.locator('[data-task-workspace]').getByText('操作失败',{exact:true}).waitFor();
 assert.deepEqual((await readBoard('blocked')).map(task=>task.id),boardFailureBlockedBefore,'Rejected board drag restores the source status order');
 assert.deepEqual((await readBoard('done')).map(task=>task.id),boardFailureDoneBefore,'Rejected board drag restores the destination status order');

 // List: move the last task before the first and assert the optimistic DOM
 // order before the delayed response, then the shared total order afterward.
 await listMode.click();
 const group=page.locator('[data-task-list-id="'+list.id+'"]');await group.waitFor();
 await page.waitForFunction(id=>document.querySelector('[data-task-list-id="'+CSS.escape(id)+'"]')?.querySelectorAll('[data-task-id]').length===5,list.id);
 const beforeList=await readTasks(list.id),beforeIds=beforeList.map(item=>item.id),beforeGlobal=(await readGlobal()).map(item=>item.id);
 const listSource=beforeIds.at(-1),listTarget=beforeIds[0];assert.ok(listSource&&listTarget&&listSource!==listTarget);
 const expectedList=[listSource,...beforeIds.filter(id=>id!==listSource)],expectedGlobal=beforeTarget(beforeGlobal,listSource,listTarget);
 const targetRow=group.locator('[data-task-id="'+listTarget+'"]');
 await targetRow.scrollIntoViewIfNeeded();
 const rowBounds=await targetRow.boundingBox();assert.ok(rowBounds,'Target list row is visible');
 const listStart=await beginMouseDrag(listSource);
 const listDestination={x:rowBounds.x+Math.min(120,rowBounds.width/2),y:rowBounds.y+rowBounds.height*.25};
 await moveDrag(listStart,listDestination);
 await page.waitForFunction(({listId,targetId})=>{
  const slot=document.querySelector('.tasks-drop-slot'),target=document.querySelector('[data-task-id="'+CSS.escape(targetId)+'"]');
  return slot?.parentElement?.getAttribute('data-task-drop-key')==='list:'+listId&&slot.nextElementSibling===target;
 },{listId:list.id,targetId:listTarget});
 const listControl=await holdNextMutation(),listResponsePromise=waitForMutation();
 await releaseHeld(listDestination);
 const pendingListRequest=await listControl.request;assert.equal(pendingListRequest.action,'reorder');
 await waitForDragCleanup();
 await page.waitForFunction(({listId,expected})=>{
  const container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(listId)+'"]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{listId:list.id,expected:expectedList});
 await assertDragTransientCleared(listSource,'Pending list drop');
 const listProbe=await stopMotionProbe();
 assertMotion(listProbe,'List drag',{layout:'row',key:'list:'+list.id});
 listControl.release();
 const listResponse=await listResponsePromise;assert.ok(listResponse.ok(),'List drag mutation succeeds');await listResponse.finished();
 const afterListIds=(await readTasks(list.id)).map(item=>item.id);
 assert.deepEqual(afterListIds,expectedList,'List drag persists the exact record-filtered total order');
 assert.deepEqual((await readGlobal()).map(item=>item.id),expectedGlobal,'List drag updates the shared global total order');
 await page.waitForFunction(({listId,expected})=>{
  const container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(listId)+'"]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{listId:list.id,expected:expectedList});

 // Releasing after leaving every valid drop container must discard the last
 // valid target and submit no stale move.
 const invalidBefore=(await readTasks(list.id)).map(item=>item.id),invalidRequests=mutationRequests;
 const invalidSource=invalidBefore[2],invalidTarget=invalidBefore[0];
 const invalidTargetRow=group.locator('[data-task-id="'+invalidTarget+'"]');await invalidTargetRow.scrollIntoViewIfNeeded();
 await beginMouseDrag(invalidSource);await moveHeldToTarget(invalidTargetRow,.2);
 await page.waitForFunction(targetId=>document.querySelector('.tasks-drop-slot')?.nextElementSibling?.getAttribute('data-task-id')===targetId,invalidTarget);
 const invalidArea=await page.locator('[data-task-search]').boundingBox();assert.ok(invalidArea,'Task search is a visible invalid drop area');
 await moveHeld({x:invalidArea.x+invalidArea.width/2,y:invalidArea.y+invalidArea.height/2});
 await page.mouse.move(invalidArea.x+invalidArea.width/2+1,invalidArea.y+invalidArea.height/2+1,{steps:2});await page.waitForTimeout(120);
 await page.waitForFunction(sourceId=>document.querySelector('.tasks-drop-slot')?.nextElementSibling?.getAttribute('data-task-id')===sourceId,invalidSource);
 await page.mouse.up();await waitForDragCleanup();await stopMotionProbe();await page.waitForTimeout(150);
 assert.equal(mutationRequests,invalidRequests,'Invalid final drop submits no stale mutation');
 assert.deepEqual((await readTasks(list.id)).map(item=>item.id),invalidBefore,'Invalid final drop preserves API order');

 // A rejected move must clean up the transient UI and announce failure only
 // after the async action rejects.
 const failureBefore=(await readTasks(list.id)).map(item=>item.id),failureSource=failureBefore[3],failureTarget=failureBefore[0];
 const failureOptimistic=beforeTarget(failureBefore,failureSource,failureTarget),failureControl=await holdNextMutation({failure:true});
 const failureTargetRow=group.locator('[data-task-id="'+failureTarget+'"]');await failureTargetRow.scrollIntoViewIfNeeded();
 await beginMouseDrag(failureSource);const failureDestination=await moveHeldToTarget(failureTargetRow,.2),failureResponsePromise=waitForMutation();
 await page.waitForFunction(targetId=>document.querySelector('.tasks-drop-slot')?.nextElementSibling?.getAttribute('data-task-id')===targetId,failureTarget);
 await releaseHeld(failureDestination);
 const pendingFailureRequest=await failureControl.request;assert.equal(pendingFailureRequest.action,'reorder');
 await waitForDragCleanup();
 await page.waitForFunction(({listId,expected})=>{
  const container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(listId)+'"]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{listId:list.id,expected:failureOptimistic});
 await assertDragTransientCleared(failureSource,'Pending rejected list drop');
 assert.equal(await page.locator('[data-task-workspace]').getByText('操作失败',{exact:true}).count(),0,'Failure UI waits for the rejected response');
 await stopMotionProbe();failureControl.release();
 const failureResponse=await failureResponsePromise;
 assert.equal(failureResponse.status(),503,'Rejected drag receives the injected failure');
 await page.waitForFunction(({listId,expected})=>{
  const container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(listId)+'"]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{listId:list.id,expected:failureBefore});
 await page.waitForFunction(()=>document.querySelector('.tasks-drag-live')?.textContent==='任务移动失败，已恢复原位置');
 await page.locator('[data-task-workspace]').getByText('操作失败',{exact:true}).waitFor();
 assert.deepEqual((await readTasks(list.id)).map(item=>item.id),failureBefore,'Rejected drag preserves API order');

 // Escape must fully tear down the transient DOM and submit no mutation.
 const cancelBefore=(await readTasks(list.id)).map(item=>item.id),cancelRequests=mutationRequests;
 const cancelSource=cancelBefore[2],cancelTarget=cancelBefore[0];
 const cancelTargetRow=group.locator('[data-task-id="'+cancelTarget+'"]');
 await cancelTargetRow.scrollIntoViewIfNeeded();await beginMouseDrag(cancelSource);await moveHeldToTarget(cancelTargetRow,.2);
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
 await page.waitForFunction(({listId,expected})=>{
  const container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(listId)+'"]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{listId:list.id,expected:keyboardAfter});

 // Drawer controls use the same authoritative response. Verify both directions
 // update the visible list immediately and animate the real rows into place.
 const drawerSource=keyboardAfter[1];assert.ok(drawerSource,'Drawer reorder source exists');
 await group.locator('[data-task-id="'+drawerSource+'"] [data-task-edit]').click();
 const editor=page.locator('[id="task-editor-'+drawerSource+'"] [data-task-editor]');await editor.waitFor();
 const moveDown=editor.getByRole('button',{name:'下移任务',exact:true});await moveDown.waitFor();
 const drawerBefore=(await readTasks(list.id)).map(item=>item.id),drawerIndex=drawerBefore.indexOf(drawerSource);
 assert.ok(drawerIndex>=0&&drawerIndex<drawerBefore.length-1,'Drawer source can move down');
 const drawerDownExpected=[...drawerBefore];drawerDownExpected.splice(drawerIndex,1);drawerDownExpected.splice(drawerIndex+1,0,drawerSource);
 await startOrderProbe(list.id);
 const downMutation=waitForMutation();await moveDown.click();
 const downResponse=await downMutation;assert.ok(downResponse.ok(),'Drawer move down mutation succeeds');await downResponse.finished();
 await page.waitForFunction(({listId,expected})=>{
  const container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(listId)+'"]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{listId:list.id,expected:drawerDownExpected});
 await page.waitForTimeout(90);assertOrderMotion(await stopOrderProbe(),'Drawer move down');
 assert.deepEqual((await readTasks(list.id)).map(item=>item.id),drawerDownExpected,'Drawer move down persists exact order');

 const moveUp=editor.getByRole('button',{name:'上移任务',exact:true});await moveUp.waitFor();
 await startOrderProbe(list.id);
 const upMutation=waitForMutation();await moveUp.click();
 const upResponse=await upMutation;assert.ok(upResponse.ok(),'Drawer move up mutation succeeds');await upResponse.finished();
 await page.waitForFunction(({listId,expected})=>{
  const container=document.querySelector('[data-task-drop-key="list:'+CSS.escape(listId)+'"]');
  const actual=container?[...container.children].filter(element=>element.matches('[data-task-id][data-task-record-id]')).map(element=>element.getAttribute('data-task-id')):[];
  return JSON.stringify(actual)===JSON.stringify(expected);
 },{listId:list.id,expected:drawerBefore});
 await page.waitForTimeout(90);assertOrderMotion(await stopOrderProbe(),'Drawer move up');
 assert.deepEqual((await readTasks(list.id)).map(item=>item.id),drawerBefore,'Drawer move up restores exact order');

 assert.deepEqual(faults,[],'Browser runtime errors');
 console.log('PASS task drag motion:',engine,'board/list preview, in-flow slot, FLIP frames, immediate DOM order, drawer order and keyboard order',
  JSON.stringify({orderMotionEvidence}));
}catch(error){
 const failureScreenshot=join(artifactDir,'failure.png');
 await page.screenshot({path:failureScreenshot,fullPage:true}).catch(()=>undefined);
 console.error('Task drag motion regression failed',JSON.stringify({engine,url:page.url(),faults,artifactDir,failureScreenshot}));
 throw error;
}finally{
 await browser.close();
}
