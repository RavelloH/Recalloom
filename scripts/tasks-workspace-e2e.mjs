/** Task workspace pagination, filtering, editing, ordering and mobile layout. */
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
const context=await browser.newContext({viewport:{width:1600,height:1100},reducedMotion:'no-preference',colorScheme:'light'});
const page=await context.newPage();
page.setDefaultTimeout(20000);
const faults=[];
const lifecycle=[];
page.on('pageerror',error=>faults.push(error.message));
page.on('crash',()=>lifecycle.push('page-crash'));
page.on('close',()=>lifecycle.push('page-close: '+page.url()));
page.on('framenavigated',frame=>{if(frame===page.mainFrame())lifecycle.push('navigate: '+frame.url());});
browser.on('disconnected',()=>lifecycle.push('browser-disconnected'));
await page.addInitScript(()=>{
 window.__taskViewTransitions=[];
 if(typeof document.startViewTransition!=='function')return;
 const original=document.startViewTransition.bind(document);
 document.startViewTransition=(...args)=>{
  const record={finished:false};
  window.__taskViewTransitions.push(record);
  const transition=original(...args);
  transition.finished.then(()=>{record.finished=true;},()=>{record.finished=true;});
  return transition;
 };
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

const statuses=['todo','in_progress','blocked','done','cancelled'];
const statusNames={todo:'待开始',in_progress:'进行中',blocked:'阻塞',done:'已完成',cancelled:'取消'};
const runId=Date.now().toString(36).toUpperCase();
const fixturePrefix='TW_'+runId+'_';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForInputValues(entries){
 const deadline=Date.now()+10000;
 let values=[];
 do{
  values=await Promise.all(entries.map(entry=>entry.locator.inputValue()));
  if(entries.every((entry,index)=>values[index]===entry.expected))return;
  await wait(50);
 }while(Date.now()<deadline);
 assert.deepEqual(values,entries.map(entry=>entry.expected),'Form values update after the confirmed reload');
}
async function waitForViewTransitionsSince(count){
 await page.waitForFunction(since=>typeof document.startViewTransition!=='function'||
  (window.__taskViewTransitions?.length>since&&window.__taskViewTransitions.slice(since).every(record=>record.finished)),
 count,{timeout:15000});
}
async function waitForDockedPanelSettled(panel){
 await page.waitForFunction(id=>{
  const element=document.querySelector(id);
  if(!element?.hasAttribute('data-ready'))return false;
  const style=getComputedStyle(element);
  return style.opacity==='1'&&!element.getAnimations().some(animation=>
   animation.playState==='running'||animation.playState==='pending');
 },'#'+panel,{timeout:12000});
}
async function waitForTaskEditorViewport(modal,width){
 await page.waitForFunction(({modal,width})=>{
  const element=document.querySelector('[id^="task-editor-"]');
  if(!element)return false;
  const rect=element.getBoundingClientRect(),dialog=element.closest('dialog');
  const actualModal=Boolean(dialog?.matches(':modal'));
  const geometry=modal
   ?rect.x>=-1&&rect.width>=width-2
   :rect.width>0&&rect.width<width;
  return actualModal===modal&&geometry;
 },{modal,width},{timeout:12000});
}
async function assertTaskRecordLayout(width){
 await page.locator('.task-list-workbench-header').waitFor();
 await page.locator('[data-task-column] [data-task-id]').first().waitFor();
 await page.locator('.main-scroll').evaluate(element=>{element.scrollTop=0;});
 await page.waitForFunction(()=>{
  const view=document.querySelector('.record-page.workbench-tasks .tasks-view');
  const viewport=document.querySelector('.main-scroll');
  return view&&viewport&&view.getBoundingClientRect().bottom<=viewport.getBoundingClientRect().bottom+2;
 });
 const layout=await page.locator('.record-page.workbench-tasks').evaluate(element=>{
  const bounds=selector=>{
   const rect=element.querySelector(selector)?.getBoundingClientRect();
   return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom}:null;
  };
  const viewport=document.querySelector('.main-scroll').getBoundingClientRect();
  const topbar=document.querySelector('.topbar').getBoundingClientRect();
  return {header:bounds('.task-list-workbench-header'),toolbar:bounds('.tasks-toolbar'),
   identity:bounds('.workbench-identity'),
   actions:bounds('.tasks-toolbar-actions'),more:bounds('.tasks-toolbar-actions button[aria-label="更多操作"]'),
   create:bounds('.tasks-toolbar-actions [data-task-create]'),view:bounds('.tasks-view'),
   viewport:{top:viewport.top,bottom:viewport.bottom,height:viewport.height},topbarBottom:topbar.bottom,
   standalone:element.querySelectorAll('.page-actions-bar').length,
   overflow:document.documentElement.scrollWidth-innerWidth};
 });
 assert.ok(layout.header&&layout.toolbar&&layout.actions&&layout.more&&layout.create&&layout.view,
  'Task record exposes its compact header and grouped actions at '+width+'px: '+JSON.stringify(layout));
 const expectedHeaderTop=layout.viewport.top+(width<=720?20:width<=1000?92:96);
 assert.ok(Math.abs(layout.header.y-expectedHeaderTop)<2,
  'Task record uses the ordinary page top gap at '+width+'px: '+JSON.stringify(layout));
 assert.ok(layout.identity&&layout.identity.y>=layout.topbarBottom&&layout.identity.height>=20,
  'Task list type and revision stay below the fixed top bar at '+width+'px: '+JSON.stringify(layout));
 assert.ok(Math.abs(layout.more.y+layout.more.height/2-layout.create.y-layout.create.height/2)<2&&
  layout.create.x-layout.more.right>=4&&layout.create.x-layout.more.right<=8,
  'More sits immediately left of New Task on the same row at '+width+'px: '+JSON.stringify(layout));
 assert.ok(Math.abs(layout.actions.right-layout.toolbar.right)<2,
  'Task record actions align to the right at '+width+'px: '+JSON.stringify(layout));
 assert.equal(layout.standalone,0,'No standalone More action row at '+width+'px');
 assert.equal(await page.getByRole('button',{name:'更多操作',exact:true}).count(),1,
  'The task record has exactly one More action at '+width+'px');
 assert.ok(layout.view.bottom<=layout.viewport.bottom+2&&layout.view.height>=180,
  'Task view fits the remaining viewport at '+width+'px: '+JSON.stringify(layout));
 assert.ok(layout.overflow<=1,'Task record has no page overflow at '+width+'px');
 if(width>1000)assert.ok(Math.abs(layout.view.bottom-(layout.viewport.bottom-16))<3,
  'Desktop task board fills the space below its ordinary page header');
 await page.screenshot({path:join(artifactDir,'record-'+width+'-light.png')});
}
const api=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{
 const response=await fetch('/api'+path,{method,headers:body?{'content-type':'application/json'}:undefined,
  body:body?JSON.stringify(body):undefined});
 const data=await response.json();
 return {status:response.status,data};
},{path,method,body});
const requireApi=async(path,method='GET',body,expectedStatus=200)=>{
 const response=await api(path,method,body);
 assert.equal(response.status,expectedStatus,path+' '+method+': '+JSON.stringify(response.data).slice(0,500));
 return response.data;
};
async function waitForTaskMutation(expectedStatus){
 const response=await page.waitForResponse(candidate=>new URL(candidate.url()).pathname==='/api/tasks/mutate'&&
  candidate.request().method()==='POST');
 await response.finished();
 if(expectedStatus===undefined)assert.ok(response.ok(),'Task mutation succeeded: '+response.status());
 else assert.equal(response.status(),expectedStatus,'Task mutation response status');
 return response.json();
}
async function clickTaskMutation(button,expectedStatus){
 const response=waitForTaskMutation(expectedStatus);
 await button.click();
 return response;
}
const fixtureLists=[];
const artifactDir=join(root,'tmp','tasks-workspace-'+engine+'-'+runId);
mkdirSync(artifactDir,{recursive:true});

async function createList(name){
 return requireApi('/records','POST',{name,kind:'task_list'},201);
}

async function seedList(list,status,count){
 return page.evaluate(async({recordId,status,count,prefix})=>{
  const readMeta=async()=>{
   const response=await fetch('/api/records/'+recordId+'?metadataOnly=true');
   if(!response.ok)throw Error('Task list metadata '+response.status);
   return response.json();
  };
  let revision=(await readMeta()).revision;
  const items=[];
  for(let index=1;index<=count;index++){
   const title=prefix+status+'_'+String(index).padStart(3,'0');
   const response=await fetch('/api/tasks/mutate',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({recordId,action:'add',expectedRevision:revision,
     changes:{title,details:'Fixture detail '+title,status,priority:0}})});
   const data=await response.json();
   if(!response.ok)throw Error('Add task '+title+': '+response.status+' '+JSON.stringify(data));
   revision=data.revision;
   const item=data.tasks?.find(task=>task.title===title);
   if(!item)throw Error('Task mutation did not return '+title);
   items.push(item);
  }
  return {revision,items};
 },{recordId:list.id,status,count,prefix:fixturePrefix});
}

async function readPaged(path,params,limit=40){
 const items=[],pages=[];
 let cursor=null;
 for(let index=0;index<20;index++){
  const query=new URLSearchParams({...params,limit:String(limit)});
  if(cursor)query.set('cursor',cursor);
  const data=await requireApi(path+'?'+query.toString());
  assert.ok(Array.isArray(data.items),path+' returns items');
  pages.push(data);
  items.push(...data.items);
  if(!data.page?.hasMore)break;
  assert.equal(typeof data.page.nextCursor,'string','A next page has an opaque cursor');
  assert.ok(data.page.nextCursor,'A continuation cursor is non-empty');
  cursor=data.page.nextCursor;
  if(index===19)assert.fail(path+' pagination did not terminate');
 }
 return {items,pages};
}

function assertSameIds(actual,expected,message){
 const actualIds=actual.map(item=>item.id),expectedIds=expected.map(item=>item.id);
 assert.equal(new Set(actualIds).size,actualIds.length,message+' has no duplicate IDs');
 assert.deepEqual([...actualIds].sort(),[...expectedIds].sort(),message+' contains every expected task exactly once');
}

async function openStatusFilter(){
 const host=page.locator('[data-task-status-filter]');
 const trigger=host.locator('[role="combobox"],button').first();
 await trigger.click();
 const listbox=page.getByRole('listbox').last();
 await listbox.waitFor();
 return listbox;
}

async function statusOption(status){
 return page.getByRole('option',{name:statusNames[status]});
}

async function waitForCount(locator,count,label){
 await page.waitForFunction(({selector,count})=>document.querySelector(selector)?.querySelectorAll('[data-task-id]').length===count,
  {selector:await locator.evaluate(element=>{
   if(element.id)return '#'+CSS.escape(element.id);
   const status=element.getAttribute('data-task-column');
   return status?'[data-task-column="'+status+'"]':'[data-task-workspace]';
  }),count},{timeout:20000}).catch(async error=>{
   const actual=await locator.locator('[data-task-id]').count();
   throw Error(label+' expected '+count+' task rows, found '+actual+': '+error.message);
  });
}

async function scrollToEnd(locator,axis='vertical'){
 await locator.evaluate((element,axis)=>{
  const candidates=[element,...element.querySelectorAll('*')].filter(node=>{
   const style=getComputedStyle(node);
   return axis==='vertical'
    ?node.scrollHeight>node.clientHeight+2&&/(auto|scroll)/.test(style.overflowY)
    :node.scrollWidth>node.clientWidth+2&&/(auto|scroll)/.test(style.overflowX);
  }).sort((a,b)=>axis==='vertical'?b.scrollHeight-a.scrollHeight:b.scrollWidth-a.scrollWidth);
  const target=candidates[0]??element;
  if(axis==='vertical')target.scrollTop=target.scrollHeight;
  else target.scrollLeft=target.scrollWidth;
  target.dispatchEvent(new Event('scroll',{bubbles:true}));
 },axis);
}

async function waitForTaskDragReady(taskId){
 await page.waitForFunction(id=>{
  const handle=document.querySelector('[data-task-id="'+CSS.escape(id)+'"] [data-task-drag]');
  return Boolean(handle&&!handle.disabled&&handle.getAttribute('draggable')==='true');
 },taskId,{timeout:12000});
}

async function installTaskDragDiagnostics(){
 await page.evaluate(()=>{
  if(window.__taskDragDiagnosticsInstalled)return;
  window.__taskDragDiagnosticsInstalled=true;
  window.__taskDragEvents=[];
  for(const type of ['dragstart','dragenter','dragover','dragleave','drop','dragend']){
   document.addEventListener(type,event=>{
    const target=event.target instanceof Element?event.target:null;
    const task=target?.closest('[data-task-id]'),column=target?.closest('[data-task-column]');
    let taskId=null;
    try{taskId=event.dataTransfer?.getData('application/x-recalloom-task')||null;}catch{}
    if(window.__taskDragEvents.length<120)window.__taskDragEvents.push({
     type,trusted:event.isTrusted,targetTag:target?.tagName??null,
     targetClass:typeof target?.className==='string'?target.className:null,
     taskId:task?.getAttribute('data-task-id')??null,
     taskStatus:task?.getAttribute('data-task-status')??null,
     column:column?.getAttribute('data-task-column')??null,
     handleDisabled:task?.querySelector('[data-task-drag]')?.disabled??null,
     handleDraggable:task?.querySelector('[data-task-drag]')?.getAttribute('draggable')??null,
     defaultPrevented:event.defaultPrevented,dropEffect:event.dataTransfer?.dropEffect??null,
     types:event.dataTransfer?[...event.dataTransfer.types]:[],data:taskId
    });
   },true);
  }
 });
}

async function taskDragDiagnostic(taskId){
 return page.evaluate(id=>{
  const task=document.querySelector('[data-task-id="'+CSS.escape(id)+'"]');
  const handle=task?.querySelector('[data-task-drag]');
  const element=document.elementFromPoint(innerWidth*.62,innerHeight*.5);
  const hitTask=element?.closest('[data-task-id]'),hitColumn=element?.closest('[data-task-column]');
  return {
   source:{status:task?.getAttribute('data-task-status'),recordId:task?.getAttribute('data-task-record-id'),
    disabled:handle?.disabled??null,draggable:handle?.getAttribute('draggable')??null},
   hit:{tag:element?.tagName??null,className:typeof element?.className==='string'?element.className:null,
    taskId:hitTask?.getAttribute('data-task-id')??null,status:hitTask?.getAttribute('data-task-status')??null,
    column:hitColumn?.getAttribute('data-task-column')??null},
   events:window.__taskDragEvents??[]
  };
 },taskId);
}

async function dragTask(taskId,target,{xRatio=.5,yRatio=.5}={}){
 const handle=page.locator('[data-task-id="'+taskId+'"]').locator('[data-task-drag]').first();
 await handle.scrollIntoViewIfNeeded();
 await target.scrollIntoViewIfNeeded();
 await waitForTaskDragReady(taskId);
 const destination=await target.boundingBox();
 assert.ok(destination,'Drag destination is visible');
 await installTaskDragDiagnostics();
 await page.evaluate(()=>{window.__taskDragEvents=[];});
 const mutation=page.waitForResponse(candidate=>new URL(candidate.url()).pathname==='/api/tasks/mutate'&&
  candidate.request().method()==='POST',{timeout:8000}).then(async response=>{
   await response.finished();
   return response;
  }).catch(()=>null);
 await handle.dragTo(target,{targetPosition:{x:destination.width*xRatio,y:destination.height*yRatio}});
 const response=await mutation;
 if(!response){
  throw Error('Task drag submitted no mutation: '+JSON.stringify(await taskDragDiagnostic(taskId)));
 }
 if(!response.ok()){
  const body=await response.clone().json().catch(()=>null);
  throw Error('Task drag mutation failed ('+response.status()+'): '+JSON.stringify(body));
 }
 await response.finished();
 await response.json();
}

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');

 // Main groups stay alphabetically ahead of empty groups while recent task
 // writes also make the five populated lists the newest task-list records.
 const mainLists=await Promise.all(statuses.map(status=>createList('TW '+runId+' 00 '+status)));
 const emptyLists=[];
 for(let index=1;index<=40;index++)emptyLists.push(await createList('TW '+runId+' 90 empty '+String(index).padStart(2,'0')));
 fixtureLists.push(...mainLists,...emptyLists);
 const groups=await Promise.all(statuses.map(async(status,index)=>{
  const seeded=await seedList(mainLists[index],status,45);
  return {status,list:mainLists[index],items:seeded.items,revision:seeded.revision};
 }));
 const totalFixtureTasks=groups.flatMap(group=>group.items);
 assert.equal(totalFixtureTasks.length,225);
 assert.equal(new Set(totalFixtureTasks.map(task=>task.id)).size,225,'Fixture task IDs are unique');

 // Put the todo deep-link target beyond the first 40-item task page.
 const todo=groups.find(group=>group.status==='todo');
 const deepLinkTask=todo.items.at(-1);
 const reordered=await requireApi('/tasks/mutate','POST',{recordId:todo.list.id,action:'reorder',
  taskId:deepLinkTask.id,expectedRevision:todo.revision,beforeTaskId:null},200);
 todo.revision=reordered.revision;

 const listPages=await readPaged('/task-lists',{},40);
 assert.equal(listPages.pages[0].items.length,40,'The first task-list metadata page is capped at 40');
 assert.equal(listPages.pages[0].page.hasMore,true,'Task-list metadata exposes its continuation');
 assert.equal(listPages.items.length,45,'All task-list metadata pages return 45 lists');
 assert.equal(new Set(listPages.items.map(item=>item.id)).size,45,'Task-list pages contain no duplicates');
 for(const group of groups){
  const meta=listPages.items.find(item=>item.id===group.list.id);
  assert.ok(meta,'Populated task list appears in metadata pages');
  assert.equal(meta.total,45,'List metadata reports the exact task total');
  assert.equal(meta.counts[group.status],45,'List metadata reports the task status count');
  assert.equal(meta.counts[statuses.find(status=>status!==group.status)],0,'Other status count starts empty');
 }
 for(const status of statuses){
  const group=groups.find(item=>item.status===status);
  const filtered=await readPaged('/tasks/view',{recordId:group.list.id,statuses:status},40);
  assert.equal(filtered.pages[0].items.length,40,'Each status query starts with 40 tasks');
  assert.equal(filtered.pages[0].page.hasMore,true,'Each status column has its own continuation');
  assert.equal(filtered.items.length,45,'Each status query returns all 45 tasks');
  assertSameIds(filtered.items,group.items,'Paginated '+status+' results');
  assert.ok(filtered.items.every(item=>item.status===status&&item.list?.id===group.list.id),
   'Status filtering retains task-list metadata and scope');
  const searched=await readPaged('/tasks/view',{recordId:group.list.id,statuses:status,query:fixturePrefix+status},40);
  assert.equal(searched.items.length,45,'Server-side search covers the full matching task range');
  assertSameIds(searched.items,group.items,'Server search '+status+' results');
 }
 const taskRead=await requireApi('/tasks/'+deepLinkTask.id);
 assert.equal(taskRead.item.id,deepLinkTask.id);
 assert.equal(taskRead.item.list.id,todo.list.id,'Single-task reads include the owning list');
 assert.equal(taskRead.item.details,'Fixture detail '+deepLinkTask.title,'Single-task reads include task details');

 await page.goto(base+'/tasks');
 const workspace=page.locator('[data-task-workspace]');
 await workspace.waitFor();
 const viewGroup=page.getByRole('group',{name:'任务视图'});
 const boardMode=viewGroup.getByRole('button',{name:'看板',exact:true});
 const listMode=viewGroup.getByRole('button',{name:'列表',exact:true});
 await boardMode.waitFor();
 assert.equal(await viewGroup.evaluate(element=>getComputedStyle(element).outlineStyle),'solid',
  'The task mode selector has the same outlined treatment as document modes');
 const columns=page.locator('[data-task-column]');
 assert.equal(await columns.count(),5,'The board always exposes five fixed task statuses');

 // Multi-select defaults to all statuses, supports none, and survives a view
 // change without silently restoring or narrowing the selected state.
 await openStatusFilter();
 for(const status of statuses)
  assert.equal(await (await statusOption(status)).getAttribute('aria-selected'),'true',status+' is selected by default');
 for(const status of statuses)await (await statusOption(status)).click();
 for(const status of statuses)
  assert.equal(await (await statusOption(status)).getAttribute('aria-selected'),'false',status+' can be cleared');
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelectorAll('[data-task-column]').length===0);
 assert.equal(await columns.count(),0,'Zero selected statuses leave no task columns');
 await openStatusFilter();
 await (await statusOption('todo')).click();
 await page.keyboard.press('Escape');
 await listMode.click();
 await openStatusFilter();
 for(const status of statuses)
  assert.equal(await (await statusOption(status)).getAttribute('aria-selected'),status==='todo'?'true':'false',
   status+' selection is remembered in List view');
 await page.keyboard.press('Escape');
 await openStatusFilter();
 for(const status of statuses.filter(status=>status!=='todo'))await (await statusOption(status)).click();
 await page.keyboard.press('Escape');
 await openStatusFilter();
 for(const status of statuses)assert.equal(await (await statusOption(status)).getAttribute('aria-selected'),'true',
  status+' can be restored in List view');
 await page.keyboard.press('Escape');
 await boardMode.click();
 await openStatusFilter();
 for(const status of statuses)assert.equal(await (await statusOption(status)).getAttribute('aria-selected'),'true',
  status+' selection is remembered after returning to Board view');
 await page.keyboard.press('Escape');
 await listMode.click();
 const listScroll=page.locator('[data-task-list-scroll]');
 await listScroll.waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('[data-task-list-id]').length===40);
 const initialGroupIds=await page.locator('[data-task-list-id]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-task-list-id')));
 assert.equal(new Set(initialGroupIds).size,40,'First list view page has no duplicate groups');
 await scrollToEnd(listScroll);
 await page.waitForFunction(()=>document.querySelectorAll('[data-task-list-id]').length===45);
 const allGroupIds=await page.locator('[data-task-list-id]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-task-list-id')));
 assert.equal(new Set(allGroupIds).size,45,'Scrolling loads remaining list groups without duplicates');
 for(const group of groups){
  const listGroup=page.locator('[data-task-list-id="'+group.list.id+'"]');
  await listGroup.scrollIntoViewIfNeeded();
  await page.waitForFunction(id=>{
   const group=document.querySelector('[data-task-list-id="'+CSS.escape(id)+'"]');
   const count=group?.querySelectorAll('[data-task-id]').length??0;
   return count>=40&&count<=45;
  },group.list.id);
  // Follow the live sentinel: row heights can still be animating after the
  // first page appears, so a one-shot scroll to its last row stops too early.
  await page.waitForFunction(id=>{
   const group=document.querySelector('[data-task-list-id="'+CSS.escape(id)+'"]');
   const viewport=group?.closest('[data-task-list-scroll]'),sentinel=group?.querySelector('.tasks-load-more');
   if(viewport&&sentinel)viewport.scrollTop+=sentinel.getBoundingClientRect().bottom-viewport.getBoundingClientRect().bottom+30;
   return group?.querySelectorAll('[data-task-id]').length===45;
  },group.list.id).catch(async error=>{throw Error('List continuation failed: '+JSON.stringify(await listGroup.evaluate(element=>{
   const bounds=node=>node?.getBoundingClientRect().toJSON();
   const collapse=element.querySelector('.tasks-group-collapse'),viewport=element.closest('[data-task-list-scroll]');
   return {count:element.querySelectorAll('[data-task-id]').length,group:bounds(element),viewport:bounds(viewport),scrollTop:viewport?.scrollTop,collapse:bounds(collapse),collapseScroll:collapse?.scrollTop,sentinel:bounds(element.querySelector('.tasks-load-more'))};
  }))+' '+error.message);});
  const ids=await listGroup.locator('[data-task-id]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-task-id')));
  assertSameIds(ids.map(id=>({id})),group.items,'List group '+group.status+' continuation');
 }
 await listScroll.evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
 const animatedGroup=page.locator('[data-task-list-id="'+todo.list.id+'"]');
 await animatedGroup.scrollIntoViewIfNeeded();
 const progress=animatedGroup.getByRole('progressbar');
 assert.equal(await progress.getAttribute('aria-valuenow'),'0');
 assert.equal(await progress.getAttribute('aria-valuemax'),'45');
 assert.ok((await progress.boundingBox())?.width>20,'Grouped lists show a real progress bar next to creation');
 await animatedGroup.evaluate(element=>{
  const body=element.querySelector('.tasks-group-collapse');
  const icon=element.querySelector('.tasks-group-collapse-icon');
  window.__taskCollapseFrames=[];
  window.__taskCollapseRotationFrames=[];
  window.__taskCollapseIcon=icon;
  element.querySelector('button[aria-expanded]').addEventListener('click',()=>{
   const start=performance.now();
   const sample=()=>{
    if(!icon.isConnected)return;
    window.__taskCollapseFrames.push(body.getBoundingClientRect().height);
    const matrix=new DOMMatrix(getComputedStyle(icon).transform);
    window.__taskCollapseRotationFrames.push(Math.atan2(matrix.b,matrix.a)*180/Math.PI);
    if(performance.now()-start<900)requestAnimationFrame(sample);
   };
   sample();
  },{once:true});
 });
 await animatedGroup.getByRole('button',{name:'折叠'+todo.list.name,exact:true}).click();
 await page.waitForFunction(id=>window.__taskCollapseFrames?.length>3&&
  document.querySelector('[data-task-list-id="'+CSS.escape(id)+'"] .tasks-group-collapse')?.getBoundingClientRect().height<2,todo.list.id).catch(async error=>{
  throw Error('Collapse motion did not settle: '+JSON.stringify(await animatedGroup.evaluate(element=>({
   expanded:element.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded'),
   height:element.querySelector('.tasks-group-collapse')?.getBoundingClientRect().height,
   frames:window.__taskCollapseFrames
  })))+' '+error.message);
 });
 const collapseFrames=await page.evaluate(()=>window.__taskCollapseFrames);
 assert.ok(collapseFrames.some(height=>height>3&&height<collapseFrames[0]-3),
  'Collapsing a task group has intermediate height frames');
 const rotation=await animatedGroup.evaluate(element=>({frames:window.__taskCollapseRotationFrames,
  sameIcon:element.querySelector('.tasks-group-collapse-icon')===window.__taskCollapseIcon}));
 assert.ok(rotation.sameIcon,'Collapse preserves one icon element rather than replacing its content');
 assert.ok(rotation.frames.some(angle=>angle>1&&angle<89),'Collapse icon rotates through intermediate angles: '+JSON.stringify(rotation));
 await animatedGroup.getByRole('button',{name:'展开'+todo.list.name,exact:true}).click();
 await animatedGroup.locator('[data-task-id]').first().waitFor();
 await page.waitForFunction(id=>{
  const icon=document.querySelector('[data-task-list-id="'+CSS.escape(id)+'"] .tasks-group-collapse-icon');
  if(icon!==window.__taskCollapseIcon)return false;
  const matrix=new DOMMatrix(getComputedStyle(icon).transform);
  return Math.abs(Math.atan2(matrix.b,matrix.a)*180/Math.PI-90)<1;
 },todo.list.id);
 await page.screenshot({path:join(artifactDir,'list-light.png')});
 await boardMode.click();
 await openStatusFilter();
 for(const status of statuses)assert.equal(await (await statusOption(status)).getAttribute('aria-selected'),'true',status+' selection is remembered across views');
 await page.keyboard.press('Escape');
 for(const column of await columns.all())await waitForCount(column,40,'Initial '+await column.getAttribute('data-task-column')+' column');
 await page.screenshot({path:join(artifactDir,'board-light.png')});

 const createButton=page.locator('[data-task-workspace] > .page-header [data-task-create]');
 assert.equal(await createButton.count(),1,'One top-level task creation action exists');
 const createBounds=await createButton.boundingBox(),workspaceBounds=await workspace.boundingBox();
 assert.ok(createBounds&&workspaceBounds&&createBounds.y<workspaceBounds.y+140,
  'Task creation stays in the workspace header and has no repeated bottom action');
 assert.equal(await page.locator('[data-task-column-scroll] [data-task-create]').count(),0,
  'Task columns do not repeat creation actions at the bottom of their rows');
 for(const status of statuses){
  const column=page.locator('[data-task-column="'+status+'"]');
  const rows=column.locator('[data-task-id]');
  assert.equal(await rows.count(),40,'Initial '+status+' page renders 40 rows');
  const first=rows.first();
  assert.equal(await first.getAttribute('data-task-status'),status,'Cards expose their one status value');
  assert.equal(await first.getByRole('checkbox').count(),0,'A task card does not duplicate status as a checkbox');
  assert.ok(await first.locator('[data-task-source]').count()>0,'Cards show the source task list');
 }
 for(const status of statuses){
  const column=page.locator('[data-task-column="'+status+'"]');
  await scrollToEnd(column.locator('[data-task-column-scroll]'));
  await page.waitForFunction(status=>document.querySelector('[data-task-column="'+status+'"]').querySelectorAll('[data-task-id]').length===45,status);
  const ids=await column.locator('[data-task-id]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-task-id')));
  assertSameIds(ids.map(id=>({id})),groups.find(group=>group.status===status).items,'Board '+status+' auto continuation');
 }

 const searchHost=page.locator('[data-task-search]');
 const search=searchHost.getByRole('textbox');
 await search.fill(fixturePrefix);
 for(const status of statuses){
  const column=page.locator('[data-task-column="'+status+'"]');
  await page.waitForFunction(status=>document.querySelector('[data-task-column="'+status+'"]').querySelectorAll('[data-task-id]').length===40,status);
  await scrollToEnd(column.locator('[data-task-column-scroll]'));
  await page.waitForFunction(status=>document.querySelector('[data-task-column="'+status+'"]').querySelectorAll('[data-task-id]').length===45,status);
 }
 const searchedIds=await page.locator('[data-task-column] [data-task-id]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-task-id')));
 assert.equal(new Set(searchedIds).size,225,'Server search pagination has no duplicate tasks across columns');
 assert.deepEqual([...searchedIds].sort(),totalFixtureTasks.map(task=>task.id).sort(),
  'Search returns all matching tasks and excludes unrelated records');
 await search.fill('no-match-'+runId);
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-task-column]')].every(column=>column.querySelectorAll('[data-task-id]').length===0));
 await search.fill('');
 for(const status of statuses)await page.locator('[data-task-column="'+status+'"] [data-task-id]').first().waitFor();

 // Existing task data renders before the exact lookup completes. Simulate a
 // metadata-only cached row so that only the details area waits for its body.
 const editTask=todo.items[2];
 const metadataRoute='**/api/tasks/view?**';
 const metadataOnly=async route=>{
  const request=route.request();
  const response=await route.fetch({headers:{...(await request.allHeaders()),...(sessionCookie?{cookie:sessionCookie}:{})}});
  const data=await response.json();
  for(const item of data.items??[])if(item.id===editTask.id)delete item.details;
  await route.fulfill({response,json:data});
 };
 await page.route(metadataRoute,metadataOnly);
 await page.reload();
 let releaseDetails;
 const detailsGate=new Promise(resolve=>{releaseDetails=resolve;});
 const exactRoute='**/api/tasks/'+editTask.id;
 const delayedDetails=async route=>{await detailsGate;await route.fallback();};
 await page.route(exactRoute,delayedDetails);
 const editRow=page.locator('[data-task-id="'+editTask.id+'"]');
 await editRow.locator('[data-task-edit]').click();
 const editor=page.locator('#task-editor-'+editTask.id);
 await editor.waitFor();
 const earlyTitle=editor.getByRole('textbox',{name:'任务标题'});
 assert.equal(await earlyTitle.inputValue(),editTask.title,'Known title appears during details loading');
 assert.equal(await earlyTitle.isEnabled(),true,'Metadata remains editable during details loading');
 assert.equal(await editor.getByRole('combobox',{name:'任务状态'}).isEnabled(),true);
 await editor.getByText('正在加载任务详情…',{exact:true}).waitFor();
 const hydrationTitle=fixturePrefix+'typed_while_loading';
 await earlyTitle.fill(hydrationTitle);
 releaseDetails();
 await waitForInputValues([{locator:editor.getByRole('textbox',{name:'任务详情'}),expected:'Fixture detail '+editTask.title}]);
 assert.equal(await earlyTitle.inputValue(),hydrationTitle,'Detail hydration preserves local title edits');
 await page.unroute(exactRoute,delayedDetails);
 await page.unroute(metadataRoute,metadataOnly);
 // A second task owns a separate panel; opening and closing it preserves the first draft.
 const secondTask=todo.items[5];
 await page.locator('[data-task-id="'+secondTask.id+'"] [data-task-edit]').click();
 const secondEditor=page.locator('#task-editor-'+secondTask.id);
 await secondEditor.getByRole('textbox',{name:'任务标题'}).waitFor();
 assert.equal(await page.locator('[data-task-editor]').count(),2,'Two tasks have independent editor panels');
 assert.equal(await earlyTitle.inputValue(),hydrationTitle,'Opening another task retains the original draft');
 await secondEditor.getByRole('textbox',{name:'任务标题'}).fill(fixturePrefix+'second_draft');
 await secondEditor.getByRole('button',{name:'折叠任务详情',exact:true}).click();
 await page.waitForFunction(id=>document.getElementById(id)?.hasAttribute('data-collapsed'),'task-editor-'+secondTask.id);
 await page.locator('[data-task-id="'+secondTask.id+'"] [data-task-edit]').click();
 await page.waitForFunction(id=>!document.getElementById(id)?.hasAttribute('data-collapsed'),'task-editor-'+secondTask.id);
 assert.equal(await secondEditor.getByRole('textbox',{name:'任务标题'}).isVisible(),true,'Reopening an existing task reveals its collapsed panel');
 assert.equal(await page.locator('[data-task-editor]').count(),2,'Reopening a task reuses its own panel');
 await page.getByRole('link',{name:'概览',exact:true}).click();
 const leaveDialog=page.getByRole('alertdialog',{name:'放弃未保存的任务更改？'});
 await leaveDialog.waitFor();
 assert.equal(await page.getByRole('alertdialog').count(),1,'Multiple task drafts share one navigation confirmation');
 await leaveDialog.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal(await earlyTitle.inputValue(),hydrationTitle,'Cancelling navigation retains the first draft');
 assert.equal(await secondEditor.getByRole('textbox',{name:'任务标题'}).inputValue(),fixturePrefix+'second_draft');
 await secondEditor.getByRole('button',{name:'关闭',exact:true}).click();
 const closeDialog=page.getByRole('alertdialog',{name:'放弃未保存的更改？'});
 await closeDialog.waitFor();
 await closeDialog.getByRole('button',{name:'放弃更改',exact:true}).click();
 await secondEditor.waitFor({state:'hidden'});
 assert.equal(await earlyTitle.inputValue(),hydrationTitle,'Closing another panel retains the first draft');
 const desktopGeometry=await page.evaluate(()=>{
  const panel=document.querySelector('[id^="task-editor-"]'),main=document.querySelector('.workspace>.main-content');
  const p=panel?.getBoundingClientRect(),m=main?.getBoundingClientRect();
  return {panel:p?{x:p.x,right:p.right,width:p.width}:null,main:m?{x:m.x,width:m.width}:null,
   mainPaddingInlineEnd:main?getComputedStyle(main).paddingInlineEnd:null,
   modal:Boolean(panel?.closest('dialog')?.matches(':modal'))};
 });
 assert.ok(desktopGeometry.panel&&desktopGeometry.main&&!desktopGeometry.modal&&
  Number.parseFloat(desktopGeometry.mainPaddingInlineEnd)===0,
  'Desktop task editor is a nonmodal docked panel: '+JSON.stringify(desktopGeometry));
 await page.screenshot({path:join(artifactDir,'drawer-light.png')});
 const title=editor.getByRole('textbox',{name:'任务标题'});
 const details=editor.getByRole('textbox',{name:'任务详情'});
 const taskStatus=editor.getByRole('combobox',{name:'任务状态'});
 const savedTitle=fixturePrefix+'saved_title';
 const savedDetails=fixturePrefix+'saved_detail';
 await title.fill(savedTitle);await details.fill(savedDetails);
 await taskStatus.click();
 await page.getByRole('option',{name:statusNames.blocked}).click();
 let failedUpdatedReads=0;
 const updatedReadOutage=async route=>{
  failedUpdatedReads++;
  await route.fulfill({status:503,json:{error:'Temporary task details outage'}});
 };
 await page.route(exactRoute,updatedReadOutage);
 await clickTaskMutation(editor.getByRole('button',{name:'保存更改',exact:true}));
 await editor.getByText('已保存',{exact:true}).waitFor();
 assert.ok(failedUpdatedReads>0,'The saved task has an unavailable background detail lookup');
 assert.equal(await editor.getByRole('button',{name:'保存更改',exact:true}).isDisabled(),true,
  'A successful mutation clears the draft even when its detail refresh fails');
 await title.fill(savedTitle+' ');
 assert.equal(await editor.getByRole('button',{name:'保存更改',exact:true}).isDisabled(),true,
  'Whitespace alone does not leave a task permanently dirty');
 await page.unroute(exactRoute,updatedReadOutage);
 const saved=await requireApi('/tasks/'+editTask.id);
 assert.equal(saved.item.title,savedTitle,'Task title persists after save');
 assert.equal(saved.item.details,savedDetails,'Task details persist after save');
 assert.equal(saved.item.status,'blocked','Task status persists after save');

 // A stale task-list revision must leave the local edit in the drawer until
 // the user explicitly confirms loading the newer server state.
 await editor.getByRole('button',{name:'关闭',exact:true}).click();
 const conflictTask=todo.items[3];
 const conflictRow=page.locator('[data-task-id="'+conflictTask.id+'"]');
 await conflictRow.locator('[data-task-edit]').click();
 const conflictEditor=page.locator('#task-editor-'+conflictTask.id);
 await conflictEditor.waitFor();
 const conflictBase=await requireApi('/tasks/'+conflictTask.id);
 const localTitle=fixturePrefix+'local_conflict_draft';
 const localDetails=fixturePrefix+'local_conflict_details';
 await conflictEditor.getByRole('textbox',{name:'任务标题'}).fill(localTitle);
 await conflictEditor.getByRole('textbox',{name:'任务详情'}).fill(localDetails);
 await conflictEditor.getByRole('combobox',{name:'任务状态'}).click();
 await page.getByRole('option',{name:statusNames.done}).click();
 const remoteDetails=fixturePrefix+'remote_revision';
 await requireApi('/tasks/mutate','POST',{recordId:todo.list.id,action:'update',taskId:conflictTask.id,
  expectedRevision:conflictBase.item.list.revision,changes:{details:remoteDetails}});
 await clickTaskMutation(conflictEditor.getByRole('button',{name:'保存更改',exact:true}),409);
 const reloadLatest=conflictEditor.getByRole('button',{name:'重新载入最新内容',exact:true});
 await reloadLatest.waitFor();
 assert.equal(await conflictEditor.getByRole('textbox',{name:'任务标题'}).inputValue(),localTitle,
  'Revision conflict retains the unsaved title');
 assert.equal(await conflictEditor.getByRole('textbox',{name:'任务详情'}).inputValue(),localDetails,
  'Revision conflict retains the unsaved details');
 await reloadLatest.click();
 const discardDialog=page.getByRole('alertdialog',{name:'放弃未保存的更改？'});
 await discardDialog.waitFor();
 await discardDialog.getByRole('button',{name:'重新载入',exact:true}).click();
 const reloadedTitle=conflictEditor.getByRole('textbox',{name:'任务标题'});
 const reloadedDetails=conflictEditor.getByRole('textbox',{name:'任务详情'});
 await waitForInputValues([{locator:reloadedTitle,expected:conflictTask.title},{locator:reloadedDetails,expected:remoteDetails}]);
 assert.equal(await reloadedTitle.inputValue(),conflictTask.title,
  'Confirmed reload uses the current server title');
 assert.equal(await reloadedDetails.inputValue(),remoteDetails,
  'Confirmed reload uses the current server details');
 await conflictEditor.getByRole('button',{name:'关闭',exact:true}).click();

 // Create from the single header action, then delete through the same editor.
 await createButton.click();
 let createEditor=page.locator('[id^="task-editor-new-"]:has([data-task-editor])');
 await createEditor.waitFor();
 const createdTitle=fixturePrefix+'created_then_deleted';
 await createEditor.getByRole('textbox',{name:'任务标题'}).fill(createdTitle);
 await createEditor.getByRole('textbox',{name:'任务详情'}).fill('Temporary editor-created task');
 const listSelect=createEditor.getByRole('button',{name:'所属任务列表'});
 await listSelect.click();
 await page.getByRole('option').filter({hasText:todo.list.name}).first().click();
 let failedCreatedReads=0;
 const createdReadRoute='**/api/tasks/*';
 const failCreatedRead=async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()!=='GET'||path==='/api/tasks/view'){await route.fallback();return;}
  const response=await route.fetch({headers:{...(await request.allHeaders()),...(sessionCookie?{cookie:sessionCookie}:{})}});
  const data=await response.json();
  if(data.item?.title===createdTitle){
   failedCreatedReads++;
   await route.fulfill({status:503,json:{error:'Temporary task details outage'}});return;
  }
  await route.fulfill({response,json:data});
 };
 await page.route(createdReadRoute,failCreatedRead);
 await clickTaskMutation(createEditor.getByRole('button',{name:'创建任务',exact:true}));
 const createdSearch=await readPaged('/tasks/view',{recordId:todo.list.id,statuses:'todo',query:createdTitle},40);
 assert.equal(createdSearch.items.length,1,'Header creation persists a new task in the selected list');
 assert.equal(createdSearch.items[0].details,'Temporary editor-created task');
 const createdTaskId=createdSearch.items[0].id;
 createEditor=page.locator('#task-editor-'+createdTaskId);
 await createEditor.getByRole('button',{name:'删除任务',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('[id^="task-editor-new-"]:has([data-task-editor])').length===0);
 for(let attempt=0;attempt<100&&!failedCreatedReads;attempt++)await wait(50);
 assert.ok(failedCreatedReads>0,'A failed post-create task lookup does not leave a second creation form');
 assert.equal(await createEditor.getByRole('textbox',{name:'任务标题'}).inputValue(),createdTitle,'The created task remains editable when its detail lookup fails');
 await page.unroute(createdReadRoute,failCreatedRead);
 await createEditor.getByRole('button',{name:'删除任务',exact:true}).click();
 const deleteDialog=page.getByRole('alertdialog',{name:'删除这个任务？'});
 await deleteDialog.waitFor();
 await clickTaskMutation(deleteDialog.getByRole('button',{name:'删除任务',exact:true}));
 const deleted=await api('/tasks/'+createdTaskId);
 assert.equal(deleted.status,404,'Deleting from the task editor removes the task from storage');

 // Cross-column drag persists status. Every global, status, and record view is
 // a filtered subsequence of one total order and must preserve that relation.
 const crossStatusTask=todo.items[4];
 await dragTask(crossStatusTask.id,page.locator('[data-task-column="in_progress"]'));
 const movedStatus=await requireApi('/tasks/'+crossStatusTask.id);
 assert.equal(movedStatus.item.status,'in_progress','Cross-status drag writes the new status');
 assert.equal(movedStatus.item.recordId,todo.list.id,'Cross-status drag keeps the task in its source list');
 const sortSource=todo.items[1],sortBefore=todo.items[0];
 const allStatuses=statuses.join(','),globalBefore=(await readPaged('/tasks/view',{statuses:allStatuses,order:'board'},100)).items;
 const statusBefore=(await readPaged('/tasks/view',{statuses:'todo',order:'board'},100)).items;
 const recordBefore=(await readPaged('/tasks/view',{recordId:todo.list.id,statuses:allStatuses,order:'board'},100)).items;
 const globalIds=globalBefore.map(item=>item.id),statusSet=new Set(statusBefore.map(item=>item.id)),recordSet=new Set(recordBefore.map(item=>item.id));
 assert.deepEqual(statusBefore.map(item=>item.id),globalIds.filter(id=>statusSet.has(id)),'Todo board starts as a total-order subsequence');
 assert.deepEqual(recordBefore.map(item=>item.id),globalIds.filter(id=>recordSet.has(id)),'Record view starts as a total-order subsequence');
 assert.ok(globalIds.includes(sortSource.id)&&globalIds.includes(sortBefore.id),'Global total order contains both drag tasks');
 const expectedGlobal=globalIds.filter(id=>id!==sortSource.id);
 expectedGlobal.splice(expectedGlobal.indexOf(sortBefore.id),0,sortSource.id);
 const expectedStatus=expectedGlobal.filter(id=>statusSet.has(id)),expectedRecord=expectedGlobal.filter(id=>recordSet.has(id));
 await dragTask(sortSource.id,page.locator('[data-task-id="'+sortBefore.id+'"]'),{yRatio:.2});
 const globalAfter=(await readPaged('/tasks/view',{statuses:allStatuses,order:'board'},100)).items.map(item=>item.id);
 const statusAfter=(await readPaged('/tasks/view',{statuses:'todo',order:'board'},100)).items.map(item=>item.id);
 const recordAfter=(await readPaged('/tasks/view',{recordId:todo.list.id,statuses:allStatuses,order:'board'},100)).items.map(item=>item.id);
 assert.deepEqual(globalAfter,expectedGlobal,'Same-column drag persists the exact pointer rank in the shared total order');
 assert.deepEqual(statusAfter,expectedStatus,'Todo board remains the matching total-order subsequence');
 assert.deepEqual(recordAfter,expectedRecord,'Record view reflects the same persisted total order');

 // The 45th todo task is not in the first 40-item page, yet a task query opens
 // its editor directly. Home's first todo link must also carry an exact task ID.
 const firstTodoPage=await requireApi('/tasks/view?'+new URLSearchParams({recordId:todo.list.id,statuses:'todo',limit:'40'}));
 assert.equal(firstTodoPage.items.length,40);
 assert.ok(firstTodoPage.page.hasMore);
 assert.ok(!firstTodoPage.items.some(item=>item.id===deepLinkTask.id),'Deep-link target starts beyond page 40');
 await page.goto(base+'/records/'+todo.list.id+'?task='+deepLinkTask.id);
 const deepLinkEditor=page.locator('#task-editor-'+deepLinkTask.id);
 await deepLinkEditor.waitFor();
 assert.equal(await deepLinkEditor.getByRole('textbox',{name:'任务标题'}).inputValue(),deepLinkTask.title,
  'A deep-link focuses the exact task beyond the initial page');
 const compactHeader=page.locator('.task-list-workbench-header');
 const compactBounds=await compactHeader.boundingBox();
 assert.ok(compactBounds&&compactBounds.height<250,'Task record header uses the compact document layout');
 assert.equal(await compactHeader.locator('.properties,.page-icon').count(),0,'Task header has no expanded property table or large icon');
 // A repeated task search parameter is a fresh open request in the same page
 // instance, even after the previous request was consumed and its panel closed.
 await deepLinkEditor.locator('[data-task-source]').click();
 await page.waitForURL(url=>url.pathname==='/records/'+todo.list.id&&!url.searchParams.has('task'));
 await deepLinkEditor.getByRole('button',{name:'关闭',exact:true}).click();
 await deepLinkEditor.waitFor({state:'hidden'});
 await page.goBack();
 await page.waitForURL(url=>url.searchParams.get('task')===deepLinkTask.id);
 await deepLinkEditor.waitFor();
 assert.equal(await deepLinkEditor.getByRole('textbox',{name:'任务标题'}).inputValue(),deepLinkTask.title,
  'Returning to the same task deep-link reopens its closed panel');
 await deepLinkEditor.getByRole('button',{name:'关闭',exact:true}).click();
 await deepLinkEditor.waitFor({state:'hidden'});
 await assertTaskRecordLayout(1600);
 await page.setViewportSize({width:800,height:1100});
 await assertTaskRecordLayout(800);
 await page.setViewportSize({width:1600,height:1100});
 await page.goto(base+'/');
 const todoSection=page.locator('section').filter({has:page.getByRole('heading',{name:'未完成事项',exact:true})});
 const homeTodo=todoSection.locator('a[href*="task="]').first();
 await homeTodo.waitFor();
 const routeTransitionCount=await page.evaluate(()=>window.__taskViewTransitions?.length??0);
 await homeTodo.click();
 await page.waitForURL(url=>url.pathname.startsWith('/records/')&&url.searchParams.has('task'));
 await waitForViewTransitionsSince(routeTransitionCount);
 const homeTaskId=new URL(page.url()).searchParams.get('task');
 assert.ok(homeTaskId,'Home todo navigation carries the task ID');
 const homeTaskEditor=page.locator('#task-editor-'+homeTaskId);
 await homeTaskEditor.waitFor();
 await waitForDockedPanelSettled('task-editor-'+homeTaskId);
 assert.equal(await homeTaskEditor.getByRole('textbox',{name:'任务标题'}).inputValue(),
  (await requireApi('/tasks/'+homeTaskId)).item.title,'Home opens the linked task editor');
 await page.setViewportSize({width:390,height:900});
 await waitForTaskEditorViewport(true,390);
 const homeSheet=await homeTaskEditor.evaluate(element=>{
  const rect=element.getBoundingClientRect(),dialog=element.closest('dialog');
  return {x:rect.x,width:rect.width,modal:Boolean(dialog?.matches(':modal'))};
 });
 assert.ok(homeSheet.modal&&Math.abs(homeSheet.x)<2&&homeSheet.width>=388,
  'Home task drawer becomes a mobile BottomSheet after resize: '+JSON.stringify(homeSheet));
 await page.setViewportSize({width:1600,height:1100});
 await waitForTaskEditorViewport(false,1600);
 assert.ok(await homeTaskEditor.isVisible(),'Home task drawer stays open when resizing back to desktop');
 assert.equal(await homeTaskEditor.getByRole('textbox',{name:'任务标题'}).inputValue(),
  (await requireApi('/tasks/'+homeTaskId)).item.title,'Resizing preserves the open task draft');
 assert.equal(await homeTaskEditor.evaluate(element=>Boolean(element.closest('dialog')?.matches(':modal'))),false,
  'Resized desktop task drawer is nonmodal');
 await page.setViewportSize({width:390,height:900});
 await waitForTaskEditorViewport(true,390);
 await homeTaskEditor.getByRole('button',{name:'关闭',exact:true}).click();

 // Native BottomSheet and edge fades remain usable on compact screens without
 // causing document-level horizontal overflow.
 for(const [width,height] of [[390,engine==='webkit'?900:844],[320,engine==='webkit'?900:740]]){
  await page.setViewportSize({width,height});
  await page.goto(base+'/tasks');
  await workspace.waitFor();
  const pageWidth=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(pageWidth.scrollWidth<=pageWidth.viewport+1,'No page overflow at '+width+'px: '+JSON.stringify(pageWidth));
  const horizontalFade=page.locator('[data-task-scroll-fade="horizontal"]');
  const verticalFade=page.locator('[data-task-scroll-fade="vertical"]');
  await horizontalFade.first().waitFor();await verticalFade.first().waitFor();
  assert.ok(await horizontalFade.first().getAttribute('data-edge-end')!==null,
   'Horizontal fade indicates more content to the right at '+width+'px');
  await scrollToEnd(horizontalFade.first(),'horizontal');
  await page.waitForFunction(()=>{
   const host=document.querySelector('[data-task-scroll-fade="horizontal"]');
   return host?.hasAttribute('data-edge-start')&&!host.hasAttribute('data-edge-end');
  });
  const visibleStatus=await verticalFade.evaluateAll(elements=>{
   const board=document.querySelector('[data-task-scroll-fade="horizontal"] > .tasks-board-viewport');
   const bounds=board?.getBoundingClientRect();
   if(!bounds)return null;
   const match=elements.map(element=>{
    const column=element.closest('[data-task-column]'),rect=column?.getBoundingClientRect();
    const overlap=rect?Math.max(0,Math.min(rect.right,bounds.right)-Math.max(rect.left,bounds.left)):0;
    return {status:column?.getAttribute('data-task-column')??null,overlap};
   }).sort((a,b)=>b.overlap-a.overlap)[0];
   return match&&match.overlap>0?match.status:null;
  });
  assert.ok(visibleStatus,'Horizontal end exposes a task column at '+width+'px');
  const verticalHost=page.locator('[data-task-column="'+visibleStatus+'"] [data-task-scroll-fade="vertical"]');
  await page.waitForFunction(status=>{
   const host=document.querySelector('[data-task-column="'+CSS.escape(status)+'"] [data-task-scroll-fade="vertical"]');
   const viewport=host?.querySelector('[data-task-column-scroll]');
   return Boolean(viewport?.querySelector('[data-task-id]')&&viewport.scrollHeight>viewport.clientHeight+2);
  },visibleStatus,{timeout:20000}).catch(async error=>{
   const metrics=await verticalHost.evaluate(element=>{
    const viewport=element.querySelector('[data-task-column-scroll]');
    return {cards:viewport?.querySelectorAll('[data-task-id]').length??0,clientHeight:viewport?.clientHeight??0,
     scrollHeight:viewport?.scrollHeight??0,column:element.closest('[data-task-column]')?.getBoundingClientRect().toJSON()};
   });
   throw Error('Visible vertical scroller was not ready at '+width+'px: '+JSON.stringify(metrics)+': '+error.message);
  });
  await scrollToEnd(verticalHost,'vertical');
  await page.waitForFunction(status=>{
   const host=document.querySelector('[data-task-column="'+CSS.escape(status)+'"] [data-task-scroll-fade="vertical"]');
   return host?.hasAttribute('data-edge-start');
  },visibleStatus);
  await verticalHost.evaluate(element=>{
   const scrollers=[element,...element.querySelectorAll('*')].filter(node=>node.scrollHeight>node.clientHeight+2)
    .sort((a,b)=>b.scrollHeight-a.scrollHeight);
   const target=scrollers[0]??element;target.scrollTop=0;target.dispatchEvent(new Event('scroll',{bubbles:true}));
  });
  await page.waitForFunction(status=>{
   const host=document.querySelector('[data-task-column="'+CSS.escape(status)+'"] [data-task-scroll-fade="vertical"]');
   return !host?.hasAttribute('data-edge-start')&&host?.hasAttribute('data-edge-end');
  },visibleStatus);
  const taskRow=page.locator('[data-task-column="todo"] [data-task-id]').first();
  await taskRow.locator('[data-task-edit]').click();
  const mobileEditor=page.locator('[id^="task-editor-"]:has([data-task-editor])');
  await mobileEditor.waitFor();
  await page.waitForFunction(()=>{
   const content=document.querySelector('[data-task-editor]'),host=content?.closest('dialog')??content;
   return host&&!host.getAnimations({subtree:true}).some(animation=>animation.playState==='running'||animation.playState==='pending');
  });
  await page.screenshot({path:join(artifactDir,'mobile-'+width+'-light.png')});
  const sheet=await mobileEditor.evaluate(element=>{
   const rect=element.getBoundingClientRect(),dialog=element.closest('dialog');
   return {x:rect.x,width:rect.width,height:rect.height,modal:Boolean(dialog?.matches(':modal')),host:dialog?.className??''};
  });
  assert.ok(sheet.modal&&Math.abs(sheet.x)<2&&sheet.width>=width-2,
   'Mobile task editor uses a full-width native BottomSheet at '+width+'px: '+JSON.stringify(sheet));
  const noOverflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(noOverflow.scrollWidth<=noOverflow.viewport+1,'Task editor does not overflow at '+width+'px');
  await mobileEditor.getByRole('button',{name:'关闭',exact:true}).click();
  await mobileEditor.waitFor({state:'hidden'});
  await page.goto(base+'/records/'+todo.list.id);
  await assertTaskRecordLayout(width);
 }

 assert.deepEqual(faults,[],'Browser runtime errors');
 console.log('PASS task workspace: 225 tasks, 45 task lists, independent paging, filters, editor, order and mobile',engine,
  'screenshots:',artifactDir);
}catch(error){
 const failureScreenshot=join(artifactDir,'failure.png');
 await page.screenshot({path:failureScreenshot,fullPage:true}).catch(()=>undefined);
 console.error('Task workspace regression failed',JSON.stringify({engine,url:page.url(),faults,lifecycle,
  lists:fixtureLists.map(list=>({id:list.id,name:list.name})),artifactDir,failureScreenshot,
  visible:await page.locator('body').innerText().then(text=>text.slice(0,1800)).catch(()=>null)}));
 throw error;
}finally{
 await browser.close();
}
