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
page.on('pageerror',error=>errors.push(error.message));
const motionSamples=[];
const motionDiagnosticPath=join('tmp','workbench-inspector-motion-'+engine+'-'+Date.now()+'.json');

await page.addInitScript(()=>{
 window.__workbenchInspectorMotion=[];
 window.__workbenchInspectorSessions=[];
 window.__workbenchMotionSession=null;
 const panelFor=()=>{
  const host=document.querySelector('dialog[aria-label="文档检查器"]');
  if(!host)return null;
  return {host,target:host.querySelector('.astryx-bottom-sheet')||host};
 };
 const rectOf=element=>{
  const rect=element.getBoundingClientRect();
  return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
 };
 const frame=(session)=>{
  if(session.target&&session.host?.open){
   session.frames.push({time:performance.now(),target:session.target,host:session.host,
    transform:getComputedStyle(session.target).transform});
  }
  if(session.endTime!==null){
   session.framesAfterEnd++;
   if(session.framesAfterEnd>=2){session.stopped=true;return;}
  }
  requestAnimationFrame(()=>frame(session));
 };
 document.addEventListener('click',()=>{
  const session=window.__workbenchMotionSession;
  if(!session||session.clickTime!==null)return;
  session.clickTime=performance.now();
  const panel=panelFor();
  if(panel){session.host=panel.host;session.target=panel.target;}
  requestAnimationFrame(()=>frame(session));
 },true);
 const capture=event=>{
  if(event.propertyName!=='transform'||!(event.target instanceof Element))return;
  const host=event.target.closest('dialog[aria-label="文档检查器"]');
  if(!host)return;
  const nativePanel=event.target===host||event.target.classList.contains('astryx-bottom-sheet');
  if(!nativePanel)return;
  const transition=event.target.getAnimations().find(animation=>animation.transitionProperty==='transform');
  const session=window.__workbenchMotionSession;
  if(session&&session.clickTime!==null&&!session.target){session.host=host;session.target=event.target;}
  const record={
   phase:event.type,time:performance.now(),propertyName:event.propertyName,target:event.target,host,nativePanel,
   targetTag:event.target.tagName,targetClass:typeof event.target.className==='string'?event.target.className:'',
   transform:getComputedStyle(event.target).transform,
   keyframes:transition?.effect?.getKeyframes().map(frame=>frame.transform).filter(value=>typeof value==='string')??[],
   rect:rectOf(event.target)
  };
  window.__workbenchInspectorMotion.push(record);
  if(session&&session.clickTime!==null){
   session.events.push(record);
   if(event.type==='transitionend'&&event.target===session.events.find(item=>item.phase==='transitionrun')?.target){
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
  const track=this.getAttribute('aria-label')==='文档检查器'&&session&&session.clickTime!==null;
  if(track){
   session.showModalBefore=performance.now();
   session.host=this;
   session.target=this.querySelector('.astryx-bottom-sheet')||this;
  }
  const result=showModal.apply(this,args);
  if(track)session.showModalAfter=performance.now();
  return result;
 };
});

const resetMotionSamples=label=>page.evaluate(label=>{
 const session={label,clickTime:null,showModalBefore:null,showModalAfter:null,endTime:null,host:null,target:null,
  framesAfterEnd:0,stopped:false,events:[],frames:[]};
 window.__workbenchMotionSession=session;
 window.__workbenchInspectorSessions.push(session);
},label);
const assertInspectorTransformMotion=async(label,viewport)=>{
 await page.waitForFunction(()=>{
  const session=window.__workbenchMotionSession;
  return session?.stopped===true;
 });
 const sample=await page.evaluate(()=>{
  const session=window.__workbenchMotionSession;
  const events=session?.events??[];
  for(let index=0;index<events.length;index++){
   const start=events[index];
   if(start.phase!=='transitionrun'||start.propertyName!=='transform')continue;
   const end=events.slice(index+1).find(event=>event.phase==='transitionend'&&event.propertyName==='transform'&&event.target===start.target);
   if(end){
    const frames=session.frames.filter(frame=>frame.target===start.target&&frame.time>start.time&&frame.time<end.time);
    const point=transform=>{
     if(!transform||transform==='none')return {x:0,y:0};
     const match=/^matrix(3d)?\(([^)]+)\)$/.exec(transform);
     if(!match)return null;
     const values=match[2].split(',').map(Number);
     return match[1]?{x:values[12],y:values[13]}:{x:values[4],y:values[5]};
    };
    const startPoint=point(start.transform),endPoint=point(end.transform);
    const dx=endPoint&&startPoint?endPoint.x-startPoint.x:end.rect.x-start.rect.x;
    const dy=endPoint&&startPoint?endPoint.y-startPoint.y:end.rect.y-start.rect.y;
    const lengthSquared=dx*dx+dy*dy;
    const intermediateFrame=lengthSquared>1&&startPoint&&endPoint&&frames.some(frame=>{
     const framePoint=point(frame.transform);
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
 assert.ok(sample.sameHost,'Inspector transition changed native host: '+label+' '+JSON.stringify(sample));
 const expectedTarget=viewport<=720?'astryx-bottom-sheet':'DIALOG';
 assert.ok(viewport<=720?sample.targetClass.includes(expectedTarget):sample.targetTag===expectedTarget,
  'Inspector transition must animate its '+(viewport<=720?'BottomSheet panel':'Drawer dialog')+': '+label+' '+JSON.stringify(sample));
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
 const inspector=page.locator('dialog[aria-label="文档检查器"]');
 const openInspectorWithMotion=async(trigger,label,viewport)=>{
  await resetMotionSamples(label);
  await trigger.click();
  await assertInspectorTransformMotion(label,viewport);
 };
 const closeInspectorWithMotion=async(label,viewport)=>{
  await resetMotionSamples(label);
  await inspector.locator('.workbench-inspector .panel-heading button').click();
  await assertInspectorTransformMotion(label,viewport);
  await page.waitForFunction(()=>{
   const host=document.querySelector('dialog[aria-label="文档检查器"]');
   return host?.open===false&&!host.matches(':modal');
  });
 };
 const detailsTrigger=()=>header.locator('button.workbench-details-trigger');
 const historyTrigger=()=>page.locator('.editor-view-actions button[aria-label="历史"]');
 await openInspectorWithMotion(detailsTrigger(),'desktop first details open',1440);
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
 assert.equal(await inspector.getByRole('tab',{name:'信息'}).getAttribute('aria-selected'),'true');
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
 assert.equal(await header.locator('.workbench-summary').evaluate(el=>getComputedStyle(el).display),'grid','Metadata details button should align at the far right');
 await inspector.getByRole('tab',{name:'关联'}).click();
 assert.equal(await inspector.getByRole('tab',{name:'关联'}).getAttribute('aria-selected'),'true');
 await inspector.getByRole('tab',{name:'信息'}).click();
 await inspector.getByRole('tab',{name:'目录'}).click();
 await inspector.getByText('暂无 Markdown 标题').waitFor();
 await inspector.getByRole('tab',{name:'信息'}).click();
 await closeInspectorWithMotion('desktop details exit',1440);
 await openInspectorWithMotion(historyTrigger(),
  'desktop details-to-history open',1440);
 await inspector.getByRole('tab',{name:'版本'}).waitFor();
 await inspector.getByText('Revision 1').waitFor();
 await closeInspectorWithMotion('desktop history exit',1440);
 await openInspectorWithMotion(detailsTrigger(),
  'desktop history-to-details repeated open',1440);
 assert.equal(await inspector.getByRole('tab',{name:'信息'}).getAttribute('aria-selected'),'true');
 await closeInspectorWithMotion('desktop repeated details exit',1440);
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').fill('# Workbench heading\n\nVersioned content.');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await header.getByText('R2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'历史',exact:true}).click();
 await inspector.waitFor();
 await inspector.getByRole('tab',{name:'版本'}).waitFor();
 await inspector.getByText('Revision 1').waitFor();
 assert.equal(await page.getByRole('dialog',{name:'版本历史'}).count(),0,'Do not open a second, separate history drawer');
 const revision=inspector.locator('.history-row').filter({hasText:'Revision 1'});
 await revision.getByRole('button',{name:'比较'}).click();
 const comparison=page.getByRole('dialog',{name:'版本对比'});
 await comparison.locator('.revision-diff-block').first().waitFor();
 await comparison.getByRole('button',{name:'关闭版本对比'}).click();
 await comparison.waitFor({state:'hidden'});
 await inspector.getByRole('tab',{name:'目录'}).click();
 await inspector.getByRole('button',{name:'Workbench heading'}).waitFor();
 await inspector.getByRole('button',{name:'Workbench heading'}).click();
 await inspector.waitFor({state:'hidden'});
 await page.locator('.cm-content').waitFor();
 await page.screenshot({path:'tmp/workbench-desktop.png'});
 console.log('PASS Workbench header, metadata summary, single four-tab inspector and history compare');
 await page.setViewportSize({width:390,height:mobileHeight});
 await page.reload();
 await header.waitFor();
 const measure=await page.evaluate(()=>({
  width:document.documentElement.scrollWidth,
  viewport:innerWidth,
  header:(document.querySelector('.workbench-header')?.getBoundingClientRect().height??0),
  hasIcon:!!document.querySelector('.workbench-header .page-icon')
 }));
 assert.ok(measure.width<=measure.viewport+1,'Mobile horizontal overflow '+JSON.stringify(measure));
 assert.ok(measure.header<225,'Mobile header should remain compact '+JSON.stringify(measure));
 assert.equal(measure.hasIcon,false);
 await openInspectorWithMotion(detailsTrigger(),'mobile first details open',390);
 await verifyPropertyLayout();
 await page.screenshot({path:'tmp/workbench-mobile-details.png'});
 const box=await inspector.boundingBox();
 assert.ok(box&&box.width>=385,'Touch inspector must remain a bottom sheet');
 await closeInspectorWithMotion('mobile details exit',390);
 await openInspectorWithMotion(historyTrigger(),
  'mobile details-to-history open',390);
 assert.equal(await inspector.getByRole('tab',{name:'版本'}).getAttribute('aria-selected'),'true');
 await inspector.getByText('Revision 1').waitFor();
 await page.screenshot({path:'tmp/workbench-mobile-inspector.png'});
 await closeInspectorWithMotion('mobile history exit',390);
 await openInspectorWithMotion(detailsTrigger(),
  'mobile history-to-details repeated open',390);
 assert.equal(await inspector.getByRole('tab',{name:'信息'}).getAttribute('aria-selected'),'true');
 await verifyPropertyLayout();
 await closeInspectorWithMotion('mobile repeated details exit',390);
 await page.screenshot({path:'tmp/workbench-mobile.png'});
 console.log('PASS 390px mobile layout, bottom-sheet tabs and version history');
 await page.setViewportSize({width:320,height:narrowHeight});
 await openInspectorWithMotion(detailsTrigger(),
  'mobile re-open after closed-width change',320);
 await closeInspectorWithMotion('mobile resized reopen exit',320);
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
 const longDetails=longHeader.locator('button.workbench-details-trigger');
 const openLongAndClose=async(trigger,label,viewport)=>{
  await openInspectorWithMotion(trigger,label+' open',viewport);
  await closeInspectorWithMotion(label+' close',viewport);
 };
 await openLongAndClose(longDetails,'long visual 160 math desktop details',1440);
 await openLongAndClose(historyTrigger(),'long visual 160 math desktop history',1440);
 await page.setViewportSize({width:390,height:mobileHeight});
 await page.waitForFunction(()=>matchMedia('(max-width: 720px)').matches);
 await openLongAndClose(longDetails,'long visual 160 math mobile details',390);
 await openLongAndClose(historyTrigger(),'long visual 160 math mobile history',390);
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.editor-view-switcher button').nth(2).click();
 await page.waitForFunction(()=>document.querySelector('.editor-body[data-mode="preview"]')?.getAttribute('aria-busy')==='false'&&
  document.querySelectorAll('.editor-body[data-mode="preview"] .markdown-preview .katex-display').length===160);
 await openLongAndClose(longDetails,'long preview 160 math desktop details',1440);
 await openLongAndClose(historyTrigger(),'long preview 160 math desktop history',1440);
 await page.emulateMedia({reducedMotion:'reduce'});
 await longDetails.click();
 await page.waitForFunction(()=>document.querySelector('dialog[aria-label="文档检查器"]')?.open===true);
 await inspector.locator('.workbench-inspector .panel-heading button').click();
 await page.waitForFunction(()=>{
  const host=document.querySelector('dialog[aria-label="文档检查器"]');
  return host?.open===false&&!host.matches(':modal');
 });
 const released=await page.evaluate(()=>{
  const host=document.querySelector('dialog[aria-label="文档检查器"]');
  return {connected:Boolean(host?.isConnected),open:host?.open??null,modal:host?.matches(':modal')??false};
 });
 assert.deepEqual(released,{connected:true,open:false,modal:false},
  'Reduced-motion close must release the inspector from the native modal top layer');
 console.log('PASS 160-math VisualEditor/Preview inspector motion on desktop/mobile and reduced-motion cleanup');
 assert.deepEqual(errors,[],'Browser runtime errors');
 await saveMotionDiagnostics();
 console.log('Inspector transform traces:',motionDiagnosticPath);
}catch(error){
 await saveMotionDiagnostics();
 console.error('Inspector transform regression diagnostics',JSON.stringify({engine,motionDiagnosticPath,
  completedSamples:motionSamples.length,error:error.message}));
 throw error;
}finally{await browser.close();}
