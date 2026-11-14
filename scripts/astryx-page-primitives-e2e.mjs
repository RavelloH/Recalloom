/** Page primitives and retained native-link behavior; isolated localhost only. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Use a disposable local Worker/D1');
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path)):undefined;
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local test secret is required');
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executable?{executablePath:executable}:{})});
const context=await browser.newContext({viewport:{width:1365,height:900}});
await context.addInitScript(()=>{
 window.__pageTransitions=[];
 if(document.startViewTransition){
  const original=document.startViewTransition.bind(document);
  document.startViewTransition=(...args)=>{
   const transition=original(...args),record={finished:false};
   window.__pageTransitions.push(record);
   transition.finished.then(()=>{record.finished=true;},()=>{record.finished=true;});
   return transition;
  };
 }
});
if(process.env.RECALLOOM_TRACE_RESIZE==='1')await context.addInitScript(()=>{
 const NativeResizeObserver=window.ResizeObserver,notifications=[];
 window.__pageResizeErrors=[];
 window.ResizeObserver=class extends NativeResizeObserver{
  constructor(callback){super((entries,observer)=>{
   notifications.push(entries.map(entry=>({tag:entry.target.tagName,className:entry.target.className,
    width:entry.contentRect.width,height:entry.contentRect.height})));
   if(notifications.length>4)notifications.shift();
   callback(entries,observer);
  });}
 };
 window.addEventListener('error',event=>{
  if(event.message.startsWith('ResizeObserver loop')){
   const sample={path:location.pathname,notifications:[...notifications]};
   window.__pageResizeErrors.push(sample);console.warn('PAGE_RESIZE_DIAGNOSTICS '+JSON.stringify(sample));
  }
 });
});
const page=await context.newPage();
if(process.env.RECALLOOM_TRACE_RESIZE==='1')page.on('console',message=>{
 if(message.text().startsWith('PAGE_RESIZE_DIAGNOSTICS '))console.error(message.text());
});
page.setDefaultTimeout(25000);
const faults=[],resizeNotices=[];
page.on('pageerror',error=>{
 const path=new URL(page.url()).pathname;
 const notice=error.message+' @ '+path;
 if(engine==='webkit'&&error.message==='ResizeObserver loop completed with undelivered notifications.'&&
  /^\/settings\/(oauth|backup)$/.test(path))resizeNotices.push(notice);
 else faults.push(notice);
});
let sessionCookie='',emptyGraph=false;
await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(emptyGraph&&url.pathname==='/api/graph'){
  await route.fulfill({json:{nodes:[],edges:[],focusId:null,semanticStatus:'disabled',limit:80,scope:'recent'}});
  return;
 }
 if(engine!=='webkit'){await route.continue();return;}
 if(url.pathname==='/api/auth/login'){
  const response=await route.fetch();
  sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});return;
 }
 if(!sessionCookie){await route.continue();return;}
 const response=await route.fetch({headers:{...await request.allHeaders(),cookie:sessionCookie}});
 await route.fulfill({response});
});
async function api(path,body){
 const response=await page.evaluate(async({path,body})=>{
  const result=await fetch('/api'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:result.status,body:await result.json()};
 },{path,body});
 assert.equal(response.status,201,JSON.stringify(response.body));return response.body;
}
async function noPageOverflow(){
 const size=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));
 assert.ok(size.page<=size.viewport+1,JSON.stringify(size));
}
async function transitionCount(){return page.evaluate(()=>window.__pageTransitions.length);}
async function settledView(since){
 console.log('PAGE STEP waiting for route transition',new URL(page.url()).pathname);
 await page.waitForFunction(since=>typeof document.startViewTransition!=='function'||
  ((since===null||window.__pageTransitions.length>since)&&window.__pageTransitions.every(transition=>transition.finished)),since??null);
 console.log('PAGE STEP route transition finished',new URL(page.url()).pathname);
}
async function selectedSearchMode(value){
 await page.waitForFunction(value=>Array.from(document.querySelectorAll('.search-mode-control [role="radio"]'))
  .some(element=>element.getAttribute('data-value')===value&&element.getAttribute('aria-checked')==='true'),value);
 await settledView();
}
async function changeSearchMode(label,value){
 const before=await page.evaluate(()=>({writes:window.__pageModeNavigation.writes.length,
  transitions:window.__pageModeNavigation.transitions.length,hasTransitions:typeof document.startViewTransition==='function'}));
 await page.getByRole('radiogroup',{name:'搜索方式'}).getByRole('radio',{name:label,exact:true}).click();
 await page.waitForURL(url=>url.searchParams.get('mode')===value);
 if(before.hasTransitions){
  await page.waitForFunction(count=>window.__pageModeNavigation.transitions.length>count,before.transitions);
  await page.waitForFunction(count=>window.__pageModeNavigation.transitions.slice(count).every(transition=>transition.finished),before.transitions);
 }
 await selectedSearchMode(value);
 const actual=await page.evaluate(({before,value})=>({
  writes:window.__pageModeNavigation.writes.slice(before.writes).filter(mode=>mode===value),
  transitions:window.__pageModeNavigation.transitions.slice(before.transitions)
 }),{before,value});
 assert.ok(actual.writes.length<=1,'One radio activation must write its destination once: '+JSON.stringify(actual));
 assert.ok(actual.transitions.length<=1,'One radio activation must start at most one route transition: '+JSON.stringify(actual));
 assert.ok(actual.transitions.every(transition=>!transition.error),'Mode navigation finishes without an aborted transition');
}
async function nativeLinkSurface(locator,href){
 assert.equal(await locator.evaluate(element=>element.tagName),'A','The full surface remains a native link');
 assert.equal(await locator.getAttribute('href'),href);
 await page.evaluate(()=>{
  window.__pageContextHref=null;
  window.__pageContextPrevented=null;
  document.addEventListener('contextmenu',event=>{
   window.__pageContextHref=event.target.closest('a')?.getAttribute('href')??null;
   window.__pageContextPrevented=event.defaultPrevented;
   // Record the app's native-link contract, then suppress the operating-system
   // menu so the scenario can continue through subsequent browser actions.
   event.preventDefault();
  },{once:true});
 });
 await locator.click({button:'right',position:{x:8,y:8}});
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.__pageContextHref),href,'Right-click surface exposes the destination link');
 assert.equal(await page.evaluate(()=>window.__pageContextPrevented),false,'App handlers leave the native context action available');
}
try{
 console.log('PAGE STEP login');
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 const loginTransition=await transitionCount();
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 await settledView(loginTransition);
 const stamp='page-primitives-'+Date.now();
 const folder=await api('/folders',{name:'Page primitives '+stamp});
 const make=name=>api('/records',{name:name+' '+stamp+'.md',kind:'document',folderId:folder.id,content:'# '+name+'\n\nPage primitive regression.'});
 const record=await make('Metadata'),fresh=await make('Search');

 console.log('PAGE STEP settings desktop');
 await page.goto(base+'/settings',{waitUntil:'networkidle'});
 const settings=page.getByRole('navigation',{name:'设置页面'});
 assert.equal(await settings.locator('[role="tab"]').count(),0,'Settings is route navigation rather than panel tabs');
 assert.equal(await settings.getByRole('link').count(),5);
 await page.evaluate(()=>{window.__pageSpaSentinel='retained';});
 const settingsTransition=await transitionCount();
 await settings.getByRole('link',{name:'Agent 授权',exact:true}).click();
 await page.waitForURL(base+'/settings/oauth');
 await settledView(settingsTransition);
 assert.equal(await page.evaluate(()=>window.__pageSpaSentinel),'retained','Astryx links retain SPA navigation');
 assert.match(await settings.getByRole('link',{name:'Agent 授权',exact:true}).getAttribute('aria-current')??'',/^(page|true)$/);
 console.log('PAGE STEP settings mobile resize');
 await page.setViewportSize({width:390,height:900});
 const backup=settings.getByRole('link',{name:'备份',exact:true});
 const backupTransition=await transitionCount();
 await backup.focus();await backup.press('Enter');await page.waitForURL(base+'/settings/backup');
 await settledView(backupTransition);
 await page.waitForFunction(()=>{
  const strip=document.querySelector('.settings-nav .astryx-tab-strip');
  return strip&&strip.scrollWidth>strip.clientWidth;
 });
 await noPageOverflow();

 console.log('PAGE STEP metadata');
 await page.setViewportSize({width:1365,height:900});
 await page.goto(base+'/records/'+record.id,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'详细信息',exact:true}).click();
 const inspector=page.locator('.workbench-inspector[data-document-panel="info"]');
 await inspector.waitFor({state:'visible'});
 const metadata=inspector.locator('.astryx-metadata-list');
 assert.equal(await metadata.locator('dt').count(),9);
 assert.equal(await metadata.locator('dd').count(),9);
 await page.waitForFunction(()=>{
  const root=document.querySelector('.workbench-inspector[data-document-panel="info"] .astryx-metadata-list');
  if(!root)return false;
  const label=root.querySelector('dt').getBoundingClientRect(),value=root.querySelector('dd').getBoundingClientRect();
  return Math.abs(value.left-label.left-104)<2;
 },null,{timeout:5000}).catch(()=>{});
 const column=await metadata.evaluate(element=>{
  const label=element.querySelector('dt').getBoundingClientRect(),value=element.querySelector('dd').getBoundingClientRect();
  const grid=getComputedStyle(element.querySelector('dl'));
  return {offset:value.left-label.left,top:Math.abs(label.top-value.top),labelWidth:label.width,
   columns:grid.gridTemplateColumns,gap:grid.gap,widthVariable:getComputedStyle(element).getPropertyValue('--rk-property-label-width')};
 });
 assert.ok(Math.abs(column.offset-104)<2&&column.top<2,'Inspector retains 94px label and 10px gap: '+JSON.stringify(column));
 await inspector.getByRole('button',{name:'添加标签',exact:true}).click();
 await inspector.getByRole('textbox',{name:'新标签',exact:true}).fill('Primitive');
 await page.keyboard.press('Enter');
 await inspector.locator('.tag-editor').getByText('primitive',{exact:true}).waitFor();
 const trail=page.getByRole('navigation',{name:'页面路径'});
 assert.equal(await trail.locator('a a').count(),0,'No nested breadcrumb links');
 assert.equal(await trail.getByRole('link',{name:folder.name,exact:true}).getAttribute('href'),'/library/'+folder.id);

 console.log('PAGE STEP home and search');
 await page.goto(base+'/',{waitUntil:'networkidle'});
 await nativeLinkSurface(page.locator('a.recent-page[href="/records/'+record.id+'"]'),'/records/'+record.id);
 await page.mouse.move(0,0);
 await page.goto(base+'/search?q='+stamp.split('-').at(-1)+'&mode=metadata',{waitUntil:'networkidle'});
 assert.equal(await page.getByRole('button',{name:'Show Error',exact:true}).isVisible(),false,'Numeric search URLs render without a route error');
 await page.locator('a.search-result[href="/records/'+fresh.id+'"]').waitFor();
 await page.goto(base+'/search?q='+stamp+'&mode=metadata',{waitUntil:'networkidle'});
 assert.equal(await page.getByRole('button',{name:'Show Error',exact:true}).isVisible(),false,'Search renders without a route error');
 const modes=page.getByRole('radiogroup',{name:'搜索方式'});
 assert.equal(await modes.getByRole('radio',{name:'名称',exact:true}).getAttribute('aria-checked'),'true');
 const descriptions=await modes.getByRole('radio').evaluateAll(elements=>elements.map(element=>({
  mode:element.getAttribute('data-value'),
  description:document.getElementById(element.getAttribute('aria-describedby'))?.textContent,
 })));
 assert.ok(descriptions.every(item=>item.description?.trim()),'Every search mode exposes its own accessible explanation');
 assert.equal(new Set(descriptions.map(item=>item.description)).size,4,'Unselected modes keep their own descriptions');
 await page.evaluate(()=>{
  window.__pageModeNavigation={writes:[],transitions:[]};
  for(const method of ['pushState','replaceState']){
   const original=history[method].bind(history);
   history[method]=(...args)=>{
    const url=new URL(String(args[2]??location.href),location.href);
    if(args[2]!=null&&url.pathname==='/search')window.__pageModeNavigation.writes.push(url.searchParams.get('mode'));
    return original(...args);
   };
  }
  if(document.startViewTransition){
   const original=document.startViewTransition.bind(document);
   document.startViewTransition=(...args)=>{
    const transition=original(...args),record={finished:false,error:null};
    window.__pageModeNavigation.transitions.push(record);
    transition.finished.then(()=>{record.finished=true;},error=>{record.finished=true;record.error=String(error);});
    return transition;
   };
  }
 });
 await changeSearchMode('关键词','literal');
 assert.equal(await modes.getByRole('radio',{name:'关键词',exact:true}).getAttribute('aria-checked'),'true');
 await changeSearchMode('名称','metadata');
 assert.equal(await modes.getByRole('radio',{name:'名称',exact:true}).getAttribute('aria-checked'),'true');
 const result=page.locator('a.search-result[href="/records/'+fresh.id+'"]');
 console.log('PAGE STEP search result visible');
 await result.waitFor();
 const preload=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/records/'+fresh.id,{timeout:10000});
 console.log('PAGE STEP search result preload');
 await result.hover();await preload;
 console.log('PAGE STEP search result context menu');
 await nativeLinkSurface(result,'/records/'+fresh.id);
 if(engine==='chromium')for(const options of [{modifiers:['Control']},{button:'middle'},{modifiers:['Shift']}]){
  const opened=context.waitForEvent('page');await result.click(options);
  const tab=await opened;await tab.waitForURL(base+'/records/'+fresh.id);await tab.close();
  assert.equal(new URL(page.url()).pathname,'/search','Modified activation leaves the origin intact');
 }
 await page.evaluate(()=>{window.__pageSpaSentinel='retained';});
 console.log('PAGE STEP search result keyboard');
 const recordTransition=await transitionCount();
 await result.focus();await result.press('Enter');await page.waitForURL(base+'/records/'+fresh.id);
 await settledView(recordTransition);
 assert.equal(await page.evaluate(()=>window.__pageSpaSentinel),'retained','Keyboard card activation remains SPA');

 console.log('PAGE STEP graph');
 emptyGraph=true;
 await page.goto(base+'/graph',{waitUntil:'networkidle'});
 const empty=page.locator('.graph-empty.astryx-empty-state');
 await empty.waitFor();
 assert.equal(await empty.getAttribute('role'),'status');
 assert.equal(await empty.getByRole('heading',{name:'知识库尚无可显示的记录。添加文档后即可查看关系网。'}).count(),1);
 for(const width of [1365,390]){
  await page.setViewportSize({width,height:900});
  const appearance=await empty.evaluate(element=>({height:element.getBoundingClientRect().height,
   size:getComputedStyle(element.querySelector('.astryx-empty-state-title')).fontSize,
   weight:getComputedStyle(element.querySelector('.astryx-empty-state-title')).fontWeight}));
  assert.ok(appearance.height>=280&&appearance.size==='14px'&&appearance.weight==='400',JSON.stringify(appearance));
  await noPageOverflow();
 }
 emptyGraph=false;
 await page.goto(base+'/graph?focus='+record.id,{waitUntil:'networkidle'});
 await page.getByRole('img',{name:/交互式文档关系图/}).waitFor();
 assert.ok(resizeNotices.length<=2,'Settings viewport changes must not cause repeated ResizeObserver notifications');
 if(resizeNotices.length)console.log('NOTE finite WebKit resize-delivery notifications during settings viewport changes:',JSON.stringify(resizeNotices));
 assert.deepEqual(faults,[],'No browser runtime errors');
 console.log('PASS page primitives: route tabs, mobile strip, metadata, breadcrumb, search radios, native cards, preload, graph empty/canvas',engine);
}catch(error){
 mkdirSync('tmp',{recursive:true});
 if(process.env.RECALLOOM_TRACE_RESIZE==='1')console.error('Resize diagnostics:',JSON.stringify(await page.evaluate(()=>window.__pageResizeErrors)));
 const showError=page.getByRole('button',{name:'Show Error',exact:true});
 if(await showError.isVisible().catch(()=>false)){
  await showError.click();console.error('Router error:',await page.locator('body').innerText());
 }
 await page.screenshot({path:'tmp/astryx-page-primitives-'+engine+'-failure.png',fullPage:true}).catch(()=>{});
 console.error('Page primitives failed',JSON.stringify({engine,url:page.url(),faults}));throw error;
}finally{
 await page.unrouteAll({behavior:'ignoreErrors'});
 await context.close();await browser.close();
}
