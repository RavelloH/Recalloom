import {readLocalAuthVars} from './local-auth-config.mjs';
/** Page primitives and retained native-link behavior; isolated localhost only. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Use a disposable local Worker/D1');
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path)):undefined;
const secretLine=readLocalAuthVars().split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local test secret is required');
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executable?{executablePath:executable}:{})});
const context=await browser.newContext({viewport:{width:1365,height:900},colorScheme:process.env.RECALLOOM_TEST_COLOR_SCHEME==='dark'?'dark':'light'});
await context.addInitScript(()=>{
 window.__pageTransitions=[];
 if(document.startViewTransition){
  const original=document.startViewTransition.bind(document);
  document.startViewTransition=(...args)=>{
   const transition=original(...args),record={finished:false,content:document.querySelector('.page')?.textContent,modeHint:document.querySelector('.search-modes .muted')?.textContent};
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
let accessGrants=[{id:'fixture-grant',clientId:'fixture-client',clientName:'测试 Agent · 知识库助手',scope:['notes:read','notes:write'],createdAt:1794700000,expiresAt:null,redirectHost:'agent.example.test'}];
let extraSessions=[{id:'fixture-session',createdAt:Date.now()-86400000,lastSeenAt:Date.now()-3600000,expiresAt:Date.now()+86400000,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/27.0.1 Mobile/15E148 Safari/604.1'}];
await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.pathname==='/api/auth/oauth-grants'&&request.method()==='GET'){
  await route.fulfill({json:{items:accessGrants,cursor:null}});return;
 }
 if(url.pathname==='/api/auth/oauth-grants/fixture-extra'&&request.method()==='DELETE'){
  accessGrants=accessGrants.filter(grant=>grant.id!=='fixture-extra');await route.fulfill({json:{revoked:true}});return;
 }
 if(url.pathname==='/api/auth/sessions'&&request.method()==='GET'){
  const response=await route.fetch(sessionCookie?{headers:{...await request.allHeaders(),cookie:sessionCookie}}:undefined);
  const data=await response.json();await route.fulfill({json:{...data,items:[...data.items,...extraSessions]}});return;
 }
 if(url.pathname==='/api/auth/sessions/fixture-session'&&request.method()==='DELETE'){
  extraSessions=[];await route.fulfill({json:{revoked:true}});return;
 }
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
  modeHint:document.querySelector('.search-modes .muted')?.textContent,transitions:window.__pageModeNavigation.transitions.length,hasTransitions:typeof document.startViewTransition==='function'}));
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
 assert.ok(actual.transitions.every(transition=>transition.modeHint===before.modeHint),'The outgoing search snapshot retains the old mode explanation');
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
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 const loginTransition=await transitionCount();
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const sessionState=await page.evaluate(async()=>{
  const response=await fetch('/api/auth/session');
  if(!response.ok)throw Error('Session check failed '+response.status);
  return response.json();
 });
 const activeSession=sessionState.session;
 assert.equal(activeSession.expiresAt-activeSession.createdAt,30*86400000,'Login starts with thirty-day inactivity expiry');
 const sessionCookie=(await context.cookies()).find(cookie=>cookie.name==='__Host-recalloom_session');
 assert.ok(sessionCookie?.httpOnly&&sessionCookie.secure);
 assert.ok(Math.abs(sessionCookie.expires*1000-activeSession.createdAt-90*86400000)<2000,'Cookie reaches the ninety-day absolute cap');
 await settledView(loginTransition);
 const stamp='page-primitives-'+Date.now();
 const folder=await api('/folders',{name:'Page primitives '+stamp});
 const make=name=>api('/records',{name:name+' '+stamp+'.md',kind:'document',folderId:folder.id,content:'# '+name+'\n\n**Page primitive regression.** [Readable link](https://example.test/long/path) and $P=UI$.'});
 const record=await make('Metadata'),fresh=await make('Search');

 console.log('PAGE STEP settings desktop');
 await page.goto(base+'/settings',{waitUntil:'networkidle'});
 const settings=page.getByRole('navigation',{name:'设置页面'});
 assert.equal(await settings.locator('[role="tab"]').count(),0,'Settings is route navigation rather than panel tabs');
 assert.equal(await settings.getByRole('link').count(),6);
 await page.evaluate(()=>{window.__pageSpaSentinel='retained';});
 const settingsTransition=await transitionCount();
 await settings.getByRole('link',{name:'Agent 授权',exact:true}).click();
 await page.waitForURL(base+'/settings/oauth');
 await settledView(settingsTransition);
 const settingsSnapshot=await page.evaluate(index=>window.__pageTransitions[index]?.content,settingsTransition);
 if(settingsSnapshot!==undefined){assert.ok(settingsSnapshot.includes('显示偏好'),'The outgoing settings snapshot retains the old panel');assert.ok(!settingsSnapshot.includes('已授权的 Agent'),'Destination content is committed inside the native transition');}
 assert.equal(await page.evaluate(()=>window.__pageSpaSentinel),'retained','Astryx links retain SPA navigation');
 assert.match(await settings.getByRole('link',{name:'Agent 授权',exact:true}).getAttribute('aria-current')??'',/^(page|true)$/);
 await page.getByText('测试 Agent · 知识库助手',{exact:true}).waitFor();
 await page.getByText('读取内容',{exact:true}).waitFor();
 await page.getByRole('button',{name:'撤销授权',exact:true}).waitFor();
 const grantRow=page.locator('.grant-row').filter({hasText:'测试 Agent · 知识库助手'});
 await grantRow.getByRole('button',{name:'授权详情',exact:true}).click();
 await grantRow.getByText('fixture-client',{exact:true}).waitFor();
 accessGrants.push({id:'fixture-extra',clientId:'extra-client',clientName:'第二个 Agent',scope:['notes:read'],createdAt:1794700000,expiresAt:null,redirectHost:'second.example.test'});
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 const extraGrant=page.locator('.grant-row').filter({hasText:'第二个 Agent'});
 await extraGrant.waitFor();
 assert.equal(await grantRow.getByRole('button',{name:'授权详情',exact:true}).getAttribute('aria-expanded'),'true','Adding a grant preserves expanded details');
 await extraGrant.getByRole('button',{name:'撤销授权',exact:true}).click();
 await page.getByRole('alertdialog',{name:'撤销 Agent 授权？',exact:true}).getByRole('button',{name:'撤销授权',exact:true}).click();
 await extraGrant.waitFor({state:'detached'});
 assert.equal(await grantRow.getByRole('button',{name:'授权详情',exact:true}).getAttribute('aria-expanded'),'true','Removing a grant preserves other rows');
 await page.screenshot({path:'tmp/settings-oauth-'+engine+'.png'});
 const activeTab=settings.getByRole('link',{name:'Agent 授权',exact:true});
 assert.ok(await activeTab.evaluate(el=>el.classList.contains('active')&&getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)'),'Current settings tab has a visible background');
 assert.equal(await settings.locator('a.active').count(),1,'Only the exact settings destination is highlighted');
 const sessionNav=await transitionCount();
 await settings.getByRole('link',{name:'登录会话',exact:true}).click();await page.waitForURL(base+'/settings/sessions');await settledView(sessionNav);
 await page.getByText('当前会话',{exact:true}).waitFor();
 const currentRow=page.locator('.session-row').filter({hasText:'当前会话'});
 await currentRow.getByRole('button',{name:'退出此会话',exact:true}).waitFor();
 await currentRow.getByRole('button',{name:'会话详情',exact:true}).click();
 await currentRow.getByText(/到期时间/).waitFor();
 const otherRow=page.locator('.session-row').filter({hasText:'Safari · iPhone'});
 await otherRow.getByRole('button',{name:'撤销会话',exact:true}).click();
 await page.getByRole('alertdialog',{name:'撤销登录会话？',exact:true}).getByRole('button',{name:'撤销会话',exact:true}).click();
 await otherRow.waitFor({state:'detached'});
 assert.equal(await currentRow.getByRole('button',{name:'会话详情',exact:true}).getAttribute('aria-expanded'),'true','Revoking another session preserves current details');
 await currentRow.getByRole('button',{name:'退出此会话',exact:true}).click({trial:true});
 await page.screenshot({path:'tmp/settings-sessions-'+engine+'.png'});
 console.log('PAGE STEP settings mobile resize');
 await page.setViewportSize({width:390,height:900});
 await noPageOverflow();
 const sessionButton=currentRow.getByRole('button',{name:'退出此会话',exact:true});
 assert.ok(await sessionButton.evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'Session action remains within the mobile viewport');
 await page.waitForTimeout(450);
 assert.ok(await sessionButton.evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.access-panel').getBoundingClientRect().bottom),'Session actions fit after their resize animation');
 await page.screenshot({path:'tmp/settings-sessions-mobile-'+engine+'.png'});
 await page.screenshot({path:'tmp/settings-sessions-mobile-'+engine+'.png'});
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
    const record={finished:false,error:null,modeHint:document.querySelector('.search-modes .muted')?.textContent};
    const transition=original(...args);
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
 const resultCard=result.locator('..');
 await resultCard.locator('.search-snippet').filter({hasText:'Readable link'}).waitFor();
 await resultCard.locator('.search-snippet strong').filter({hasText:'Page primitive regression.'}).waitFor();
 assert.equal(await resultCard.locator('.search-snippet .katex').count(),1,'Search renders formula markup');
 assert.ok(await resultCard.locator('.search-snippet a').count()>0,'Embedded previews preserve real document links');
 assert.equal(await result.locator('.search-snippet').count(),0,'Embedded content is outside the record navigation link');
 const summaryText=await resultCard.locator('.search-snippet').textContent();
 assert.ok(summaryText.includes('Readable link')&&summaryText.includes('P=UI'));
 assert.ok(!summaryText.includes('**')&&!summaryText.includes('https://')&&!summaryText.includes('$'),'Search displays readable Markdown summaries');
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

 console.log('PAGE STEP compact search previews');
 await page.route('**/api/search?**',async route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.get('query')!=='layout-preview'){await route.fallback();return;}
  await new Promise(resolve=>setTimeout(resolve,650));
  await route.fulfill({json:{items:url.searchParams.get('mode')==='metadata'?[]:[
   {id:fresh.id,name:'layout-preview.md',kind:'document',source:'literal',path:'/Projects/layout-preview.md',snippetFormat:'markdown',snippet:'# Search heading\n\n'+Array.from({length:16},(_,i)=>'Paragraph '+i+' with **bold content**, a [readable link](https://example.test), and layout-preview.').join('\n\n')},
   {id:record.id,name:'Semantic preview',kind:'document',source:'semantic',snippetFormat:'text',snippet:'layout-preview semantic text. '.repeat(90)},
   {id:record.id,name:'Description only',kind:'document',source:'metadata',description:'A long layout-preview description. '.repeat(100)},
   {id:'task-preview-fixture',name:'Task preview layout-preview',kind:'task_list',source:'literal',snippetFormat:'markdown',snippet:'{\"tasks\":[{\"title\":\"TRUNCATED_JSON'}
  ]}});
 });
 await page.route('**/api/tasks/view?**',async route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.get('recordId')!=='task-preview-fixture'){await route.fallback();return;}
  await new Promise(resolve=>setTimeout(resolve,700));
  await route.fulfill({json:{items:[
   {id:'preview-task-1',recordId:'task-preview-fixture',title:'Readable layout-preview task',details:'Structured task details',status:'in_progress'},
   {id:'preview-task-2',recordId:'task-preview-fixture',title:'Completed task',status:'done'}
  ],page:{hasMore:false,nextCursor:null},orderVersion:1}});
 });
 await page.goto(base+'/search?q=layout-preview',{waitUntil:'domcontentloaded'});
 await page.getByRole('status',{name:'正在搜索…',exact:true}).waitFor();
 const previewCard=page.locator('.search-result-card').filter({has:page.locator('a[href="/records/'+fresh.id+'"]')});
 await previewCard.getByRole('button',{name:'展开片段',exact:true}).waitFor();
 const clip=previewCard.locator('.search-snippet');
 const clipped=await clip.evaluate(el=>({height:el.getBoundingClientRect().height,mask:getComputedStyle(el).maskImage,truncated:el.hasAttribute('data-truncated')}));
 assert.ok(clipped.truncated&&clipped.height<=180&&clipped.mask.includes('linear-gradient'),JSON.stringify(clipped));
 assert.equal(await previewCard.locator('a a, a button').count(),0,'Preview controls are outside document links');
 const renderedHeading=previewCard.locator('.markdown-preview h1');
 assert.equal(await renderedHeading.evaluate(el=>getComputedStyle(el).fontSize),'25px','Search uses document heading typography');
 assert.equal(await previewCard.locator('.markdown-preview[data-embedded]').count(),1,'Search uses the shared embedded renderer');
 assert.ok(await previewCard.locator('.markdown-preview a[href="https://example.test"]').count()>0,'Search keeps real renderer links');
 const assertOverlay=async()=>{
  const geometry=await previewCard.evaluate(el=>{
   const clip=el.querySelector('.search-snippet').getBoundingClientRect();
   const button=el.querySelector('.search-result-footer button').getBoundingClientRect();
   return {center:Math.abs((button.left+button.right-clip.left-clip.right)/2),top:button.top,bottom:button.bottom,clipTop:clip.top,clipBottom:clip.bottom};
  });
  assert.ok(geometry.center<2&&geometry.top>=geometry.clipTop&&geometry.bottom<=geometry.clipBottom,JSON.stringify(geometry));
 };
 await assertOverlay();
 const taskPreview=page.locator('.search-result-card').filter({hasText:'Task preview layout-preview'});
 await taskPreview.getByRole('status',{name:'正在加载任务',exact:true}).waitFor();
 assert.ok(await taskPreview.getByRole('link',{name:'Task preview layout-preview',exact:true}).isVisible(),'Task list heading appears before details load');
 await taskPreview.getByText('Readable layout-preview task',{exact:true}).waitFor();
 assert.ok((await taskPreview.textContent()).includes('进行中')&&(await taskPreview.textContent()).includes('已完成'),'Task previews display task statuses');
 assert.ok(!(await taskPreview.textContent()).includes('TRUNCATED_JSON'),'Task previews never display truncated JSON');
 const beforeExpand=page.url();
 await previewCard.getByRole('button',{name:'展开片段',exact:true}).click();
 await page.waitForFunction(id=>document.getElementById(id)?.hasAttribute('data-expanded'),await clip.getAttribute('id'));
 assert.equal(page.url(),beforeExpand,'Expanding a snippet keeps the search page');
 await previewCard.getByRole('button',{name:'收起片段',exact:true}).click();
 await page.waitForFunction(id=>document.getElementById(id)?.hasAttribute('data-truncated'),await clip.getAttribute('id'));
 const semanticCard=page.locator('.search-result-card').filter({hasText:'Semantic preview'});
 assert.equal(await semanticCard.locator('.search-highlight').count(),0,'Semantic-only snippets do not imply exact matches');
 const descriptionCard=page.locator('.search-result-card').filter({hasText:'Description only'});
 await descriptionCard.getByRole('button',{name:'展开片段',exact:true}).waitFor();
 assert.equal(await descriptionCard.locator('.search-snippet').getAttribute('data-truncated'),'true','Long descriptions share the bounded preview');
 await page.waitForTimeout(350);
 await page.screenshot({path:'tmp/search-compact-'+engine+'.png'});
 await page.getByRole('radio',{name:'名称',exact:true}).click();
 await page.getByRole('heading',{name:'未找到结果',exact:true}).waitFor();
 await page.getByRole('radio',{name:'智能',exact:true}).click();
 await previewCard.getByRole('button',{name:'展开片段',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:900});
 await noPageOverflow();
 assert.ok(await clip.evaluate(el=>el.getBoundingClientRect().height<=140),'Mobile snippets use a compact preview height');
 await page.waitForTimeout(450);
 await assertOverlay();
 await page.screenshot({path:'tmp/search-compact-mobile-'+engine+'.png'});

 console.log('PAGE STEP graph');
 emptyGraph=true;
 await page.goto(base+'/graph',{waitUntil:'networkidle'});
 const empty=page.locator('.graph-empty .astryx-empty-state');
 await empty.waitFor();
 assert.equal(await empty.getByRole('heading',{name:'暂无可显示的文稿'}).count(),1);
 for(const width of [1365,390]){
  await page.setViewportSize({width,height:900});
  const appearance=await empty.evaluate(element=>({height:element.getBoundingClientRect().height,
   size:getComputedStyle(element.querySelector('.astryx-empty-state-title')).fontSize,
   weight:getComputedStyle(element.querySelector('.astryx-empty-state-title')).fontWeight}));
  assert.ok(appearance.height>0&&parseFloat(appearance.size)>=14,JSON.stringify(appearance));
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
