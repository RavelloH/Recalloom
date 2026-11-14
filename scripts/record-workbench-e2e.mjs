import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright-core';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executablePath=engine==='chromium'&&[
 process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(value=>value&&existsSync(value));
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok((engine==='webkit'||executablePath)&&secret,'Isolated browser and local secret required');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Only temporary local Worker is permitted');
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executablePath?{executablePath}:{})});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
// Windows WebKit exits on height changes after dismissing a native sheet.
// Keep its width/motion matrix at a fixed height; Chromium also exercises
// the shorter phone viewports. Both still cover the 320px/390px sheet widths.
const mobileHeight=engine==='webkit'?900:844;
const narrowHeight=engine==='webkit'?900:740;
page.setDefaultTimeout(25000);
const errors=[];
const lazyPanelRequests=[];
page.on('pageerror',error=>errors.push(error.message));
const motionSamples=[];
const motionDiagnosticPath=join('tmp','workbench-inspector-motion-'+engine+'-'+Date.now()+'.json');

await page.addInitScript(()=>{
 window.__workbenchInspectorMotion=[];
 window.__workbenchInspectorSessions=[];
 window.__workbenchMotionSession=null;
 const panelFor=()=>{
  const inspector=document.querySelector('.workbench-inspector');
  if(!inspector)return null;
  const host=inspector.closest('[data-workspace-panel]')||inspector.closest('dialog')||inspector;
  return {host,target:host.querySelector('.astryx-bottom-sheet')||host};
 };
 const rectOf=element=>{
  const rect=element.getBoundingClientRect();
  return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
 };
 const translationOf=transform=>{
  if(!transform||transform==='none')return {x:0,y:0};
  const match=/^matrix(3d)?\(([^)]+)\)$/.exec(transform);
  if(!match)return null;
  const values=match[2].split(',').map(Number);
  return match[1]?{x:values[12],y:values[13]}:{x:values[4],y:values[5]};
 };
 const reachedEndpoint=(translation,opening)=>Boolean(translation&&
  (opening?Math.hypot(translation.x,translation.y)<=1:Math.hypot(translation.x,translation.y)>1));
 const frame=(session)=>{
  if(session.target&&session.host?.isConnected&&(session.host?.open||session.host?.matches('[data-workspace-panel]')||session.host?.matches(':modal')||session.host?.matches(':popover-open'))){
   const transform=getComputedStyle(session.target).transform;
   session.frames.push({time:performance.now(),target:session.target,host:session.host,
    transform,translation:translationOf(transform)});
  }
  if(session.endTime!==null){
   session.framesAfterEnd++;
   if(session.framesAfterEnd>=2){session.stopped=true;return;}
  }
  requestAnimationFrame(()=>frame(session));
 };
 document.addEventListener('click',event=>{
  const session=window.__workbenchMotionSession;
  if(!session||session.clickTime!==null)return;
  session.clickTime=performance.now();
  const button=event.target.closest('button,[role=menuitem]');
  const id=button?.getAttribute('aria-controls');
  const host=(id?document.getElementById(id):null)||event.target.closest('[data-workspace-panel],dialog');
  const panel=host?.querySelector('.workbench-inspector')?{host,target:host.querySelector('.astryx-bottom-sheet')||host}:panelFor();
  if(panel){session.host=panel.host;session.target=panel.target;}
  requestAnimationFrame(()=>frame(session));
 },true);
 const capture=event=>{
  if(event.propertyName!=='transform'||!(event.target instanceof Element))return;
  const dialog=event.target.closest('dialog');
  const host=dialog?.querySelector('.workbench-inspector')?dialog:event.target.closest('[data-workspace-panel]');
  if(!host?.querySelector('.workbench-inspector'))return;
  const nativePanel=event.target===host||event.target.classList.contains('astryx-bottom-sheet');
  if(!nativePanel)return;
  const transition=event.target.getAnimations().find(animation=>animation.transitionProperty==='transform');
  const session=window.__workbenchMotionSession;
  if(session&&session.clickTime!==null&&!session.target){session.host=host;session.target=event.target;}
  const record={
   phase:event.type,time:performance.now(),propertyName:event.propertyName,target:event.target,host,nativePanel,
   pseudoElement:event.pseudoElement||'',
   targetTag:event.target.tagName,targetClass:typeof event.target.className==='string'?event.target.className:'',
   transform:getComputedStyle(event.target).transform,
   keyframes:transition?.effect?.getKeyframes().map(frame=>frame.transform).filter(value=>typeof value==='string')??[],
   rect:rectOf(event.target)
  };
  record.translation=translationOf(record.transform);
  window.__workbenchInspectorMotion.push(record);
  if(session&&session.clickTime!==null){
   session.events.push(record);
   const matchingRun=[...session.events].reverse().find(item=>item.phase==='transitionrun'&&
    item.propertyName==='transform'&&item.target===event.target&&!item.pseudoElement);
   if(event.type==='transitionend'&&!record.pseudoElement&&matchingRun&&
    reachedEndpoint(record.translation,session.opening)){
    session.endTime=record.time;
    session.framesAfterEnd=0;
   }
  }
 };
 document.addEventListener('transitionrun',capture,true);
 document.addEventListener('transitionend',capture,true);
 const showModal=HTMLDialogElement.prototype.showModal;
 HTMLDialogElement.prototype.showModal=function(...args){
  const session=window.__workbenchMotionSession;
  const track=Boolean(this.querySelector('.workbench-inspector'))&&session&&session.clickTime!==null;
  if(track){
   session.showModalBefore=performance.now();
   session.host=this;
   session.target=this.querySelector('.astryx-bottom-sheet')||this;
  }
  const result=showModal.apply(this,args);
  if(track)session.showModalAfter=performance.now();
  return result;
 };
 const showPopover=HTMLElement.prototype.showPopover;
 if(showPopover)HTMLElement.prototype.showPopover=function(...args){
  const session=window.__workbenchMotionSession;
  const track=this.id.startsWith('document-panel-')&&session&&session.clickTime!==null;
  if(track){session.showModalBefore=performance.now();session.host=this;session.target=this.querySelector('.astryx-bottom-sheet')||this;}
  const result=showPopover.apply(this,args);
  if(track)session.showModalAfter=performance.now();
  return result;
 };
});

const resetMotionSamples=(label,opening)=>page.evaluate(({label,opening})=>{
 const session={label,opening,clickTime:null,showModalBefore:null,showModalAfter:null,endTime:null,host:null,target:null,
  framesAfterEnd:0,stopped:false,events:[],frames:[]};
 window.__workbenchMotionSession=session;
 window.__workbenchInspectorSessions.push(session);
},{label,opening});
const assertInspectorTransformMotion=async(label,viewport)=>{
 await page.waitForFunction(()=>{
  const session=window.__workbenchMotionSession;
  return session?.stopped===true;
 });
 const sample=await page.evaluate(()=>{
  const session=window.__workbenchMotionSession;
  const events=session?.events??[];
  const reachedEndpoint=translation=>Boolean(translation&&
   (session?.opening?Math.hypot(translation.x,translation.y)<=1:Math.hypot(translation.x,translation.y)>1));
  for(let index=0;index<events.length;index++){
   const start=events[index];
   if(start.phase!=='transitionrun'||start.propertyName!=='transform'||start.pseudoElement)continue;
   const end=events.slice(index+1).find(event=>event.phase==='transitionend'&&event.propertyName==='transform'&&
    event.target===start.target&&!event.pseudoElement&&reachedEndpoint(event.translation));
   if(end){
    const frames=session.frames.filter(frame=>frame.target===start.target&&frame.time>start.time&&frame.time<end.time);
    const startPoint=start.translation,endPoint=end.translation;
    const dx=endPoint&&startPoint?endPoint.x-startPoint.x:end.rect.x-start.rect.x;
    const dy=endPoint&&startPoint?endPoint.y-startPoint.y:end.rect.y-start.rect.y;
    const lengthSquared=dx*dx+dy*dy;
    const intermediateFrame=lengthSquared>1&&startPoint&&endPoint&&frames.some(frame=>{
     const framePoint=frame.translation;
     if(!framePoint)return false;
     const fx=framePoint.x-startPoint.x,fy=framePoint.y-startPoint.y;
     const along=(fx*dx+fy*dy)/lengthSquared;
     const offPath=Math.abs(dx*fy-dy*fx)/Math.sqrt(lengthSquared);
     return along>0.02&&along<0.98&&offPath<2;
    });
    return {targetTag:start.targetTag,targetClass:start.targetClass,sameHost:start.host===end.host,
    startTransform:start.transform,endTransform:end.transform,keyframes:start.keyframes,
    startRect:start.rect,endRect:end.rect,runTime:start.time,endTime:end.time,
    frameCount:session.frames.length,intermediateFrame};
   }
  }
  return null;
 });
 assert.ok(sample,'Inspector transform transition was not captured: '+label);
 assert.ok(sample.sameHost,'Inspector transition changed host: '+label+' '+JSON.stringify(sample));
 const docked=await page.locator('.workspace').getAttribute('data-panel-layout')==='docked';
 assert.ok(docked?sample.targetTag==='ASIDE'&&sample.targetClass.split(' ').includes('workspace-panel'):sample.targetClass.includes('astryx-bottom-sheet'),
  'Inspector transition must animate its '+(docked?'docked card':'BottomSheet panel')+': '+label+' '+JSON.stringify(sample));
 assert.ok(sample.keyframes.length>=2&&new Set(sample.keyframes).size>1,
  'Inspector transform must have distinct Web Animations API keyframes: '+label+' '+JSON.stringify(sample));
 assert.notEqual(sample.startTransform,sample.endTransform,
  'Inspector transform must visibly change over the transition: '+label+' '+JSON.stringify(sample));
 const travel=Math.hypot(sample.startRect.x-sample.endRect.x,sample.startRect.y-sample.endRect.y);
 assert.ok(travel>1,'Inspector panel must travel across frames: '+label+' '+JSON.stringify({travel,...sample}));
 assert.ok(sample.intermediateFrame,
  'Inspector must have a sampled animation frame between its start and end positions: '+label+' '+JSON.stringify(sample));
 motionSamples.push({label,engine,viewport,...sample});
 return sample;
};

const saveMotionDiagnostics=async()=>{
 mkdirSync('tmp',{recursive:true});
 const observed=await page.evaluate(()=>({events:window.__workbenchInspectorMotion?.map(event=>({phase:event.phase,
  time:event.time,propertyName:event.propertyName,targetTag:event.targetTag,targetClass:event.targetClass,transform:event.transform,
  keyframes:event.keyframes,rect:event.rect}))??[],sessions:window.__workbenchInspectorSessions?.map(session=>({label:session.label,
  clickTime:session.clickTime,showModalBefore:session.showModalBefore,showModalAfter:session.showModalAfter,
  endTime:session.endTime,stopped:session.stopped,events:session.events.map(event=>({phase:event.phase,time:event.time,
   targetTag:event.targetTag,targetClass:event.targetClass,transform:event.transform,rect:event.rect})),
  frames:session.frames.map(frame=>({time:frame.time,transform:frame.transform}))}))??[]})).catch(()=>({events:[],sessions:[]}));
 writeFileSync(motionDiagnosticPath,JSON.stringify({engine,samples:motionSamples,...observed},null,2));
};
let sessionCookie='';
try{
 await page.route('**/api/**',async route=>{
  const request=route.request();
  const url=new URL(request.url());
  if(/\/api\/records\/[^/]+\/(outline|relations|versions)$/.test(url.pathname))lazyPanelRequests.push(url.pathname);
  if(url.pathname.endsWith('/editors'))await new Promise(resolve=>setTimeout(resolve,1100));
  if(engine==='webkit'&&url.pathname==='/api/auth/login'){
   const response=await route.fetch();
   sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
   await route.fulfill({response});
   return;
  }
  if(engine==='webkit'&&sessionCookie){
   await route.fulfill({response:await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}})});
   return;
  }
  await route.continue();
 });
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 if(engine==='webkit')assert.ok(sessionCookie,'WebKit loopback login cookie must be bridged');
 await page.goto(base+'/library');
 // The editor-author query is independent of the record timestamp. Delay it
 // to prove that no separator, dash or author label leaks during loading.
 const name='Knowledge Workbench '+Date.now();
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill(name);
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.waitForURL(/\/records\//);
 const header=page.locator('.record-page.workbench-document .workbench-header');
 await header.getByRole('heading',{name}).waitFor();
 assert.equal(await header.locator('.page-icon').count(),0,'Document header must not use Notion-like oversized icon');
 assert.equal(await header.locator('.page-properties').count(),0,'Full property table should not be permanently visible');
 await header.getByText('Markdown 文档').waitFor();
 await header.getByText('R1',{exact:true}).waitFor();
 assert.ok((await page.locator('.crumbs').innerText()).includes(name),'Keep the file hierarchy in the global breadcrumb');
 assert.equal(await header.locator('.workbench-editors').count(),0,'async editors must not show a loading placeholder');
 assert.equal(await header.locator('.workbench-meta-separator').count(),1,'loading editors must not leave a stray separator');
 await header.locator('.workbench-editors').getByText('本人（Web）').waitFor();
 assert.equal(await header.locator('.workbench-meta-separator').count(),2,'resolved editors gain their separator');
 assert.ok(await header.locator('.workbench-summary-resizer').count()>0,'metadata line must use AutoResizer');
 const metaLabels=await header.locator('.workbench-summary-details').innerText();
 assert.ok(metaLabels.indexOf(' 字')<metaLabels.indexOf('编辑者：'),'editor metadata should appear last');
 // All pages share one first-content baseline. At tablet widths editor
 // controls stay in the document flow BELOW the header, while breadcrumbs
 // stay in the anchored shell bar. Phones keep compact in-flow controls.
 for(const width of [390,768,820,1000,1280,1440]){
  await page.setViewportSize({width,height:900});
  await page.waitForTimeout(100);
  const geometry=await page.evaluate(()=>{
   const box=selector=>{const el=document.querySelector(selector);if(!el)return null;
    const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width};};
   return {header:box('.workbench-header'),topbar:box('.topbar'),
    actions:box('.editor-topline'),switcher:box('.editor-view-switcher'),
    insideTopbar:Boolean(document.querySelector('.topbar .editor-topline')),
    topbarPosition:getComputedStyle(document.querySelector('.topbar')).position};
  });
  const expectedTop=width<=720?52+20:width<=1000?92:96;
  assert.ok(Math.abs(geometry.header.top-expectedTop)<=2,
   'document header must align with the site-wide baseline: '+width+' '+JSON.stringify(geometry));
  if(width>720&&width<=1200){
   assert.equal(geometry.insideTopbar,false,'tablet editing toolbar must remain in flow');
   assert.ok(geometry.actions.top>=geometry.header.bottom,'tablet toolbar must not overlap sticky topbar or header');
   assert.equal(geometry.topbarPosition,'absolute','tablet breadcrumb shell stays anchored');
  }else if(width>1200){
   assert.equal(geometry.insideTopbar,true,'wide desktop actions stay in shell topbar');
  }else{
   assert.equal(geometry.insideTopbar,false);
   assert.ok(geometry.switcher.width<=244,'phone mode switcher must have a bounded natural width');
  }
  if(width===768||width===1280){
   const movement=await page.evaluate(async()=>{
    const viewport=document.querySelector('.main-scroll');
    const documentPage=document.querySelector('.record-page');
    const topbar=document.querySelector('.topbar');
    const header=document.querySelector('.workbench-header');
    const beforeBar=topbar.getBoundingClientRect().top;
    const beforeTitle=header.getBoundingClientRect().top;
    const original=documentPage.style.minHeight;
    documentPage.style.minHeight='1600px';
    viewport.scrollTop=80;
    await new Promise(requestAnimationFrame);
    const barTravel=topbar.getBoundingClientRect().top-beforeBar;
    const titleTravel=header.getBoundingClientRect().top-beforeTitle;
    viewport.scrollTop=0;documentPage.style.minHeight=original;
    await new Promise(requestAnimationFrame);
    return {barTravel,titleTravel};
   });
   assert.ok(Math.abs(movement.barTravel)<=1,'contentful topbar must stay anchored while scrolling: '+JSON.stringify(movement));
   assert.ok(Math.abs(movement.titleTravel+80)<=2,'document content must scroll independently: '+JSON.stringify(movement));
  }
 }
 await page.setViewportSize({width:1440,height:900});
 const inspector=page.locator('.workbench-inspector:visible');
 const waitForNativePanelClosed=()=>page.waitForFunction(()=>{
  const inspector=document.querySelector('.workbench-inspector');
  const host=inspector?.closest('[data-workspace-panel]')||inspector?.closest('dialog')||inspector;
  return !host||(!host.matches('[data-workspace-panel]')&&!host.open&&!host.matches(':modal')&&!host.matches(':popover-open'));
 });
 const openPanelWithMotion=async(trigger,label,viewport)=>{
  await resetMotionSamples(label,true);
  await trigger.click();
  await assertInspectorTransformMotion(label,viewport);
 };
 const closePanelWithMotion=async(label,viewport)=>{
  await resetMotionSamples(label,false);
  await inspector.locator('.panel-heading button').click();
  await assertInspectorTransformMotion(label,viewport);
  await waitForNativePanelClosed();
 };
 const closePanelWithEntryMotion=async(trigger,label,viewport)=>{
  await resetMotionSamples(label,false);
  await trigger.click();
  await assertInspectorTransformMotion(label,viewport);
  await waitForNativePanelClosed();
  assert.equal(await trigger.getAttribute('aria-expanded'),'false','Active toolbar entry closes its panel');
 };
 const infoTrigger=()=>page.getByRole('button',{name:'信息',exact:true});
 const outlineTrigger=()=>page.getByRole('button',{name:'目录',exact:true});
 const historyTrigger=()=>page.getByRole('button',{name:'历史',exact:true});
 const panelEntry=async name=>{
  const direct=page.getByRole('button',{name,exact:true});
  if(await direct.isVisible())return direct;
  await page.getByRole('button',{name:'更多操作',exact:true}).click();
  const entry=page.getByRole('menuitem',{name,exact:true});
  await entry.waitFor();
  return entry;
 };
 await infoTrigger().waitFor();
 await outlineTrigger().waitFor();
 await historyTrigger().waitFor();
 assert.equal(await infoTrigger().count(),1,'Information has one toolbar entry');
 assert.equal(await outlineTrigger().count(),1,'Outline has one toolbar entry');
 assert.equal(await historyTrigger().count(),1,'History has one toolbar entry');
 assert.deepEqual(lazyPanelRequests,[],'Outline, relations and history data remain unloaded until their panel opens');
 await openPanelWithMotion(header.getByRole('button',{name:'详细信息',exact:true}),'desktop header details open',1440);
 const verifyPropertyLayout=async()=>{
  const layout=await inspector.locator('.workbench-inspector-details .page-properties').evaluate(el=>({
   display:getComputedStyle(el).display,
   rows:[...el.querySelectorAll('.property-row')].map(row=>({
    label:row.querySelector('dt')?.getBoundingClientRect().toJSON(),
    value:row.querySelector('dd')?.getBoundingClientRect().toJSON()
   }))
  }));
  assert.equal(layout.display,'flex','Every property must receive its own row');
  assert.equal(layout.rows.length,9,'The filename is edited at the page title, not duplicated in the inspector');
  assert.ok(layout.rows.every(({label,value})=>label&&value&&label.right<=value.left+2),
   'Property values must not overlap labels: '+JSON.stringify(layout));
  return layout;
 };
 await verifyPropertyLayout();
 assert.equal(await inspector.getAttribute('data-document-panel'),'info');
 assert.equal(await inspector.getByRole('heading',{name:'信息',exact:true}).count(),1);
 assert.equal(await inspector.getByRole('tab').count(),0,'Document panel has direct entry points instead of an inner tab bar');
 assert.equal(await inspector.getByRole('textbox',{name:'文件名'}).count(),0,'Inspector must not duplicate the filename editor');
 await inspector.getByRole('button',{name:'添加标签'}).click();
 await inspector.getByRole('textbox',{name:'新标签'}).fill('Workbench');
 await page.keyboard.press('Enter');
 await header.getByText('workbench',{exact:true}).waitFor();
 const tagStyle=await header.locator('.workbench-summary-tag').first().evaluate(el=>{
  const swatch=document.createElement('span');swatch.style.background='var(--rk-canvas)';document.body.appendChild(swatch);
  const result={background:getComputedStyle(el).backgroundColor,canvas:getComputedStyle(swatch).backgroundColor,
   radius:parseFloat(getComputedStyle(el).borderTopLeftRadius),border:parseFloat(getComputedStyle(el).borderTopWidth)};
  swatch.remove();return result;
 });
 const channels=color=>{
  if(color.startsWith('color(srgb '))return color.slice('color(srgb '.length).split(/[ )/]/).filter(Boolean).slice(0,3).map(v=>Number(v)*255);
  return color.replace(/^rgba?\(/,'').split(',').slice(0,3).map(v=>parseFloat(v));
 };
 const contrast=Math.max(...channels(tagStyle.background).map((v,i)=>Math.abs(v-channels(tagStyle.canvas)[i])));
 assert.ok(tagStyle.background!=='rgba(0, 0, 0, 0)'&&tagStyle.radius>=6&&tagStyle.border>=1&&contrast>=10,
  'Tags must have a visibly distinct filled background: '+JSON.stringify({...tagStyle,contrast}));
 assert.equal(await header.locator('.workbench-tag-line').count(),1,'Tags should occupy their own optional row');
 assert.equal(await header.getByRole('button',{name:'详细信息',exact:true}).getAttribute('aria-expanded'),'true',
  'Header details entry opens the same information panel');
 assert.equal(await header.locator('.workbench-summary').evaluate(el=>getComputedStyle(el).display),'grid',
  'Document metadata leaves room for its details entry');
 assert.equal(await inspector.getByRole('region',{name:'文档关联'}).count(),1,'Relations are grouped under document information');
 assert.equal(await inspector.getByRole('textbox',{name:'查找文档'}).count(),0,'Relation search starts collapsed');
 await inspector.getByRole('button',{name:'语义相似',exact:true}).click();
 await inspector.locator('.relation-hint').waitFor();
 await inspector.getByRole('button',{name:'语义相似',exact:true}).click();
 await inspector.getByRole('button',{name:'添加关联',exact:true}).click();
 await inspector.getByRole('textbox',{name:'查找文档'}).waitFor();
 await inspector.getByRole('button',{name:'添加关联',exact:true}).click();
 assert.equal(await inspector.getByRole('textbox',{name:'查找文档'}).count(),0,'Relation search can collapse after use');
 const informationPanel=page.locator('.workbench-inspector[data-document-panel="info"]');
 await informationPanel.evaluate(element=>{window.__workbenchInformationPanel=element;});
 await outlineTrigger().click();
 const outlinePanel=page.locator('.workbench-inspector[data-document-panel="outline"]');
 await outlinePanel.getByText('暂无 Markdown 标题').waitFor();
 assert.equal(await informationPanel.isVisible(),true,'Opening the outline keeps desktop information visible');
 assert.equal(await informationPanel.evaluate(element=>element===window.__workbenchInformationPanel),true,
  'Opening another desktop panel preserves the information instance');
 await outlinePanel.getByRole('button',{name:'关闭',exact:true}).click();
 await outlinePanel.waitFor({state:'hidden'});
 assert.ok(lazyPanelRequests.some(path=>path.endsWith('/relations')),'Information loads document relations on demand');
 await closePanelWithEntryMotion(infoTrigger(),'desktop same-entry toggle close',1440);
 await openPanelWithMotion(outlineTrigger(),'desktop empty outline open',1440);
 assert.equal(await inspector.getAttribute('data-document-panel'),'outline');
 await inspector.getByText('暂无 Markdown 标题').waitFor();
 await closePanelWithMotion('desktop empty outline exit',1440);
 await openPanelWithMotion(historyTrigger(),
  'desktop history open',1440);
 assert.equal(await inspector.getAttribute('data-document-panel'),'history');
 assert.equal(await inspector.getByRole('heading',{name:'历史',exact:true}).count(),1);
 assert.equal(await inspector.getByRole('tab').count(),0,'History opens directly without a tab switch');
 await inspector.getByText('Revision 1').waitFor();
 assert.ok(lazyPanelRequests.some(path=>path.endsWith('/versions')),'History loads its revision list on demand');
 await closePanelWithMotion('desktop history exit',1440);
 await openPanelWithMotion(infoTrigger(),
  'desktop repeated info open',1440);
 assert.equal(await inspector.getAttribute('data-document-panel'),'info');
 await closePanelWithMotion('desktop repeated info exit',1440);
 await page.setViewportSize({width:820,height:900});
 await page.locator('.record-main .editor-view-switcher').waitFor();
 await page.locator('.topbar').getByRole('button',{name:'信息',exact:true}).waitFor();
 for(const trigger of [infoTrigger(),outlineTrigger(),historyTrigger()]){
  await trigger.waitFor({state:'visible'});
  assert.equal(await trigger.evaluate(element=>Boolean(element.closest('.topbar'))),true,
   'Tablet document panel entries remain in the topbar');
 }
 await infoTrigger().click();
 await inspector.waitFor();
 assert.equal(await inspector.evaluate(element=>Boolean(element.closest('dialog')&&element.closest('.workspace-panel-sheet'))),true,
  'Tablet workspace below docking width uses a native bottom sheet');
 for(const [trigger,panel] of [[outlineTrigger(),'outline'],[historyTrigger(),'history']]){
  await inspector.locator('.panel-heading button').click();
  await inspector.waitFor({state:'hidden'});
  await trigger.click();
  await page.waitForFunction(expected=>[...document.querySelectorAll('.workbench-inspector')].some(element=>
   element.dataset.documentPanel===expected&&element.getClientRects().length>0),panel);
  assert.equal(await page.locator('dialog[open]:has(.workspace-panel-sheet)').count(),1,'Tablet panel switching keeps one native sheet open');
 }
 await inspector.locator('.panel-heading button').click();
 await inspector.waitFor({state:'hidden'});
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'源码',exact:true}).click();
 const navigationFillers=Array.from({length:30},(_,index)=>`Navigation filler ${index+1}.`).join('\n\n');
 const repeatedHeadingContent='# Workbench heading\n\nVersioned content.\n\n## Repeated\n\nFirst section.\n\n'+
  navigationFillers+'\n\n## Repeated\n\nSecond section.';
 await page.locator('.cm-content').fill(repeatedHeadingContent);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await header.getByText('R2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'历史',exact:true}).click();
 await inspector.waitFor();
 await inspector.getByRole('heading',{name:'历史',exact:true}).waitFor();
 await inspector.getByText('Revision 1').waitFor();
 assert.equal(await page.getByRole('dialog',{name:'版本历史'}).count(),0,'Do not open a second, separate history drawer');
 const revision=inspector.locator('.history-row').filter({hasText:'Revision 1'});
 await revision.getByRole('button',{name:'比较'}).click();
 const comparison=page.getByRole('dialog',{name:'版本对比'});
 await comparison.locator('.revision-diff-block').first().waitFor();
 await comparison.getByRole('button',{name:'关闭版本对比'}).click();
 await comparison.waitFor({state:'hidden'});
 await inspector.getByRole('button',{name:'关闭'}).click();
 await inspector.waitFor({state:'hidden'});
 for(const [mode,button] of [['source','源码'],['visual','可视化'],['preview','预览']]){
  await page.getByRole('button',{name:button,exact:true}).click();
  await page.waitForFunction(expected=>document.querySelector('.editor-body')?.dataset.mode===expected,mode);
  await page.waitForFunction(expected=>expected==='source'?Boolean(document.querySelector('.cm-content')):
   expected==='visual'?Boolean(document.querySelector('.tiptap')):Boolean(document.querySelector('.markdown-preview')),mode);
  await outlineTrigger().click();
  await inspector.waitFor();
  const duplicateHeadings=inspector.getByRole('button',{name:'Repeated',exact:true});
  await duplicateHeadings.nth(1).waitFor();
  await inspector.locator('.outline-item[aria-current="location"]').waitFor();
  assert.equal(await inspector.locator('.outline-item small').count(),0,'Outline labels stay clean without source line numbers');
  if(mode==='visual')await page.locator('.tiptap').evaluate(element=>{window.__workbenchVisualBeforeOutline=element;});
  await duplicateHeadings.nth(1).click();
  assert.equal(await inspector.isVisible(),true,'Desktop outline remains open after navigation');
  await page.waitForFunction(expected=>document.querySelector('.editor-body')?.dataset.mode===expected,mode);
  if(mode==='source'||mode==='visual')await page.waitForFunction(expected=>{
   const headings=expected==='source'
    ?[...document.querySelectorAll('.cm-line')].filter(line=>line.textContent.trim()==='## Repeated')
    :[...document.querySelectorAll('.tiptap h1,.tiptap h2,.tiptap h3,.tiptap h4,.tiptap h5,.tiptap h6')]
      .filter(heading=>heading.textContent.trim()==='Repeated');
   const node=window.getSelection()?.anchorNode;
   const anchor=node instanceof Element?node:node?.parentElement;
   const selected=anchor?.closest(expected==='source'?'.cm-line':'h1,h2,h3,h4,h5,h6');
   return headings.indexOf(selected)===1;
  },mode);
  const navigation=await page.evaluate(expected=>{
   const allHeadings=expected==='source'
    ?[...document.querySelectorAll('.cm-line')].filter(line=>line.textContent.trim()==='## Repeated')
    :[...document.querySelectorAll(expected==='visual'?'.tiptap h1,.tiptap h2,.tiptap h3,.tiptap h4,.tiptap h5,.tiptap h6':
      '.markdown-preview h1,.markdown-preview h2,.markdown-preview h3,.markdown-preview h4,.markdown-preview h5,.markdown-preview h6')]
      .filter(heading=>heading.textContent.trim()==='Repeated');
   if(expected==='preview'){
    const scroller=document.querySelector('.main-scroll'),target=allHeadings[1];
    const view=scroller?.getBoundingClientRect(),rect=target?.getBoundingClientRect();
    return {count:allHeadings.length,scrollTop:scroller?.scrollTop??0,
     visible:Boolean(view&&rect&&rect.top>=view.top&&rect.bottom<=view.bottom)};
   }
   const node=window.getSelection()?.anchorNode;
   const anchor=node instanceof Element?node:node?.parentElement;
   const selected=anchor?.closest(expected==='source'?'.cm-line':'h1,h2,h3,h4,h5,h6');
   return {count:allHeadings.length,selectedIndex:allHeadings.indexOf(selected)};
  },mode);
  assert.equal(navigation.count,2,'Both duplicate headings are present in '+mode+' mode');
  if(mode==='preview'){
   await page.waitForFunction(()=>{
    const scroller=document.querySelector('.main-scroll');
    const headings=[...document.querySelectorAll('.markdown-preview h1,.markdown-preview h2,.markdown-preview h3,.markdown-preview h4,.markdown-preview h5,.markdown-preview h6')]
     .filter(heading=>heading.textContent.trim()==='Repeated');
    if(!scroller||!headings[1])return false;
    const view=scroller.getBoundingClientRect(),rect=headings[1].getBoundingClientRect();
    return scroller.scrollTop>0&&rect.top>=view.top&&rect.bottom<=view.bottom;
   });
  }else assert.equal(navigation.selectedIndex,1,'Outline jumps to the second duplicate in '+mode+' mode');
  assert.equal(new URL(page.url()).searchParams.get('mode'),mode,'Outline navigation preserves the URL mode in '+mode+' mode');
  assert.equal(await page.locator('.save-status').getByText('未保存').count(),0,
   'Heading navigation does not dirty a saved document in '+mode+' mode');
  if(mode==='visual')assert.equal(await page.locator('.tiptap').evaluate(element=>element===window.__workbenchVisualBeforeOutline),true,
   'Visual outline navigation preserves the live editor instance');
  await inspector.waitFor();
  await page.waitForFunction(()=>{
   const panel=document.querySelector('.workbench-inspector[data-document-panel="outline"]');
   const current=panel?.querySelector('.outline-item[aria-current="location"]');
   const repeated=panel?[...panel.querySelectorAll('.outline-item')].filter(item=>item.textContent.trim()==='Repeated'):[];
   return repeated.indexOf(current)===1;
  });
  assert.equal(await inspector.locator('.outline-item[aria-current="location"]').count(),1,
   'Outline highlights the active duplicate heading in '+mode+' mode');
  await inspector.locator('.panel-heading button').click();
  await inspector.waitFor({state:'hidden'});
 }
 await page.screenshot({path:'tmp/workbench-desktop.png'});
 console.log('PASS Workbench header, direct information/outline/history panels and history compare');
 await page.getByRole('button',{name:'源码',exact:true}).click();
 const draftEditor=page.locator('.cm-content');
 const draftContent='# Draft heading\n\nLocal draft marker.\n\n## Draft section\n\nUncommitted body.';
 await draftEditor.fill(draftContent);
 await page.locator('.save-status').getByText('未保存').waitFor();
 await outlineTrigger().click();
 await inspector.getByRole('button',{name:'Draft section',exact:true}).waitFor();
 await inspector.getByRole('button',{name:'Draft section',exact:true}).click();
 assert.equal(await inspector.isVisible(),true,'Desktop source outline remains open after draft navigation');
 await page.waitForFunction(()=>document.querySelector('.editor-body')?.dataset.mode==='source');
 assert.ok(await draftEditor.innerText().then(value=>value.includes('Local draft marker')),'Outline reads and preserves unsaved source content');
 await page.locator('.save-status').getByText('未保存').waitFor();
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await header.getByText('R3',{exact:true}).waitFor();
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.editor-body[data-mode="visual"] .tiptap'));
 const visualDraftParagraph=page.locator('.tiptap p').filter({hasText:'Local draft marker.'});
 await visualDraftParagraph.click();
 await page.keyboard.press('End');
 await page.keyboard.type(' visual-unsaved');
 await page.locator('.save-status').getByText('未保存').waitFor();
 await inspector.getByRole('button',{name:'Draft section',exact:true}).click();
 assert.equal(await inspector.isVisible(),true,'Desktop visual outline remains open after draft navigation');
 await page.waitForFunction(()=>document.querySelector('.editor-body')?.dataset.mode==='visual');
 await page.locator('.tiptap').getByText('visual-unsaved',{exact:false}).waitFor();
 await page.locator('.save-status').getByText('未保存').waitFor();
 await page.waitForFunction(()=>{
  const editor=document.querySelector('.tiptap');
  return Boolean(editor&&document.activeElement&&editor.contains(document.activeElement));
 });
 await page.keyboard.press('Control+Z');
 await page.waitForFunction(()=>!document.querySelector('.tiptap')?.textContent?.includes('visual-unsaved'));
 await page.locator('.save-status').getByText('未保存').waitFor({state:'hidden'});
 await inspector.locator('.panel-heading button').click();
 await inspector.waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:mobileHeight});
 await page.reload();
 await header.waitFor();
 await page.locator('.record-main .editor-topline').waitFor();
 const verifyPhoneToolbar=async width=>{
  await page.waitForFunction(()=>{
   const toolbar=document.querySelector('.record-main .editor-topline');
   const switcher=toolbar?.querySelector('.editor-view-switcher')?.getBoundingClientRect();
   const actions=toolbar?.querySelector('.editor-view-actions')?.getBoundingClientRect();
   return switcher&&actions&&Math.abs(switcher.y-actions.y)<2&&switcher.right<=actions.left+1&&actions.right<=toolbar.getBoundingClientRect().right+1;
  });
  const layout=await page.locator('.record-main .editor-topline').evaluate(toolbar=>({
   height:toolbar.getBoundingClientRect().height,
   modeButtons:[...toolbar.querySelectorAll('.editor-view-switcher [role="group"] > button')].map(button=>({
    label:button.innerText.trim(),width:button.clientWidth,scrollWidth:button.scrollWidth,
    text:[...button.querySelectorAll('*')].filter(element=>element.childElementCount===0&&element.textContent.trim())
     .map(element=>({width:element.clientWidth,scrollWidth:element.scrollWidth}))
   })),
   actions:[...toolbar.querySelectorAll('.document-panel-actions > button')].map(button=>button.getAttribute('aria-label')),
   pageWidth:document.documentElement.scrollWidth
  }));
  assert.ok(layout.height<=44,'Phone editing controls occupy one row at '+width+': '+JSON.stringify(layout));
  assert.deepEqual(layout.modeButtons.map(button=>button.label),['可视化','源码','预览']);
  assert.ok(layout.modeButtons.every(button=>button.scrollWidth<=button.width+1&&button.text.every(text=>text.scrollWidth<=text.width+1)),
   'Mode labels remain complete at '+width+': '+JSON.stringify(layout));
  assert.ok(layout.actions.includes('目录')&&layout.actions.includes('更多操作'),'Outline and More stay directly reachable');
  assert.equal(layout.actions.includes('信息'),layout.actions.includes('历史'),'Information and History overflow together');
  assert.ok(layout.pageWidth<=width+1,'Phone toolbar cannot widen the page: '+JSON.stringify(layout));
  return layout;
 };
 for(const width of [320,350,360,375,390,393,414,430,480,540,720]){
  await page.setViewportSize({width,height:mobileHeight});
  await verifyPhoneToolbar(width);
 }
 await page.setViewportSize({width:414,height:mobileHeight});
 await verifyPhoneToolbar(414);
 await infoTrigger().waitFor();
 await page.locator('.record-main .editor-topline').evaluate(toolbar=>{toolbar.style.width='300px';});
 await infoTrigger().waitFor({state:'hidden'});
 await verifyPhoneToolbar(414);
 await page.locator('.record-main .editor-topline').evaluate(toolbar=>{toolbar.style.removeProperty('width');});
 await infoTrigger().waitFor();
 await verifyPhoneToolbar(414);
 console.log('PASS single-row phone toolbar at 320–720px; overflow follows available space');
 await page.setViewportSize({width:390,height:mobileHeight});
 await verifyPhoneToolbar(390);
 const measure=await page.evaluate(()=>({
  width:document.documentElement.scrollWidth,
  viewport:innerWidth,
  header:(document.querySelector('.workbench-header')?.getBoundingClientRect().height??0),
  hasIcon:!!document.querySelector('.workbench-header .page-icon')
 }));
 assert.ok(measure.width<=measure.viewport+1,'Mobile horizontal overflow '+JSON.stringify(measure));
 assert.ok(measure.header<225,'Mobile header should remain compact '+JSON.stringify(measure));
 assert.equal(measure.hasIcon,false);
 const modeButtons=await page.locator('.editor-view-switcher [role="group"] > button').evaluateAll(buttons=>buttons.map(button=>{
  const textNodes=[...button.querySelectorAll('*')].filter(element=>element.childElementCount===0&&element.textContent.trim());
  const label=textNodes.find(element=>element.textContent.trim()===button.innerText.trim());
  return {label:button.innerText.trim(),width:button.clientWidth,scrollWidth:button.scrollWidth,
   labelWidth:label?.clientWidth??null,labelScrollWidth:label?.scrollWidth??null};
 }));
 assert.deepEqual(modeButtons.map(button=>button.label),['可视化','源码','预览'],'All editor modes remain named at 390px');
 assert.ok(modeButtons.every(button=>button.scrollWidth<=button.width+1&&
  (button.labelScrollWidth===null||button.labelScrollWidth<=button.labelWidth+1)),
  'Editor mode labels stay fully visible at 390px: '+JSON.stringify(modeButtons));
 await openPanelWithMotion(header.getByRole('button',{name:'详细信息',exact:true}),'mobile header details open',390);
 await verifyPropertyLayout();
 await page.screenshot({path:'tmp/workbench-mobile-details.png'});
 const box=await page.locator('dialog:has(.workbench-inspector) .astryx-bottom-sheet').boundingBox();
 assert.ok(box&&box.width>=385,'Touch inspector must remain a bottom sheet');
 await closePanelWithMotion('mobile info exit',390);
 await openPanelWithMotion(await panelEntry('历史'),
  'mobile direct history open',390);
 assert.equal(await inspector.getAttribute('data-document-panel'),'history');
 await inspector.getByText('Revision 1').waitFor();
 await page.screenshot({path:'tmp/workbench-mobile-inspector.png'});
 await closePanelWithMotion('mobile history exit',390);
 await openPanelWithMotion(await panelEntry('信息'),
  'mobile repeated info open',390);
 assert.equal(await inspector.getAttribute('data-document-panel'),'info');
 await verifyPropertyLayout();
 await closePanelWithMotion('mobile repeated info exit',390);
 if(await page.locator('.editor-body').getAttribute('data-mode')!=='visual'){
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.editor-body')?.dataset.mode==='visual');
 }
 assert.equal(await page.locator('.save-status').getByText('未保存').count(),0,
  'Mobile outline navigation starts from a clean visual document');
 await outlineTrigger().click();
 await inspector.getByRole('button',{name:'Draft section',exact:true}).click();
 await inspector.waitFor({state:'hidden'});
 await page.waitForFunction(()=>{
  const host=document.querySelector('.workbench-inspector')?.closest('dialog');
  return !host||(!host.open&&!host.matches(':modal'));
 });
 await page.waitForFunction(()=>{
  const editor=document.querySelector('.tiptap');
  const node=window.getSelection()?.anchorNode;
  const anchor=node instanceof Element?node:node?.parentElement;
  return Boolean(editor&&document.activeElement&&editor.contains(document.activeElement)&&
   anchor?.closest('h1,h2,h3,h4,h5,h6')?.textContent.trim()==='Draft section');
 });
 assert.equal(await page.locator('.save-status').getByText('未保存').count(),0,
  'Mobile outline navigation does not dirty the document');
 await outlineTrigger().click();
 await inspector.waitFor();
 await page.waitForFunction(()=>{
  const panel=document.querySelector('.workbench-inspector[data-document-panel="outline"]');
  return panel?.querySelector('.outline-item[aria-current="location"]')?.textContent.trim()==='Draft section';
 });
 assert.equal(await inspector.getByRole('button',{name:'Draft section',exact:true}).getAttribute('aria-current'),'location',
  'Mobile outline marks the heading selected in the visual editor');
 await inspector.locator('.panel-heading button').click();
 await inspector.waitFor({state:'hidden'});
 assert.equal(await page.locator('.save-status').getByText('未保存').count(),0,
  'Closing the mobile outline preserves the clean document');
 await page.screenshot({path:'tmp/workbench-mobile.png'});
 console.log('PASS 390px mobile layout, bottom-sheet panels and version history');
 await page.setViewportSize({width:320,height:narrowHeight});
 await verifyPhoneToolbar(320);
 await infoTrigger().waitFor({state:'hidden'});
 await historyTrigger().waitFor({state:'hidden'});
 await openPanelWithMotion(await panelEntry('信息'),
  'mobile overflow info open',320);
 assert.equal(await inspector.getAttribute('data-document-panel'),'info');
 await closePanelWithMotion('mobile resized reopen exit',320);
 await openPanelWithMotion(await panelEntry('历史'),'mobile overflow history open',320);
 await inspector.getByText('Revision 1').waitFor();
 await closePanelWithMotion('mobile overflow history exit',320);
 await page.emulateMedia({colorScheme:'dark'});
 await page.setViewportSize({width:320,height:narrowHeight});
 await page.reload();
 await header.waitFor();
 await page.waitForFunction(()=>document.documentElement.dataset.effectiveTheme==='dark');
 const narrow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,
  height:document.querySelector('.workbench-header')?.getBoundingClientRect().height??0}));
 assert.ok(narrow.width<=narrow.viewport+1,'Dark 320px document overflows: '+JSON.stringify(narrow));
 assert.ok(narrow.height<245,'Narrow document header occupies too much space: '+JSON.stringify(narrow));
 const darkTag=await header.locator('.workbench-summary-tag').first().evaluate(el=>{
  const swatch=document.createElement('span');swatch.style.background='var(--rk-canvas)';document.body.appendChild(swatch);
  const result={background:getComputedStyle(el).backgroundColor,canvas:getComputedStyle(swatch).backgroundColor};
  swatch.remove();return result;
 });
 const darkContrast=Math.max(...channels(darkTag.background).map((v,i)=>Math.abs(v-channels(darkTag.canvas)[i])));
 assert.ok(darkContrast>=10,'Dark-mode tag must have an evident background: '+JSON.stringify({...darkTag,darkContrast}));
 await page.screenshot({path:'tmp/workbench-dark-320.png'});
 console.log('PASS 320px dark-mode Workbench, no horizontal overflow');
 await page.emulateMedia({colorScheme:'light'});
 await page.setViewportSize({width:1440,height:900});
 const mathContent='# Inspector motion stress fixture\n\n'+Array.from({length:160},(_,index)=>
  '## Section '+index+'\n\n$$\n\\sum_{k=1}^{n}\\frac{x^{'+index+'}}{1+k^2}=\\int_0^1 \\frac{t^2}{1+t}\\,dt\n$$\n\nBody text.\n\n'
 ).join('');
 const longRecord=await page.evaluate(async content=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Inspector motion stress '+Date.now()+'.md',kind:'document',content})});
  if(!response.ok)throw Error('Cannot create the long VisualEditor fixture: '+response.status);
  return response.json();
 },mathContent);
 await page.goto(base+'/records/'+longRecord.id+'?mode=visual');
 const longHeader=page.locator('.record-page.workbench-document .workbench-header');
 await longHeader.waitFor();
 await page.waitForFunction(()=>document.querySelector('.editor-body[data-mode="visual"]')?.getAttribute('aria-busy')==='false'&&
  document.querySelectorAll('.editor-body[data-mode="visual"] .tiptap [data-type="block-math"]').length===160);
 const longInfo=page.getByRole('button',{name:'信息',exact:true});
 const openLongAndClose=async(trigger,label,viewport)=>{
  await openPanelWithMotion(trigger,label+' open',viewport);
  await closePanelWithMotion(label+' close',viewport);
 };
 await openLongAndClose(longInfo,'long visual 160 math desktop info',1440);
 await openLongAndClose(outlineTrigger(),'long visual 160 math desktop outline',1440);
 await openLongAndClose(historyTrigger(),'long visual 160 math desktop history',1440);
 await page.setViewportSize({width:390,height:mobileHeight});
 await page.waitForFunction(()=>matchMedia('(max-width: 720px)').matches);
 await openLongAndClose(await panelEntry('信息'),'long visual 160 math mobile info',390);
 await openLongAndClose(outlineTrigger(),'long visual 160 math mobile outline',390);
 await openLongAndClose(await panelEntry('历史'),'long visual 160 math mobile history',390);
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.editor-view-switcher button').nth(2).click();
 await page.waitForFunction(()=>document.querySelector('.editor-body[data-mode="preview"]')?.getAttribute('aria-busy')==='false'&&
  document.querySelectorAll('.editor-body[data-mode="preview"] .markdown-preview .katex-display').length===160);
 await openLongAndClose(longInfo,'long preview 160 math desktop info',1440);
 await openLongAndClose(outlineTrigger(),'long preview 160 math desktop outline',1440);
 await openLongAndClose(historyTrigger(),'long preview 160 math desktop history',1440);
 await page.setViewportSize({width:390,height:mobileHeight});
 await page.emulateMedia({reducedMotion:'reduce'});
 await (await panelEntry('信息')).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('dialog')].some(dialog=>dialog.querySelector('.workbench-inspector')&&
  (dialog.open||dialog.matches(':popover-open'))));
 await inspector.locator('.panel-heading button').click();
 await page.waitForFunction(()=>{
  const host=[...document.querySelectorAll('dialog')].find(dialog=>dialog.querySelector('.workbench-inspector'));
  return !host||(!host.open&&!host.matches(':modal')&&!host.matches(':popover-open'));
 });
 const released=await page.evaluate(()=>{
  const host=[...document.querySelectorAll('dialog')].find(dialog=>dialog.querySelector('.workbench-inspector'));
  return {connected:Boolean(host?.isConnected),open:host?.open??null,modal:host?.matches(':modal')??false,
   popover:host?.matches(':popover-open')??false};
 });
 assert.ok(!released.open&&!released.modal&&!released.popover,
  'Reduced-motion close must release the inspector from the native overlay top layer');
 console.log('PASS 160-math VisualEditor/Preview panel motion on desktop/mobile and reduced-motion cleanup');
 assert.deepEqual(errors,[],'Browser runtime errors');
 await saveMotionDiagnostics();
 console.log('Inspector transform traces:',motionDiagnosticPath);
}catch(error){
 await saveMotionDiagnostics();
 const failureUi=await page.evaluate(()=>{
  const active=document.activeElement,scroller=document.querySelector('.main-scroll');
  const headings=[...document.querySelectorAll('.markdown-preview h1,.markdown-preview h2,.markdown-preview h3,.markdown-preview h4,.markdown-preview h5,.markdown-preview h6')]
   .map(heading=>{const rect=heading.getBoundingClientRect();return {text:(heading.innerText||heading.textContent||'').trim().slice(0,60),
    top:Math.round(rect.top),height:Math.round(rect.height)};});
  return {mode:document.querySelector('.editor-body')?.dataset.mode??null,
   activeElement:{tag:active?.tagName??null,text:(active?.innerText||active?.textContent||'').trim().slice(0,80)},
   mainScroll:scroller?{scrollTop:Math.round(scroller.scrollTop),clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight}:null,
   previewHeadingCount:headings.length,previewHeadings:headings.length<=6?headings:[...headings.slice(0,3),...headings.slice(-3)]};
 }).catch(()=>null);
 const failureScreenshot=join('tmp','workbench-failure-'+engine+'.png');
 await page.screenshot({path:failureScreenshot,fullPage:true}).catch(()=>undefined);
 console.error('Inspector transform regression diagnostics',JSON.stringify({engine,motionDiagnosticPath,
  failureScreenshot,failureUi,completedSamples:motionSamples.length,error:error.message}));
 throw error;
}finally{await browser.close();}
