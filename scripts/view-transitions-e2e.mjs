/** Cross-browser atomic route crossfade in an isolated local Worker/D1. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Only isolated localhost tests are allowed');
const engine=process.env.RECALLOOM_TEST_ENGINE==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'
 ?[process.env.RECALLOOM_BROWSER_PATH,
   'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
   'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x)):undefined;
const secretLine=existsSync('.dev.vars')
 ?readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x)):undefined;
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local test secret is required');
const browser=await (engine==='webkit'?webkit:chromium).launch({
 headless:true,...(executable?{executablePath:executable}:{})
});
const mobileRun=process.env.RECALLOOM_TEST_MOBILE==='1';
const narrowMobile=process.env.RECALLOOM_TEST_MOBILE_WIDTH==='320';
const page=await browser.newPage({viewport:mobileRun?(narrowMobile?{width:320,height:568}:{width:390,height:844}):{width:1365,height:900},isMobile:mobileRun,hasTouch:mobileRun});
page.setDefaultTimeout(25000);
// WebKit refuses production __Host- Secure cookies over plain HTTP.
// For this isolated 127.0.0.1 test only, retain the login response cookie
// in this Node.js process and forward it in later API requests. Production
// cookie generation, CSRF checks and authorization remain unchanged.
if(engine==='webkit'){
 let sessionCookie='';
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(request.url().endsWith('/api/auth/login')){
   const response=await route.fetch();
   const cookie=response.headers()['set-cookie']??'';
   const match=/^(__Host-recalloom_session=[^;]+)/.exec(cookie);
   if(match)sessionCookie=match[1];
   await route.fulfill({response});
   return;
  }
  if(!sessionCookie){await route.continue();return;}
  const headers=await request.allHeaders();
  headers.cookie=sessionCookie;
  const response=await route.fetch({headers});
  await route.fulfill({response});
 });
}

await page.addInitScript(()=>{
 const names=()=>[...document.querySelectorAll('*')].map(el=>getComputedStyle(el).viewTransitionName)
  .filter(n=>n!=='none'&&n!=='root');
 window.__rkVTLog=[];
 if(typeof document.startViewTransition==='function'){
  const original=document.startViewTransition.bind(document);
  document.startViewTransition=(...args)=>{
   const record={old:names(),new:null,ready:false,finished:false,error:null};
   window.__rkVTLog.push(record);
   const transition=original(...args);
   transition.updateCallbackDone.then(()=>{
    record.new=names();
   },error=>{record.error=String(error);});
   transition.ready.then(()=>{record.ready=true;},error=>{record.error=String(error);});
   transition.finished.then(()=>{record.finished=true;},error=>{record.error=String(error);});
   return transition;
  };
 }
});
const faults=[];
page.on('pageerror',error=>faults.push(error.message));
const create=async(path,data)=>page.evaluate(async({path,data})=>{
 const result=await fetch('/api'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 const json=await result.json();
 if(!result.ok)throw Error(path+' '+result.status+' '+JSON.stringify(json));
 return json;
},{path,data});
const vtName=locator=>locator.evaluate(el=>getComputedStyle(el).viewTransitionName);
const activeNames=()=>page.evaluate(()=>[...document.querySelectorAll('*')].map(el=>getComputedStyle(el).viewTransitionName).filter(n=>n!=='none'&&n!=='root'));
const assertUnique=async()=>{
 const names=await activeNames();
 assert.deepEqual(names,['rk-route-content'],'no shared title name may remain after a transition: '+JSON.stringify(names));
};
const count=()=>page.evaluate(()=>window.__rkVTLog.length);
const assertRouteTransition=async(since,{expectPair=false,expectFallback=false}={})=>{
 await page.waitForFunction(n=>window.__rkVTLog.length>n,since);
 await page.waitForFunction(()=>window.__rkVTLog.at(-1)?.new!==null);
 const result=await page.evaluate(()=>window.__rkVTLog.at(-1));
 assert.ok(result.old.includes('rk-route-content')&&result.new.includes('rk-route-content'),
  'the fixed route viewport must continue to crossfade');
 assert.deepEqual(result.new,result.old,
  'the paired title must be captured on BOTH sides: '+JSON.stringify(result));
 assert.equal(new Set(result.old).size,result.old.length,'snapshot names must be unique');
 // Narrow 320px layouts can truncate a source label, deliberately falling
 // back to the full-page crossfade instead of morphing clipped text.
 if(expectPair&&!narrowMobile)assert.ok(result.old.includes('rk-shared-title'),'expected a matched resource title: '+JSON.stringify(result));
 if(expectFallback)assert.deepEqual(result.old,['rk-route-content'],'other navigation must use the original crossfade');
 assert.equal(result.error,null,'native transition was skipped');
 // Avoid racing a still-active WebKit snapshot when testing the next click.
 await page.waitForFunction(()=>window.__rkVTLog.at(-1)?.finished===true);
 await page.waitForFunction(()=>document.querySelectorAll('[data-rk-vt-active="true"]').length===0);
 return result;
};
const assertTextInPage=async(locator)=>assert.equal(await vtName(locator),'none','text must fade together with its parent viewport');
const canMorphCurrentHeader=()=>page.locator('.doc-header [data-rk-vt-kind]').first().evaluate(el=>{
 const lh=parseFloat(getComputedStyle(el).lineHeight);
 return el.scrollWidth<=el.clientWidth+1&&(!Number.isFinite(lh)||el.getBoundingClientRect().height<=lh*1.55);
});
const assertShell=async()=>{
 const computed=await page.evaluate(()=>{
  const css=(part)=>getComputedStyle(document.documentElement,part);
  return {
   html:getComputedStyle(document.documentElement).viewTransitionName,
   route:getComputedStyle(document.querySelector('.main-scroll-host')).viewTransitionName,
   sidebar:getComputedStyle(document.querySelector('.sidebar')).viewTransitionName,
   topbar:getComputedStyle(document.querySelector('.topbar')).viewTransitionName,
   bottom:getComputedStyle(document.querySelector('.bottom-nav')).viewTransitionName,
   oldFade:css('::view-transition-old(rk-route-content)').animationDuration,
   newFade:css('::view-transition-new(rk-route-content)').animationDuration
  };
 });
 assert.equal(computed.html,'none','app shell must remain live instead of becoming a root snapshot');
 assert.equal(computed.route,'rk-route-content','only the fixed scroll viewport should crossfade');
 assert.equal(computed.sidebar,'none');
 assert.equal(computed.topbar,'none');
 assert.equal(computed.bottom,'none');
 assert.ok(parseFloat(computed.oldFade)>0,'old content must fade out');
 assert.ok(parseFloat(computed.newFade)>0,'new content must fade in');
};
const folderPage=async(folder)=>{
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{name:folder.name,level:1}).waitFor();
};
const recordPage=async(record)=>{
 await page.waitForURL(base+'/records/'+record.id);
 await page.locator('.record-page h1.page-title').waitFor();
};

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const suffix=String(Date.now());
 const folder=await create('/folders',{name:'0 Transition audit '+suffix});
 const basic=await create('/records',{name:'0 Native transition '+suffix,kind:'document',folderId:folder.id,content:'A document without a heading.\n'});
 const markdownNamed=await create('/records',{name:'0 Clean label '+suffix+'.md',kind:'document',folderId:folder.id,content:'# Body heading\n'});
 const promoted=await create('/records',{name:'1 With heading '+suffix,kind:'document',folderId:folder.id,content:'# Promoted content title\n\nBody text.\n'});
 const task=await create('/records',{name:'2 RMD task list '+suffix,kind:'task_list',folderId:folder.id,content:''});
 const nested=await create('/folders',{name:'3 Journal '+suffix,parentId:folder.id});
 const animationFolder=await create('/folders',{name:'4 Tree animation '+suffix});
 await create('/folders',{name:'Child of animation folder '+suffix,parentId:animationFolder.id});
 // A real task and activity rows let the refresh regression assert that the
 // page mounts final content directly, without a second animated resize.
 await page.evaluate(async recordId=>{
  const revisionResponse=await fetch('/api/records/'+recordId+'?metadataOnly=true');
  const {revision}=await revisionResponse.json();
  const result=await fetch('/api/tasks/mutate',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({action:'add',recordId,expectedRevision:revision,
    changes:{title:'Route stability test task',status:'todo',priority:3}})});
  if(!result.ok)throw Error('Failed to prepare a task for the refresh regression: '+await result.text());
 },task.id);

 await page.goto(base+'/library');
 const folderRow=page.locator('.file-row').filter({hasText:folder.name});
 await folderRow.waitFor();
 // Wait until the list's 300ms staggered entrance is complete before capture.
 await page.waitForTimeout(470);
 await assertShell();
 await assertTextInPage(folderRow.locator('.file-row-title').first());
 await assertUnique();
 let before=await count();
 await folderRow.click();
 await folderPage(folder);
 await assertRouteTransition(before,{expectPair:true});
 await assertTextInPage(page.locator('.folder-page h1.page-title'));
 await assertShell();

 // History back MUST crossfade the entire content without any click handler.
 // A wrapped phone heading must safely fall back instead of morphing a
 // two-line title snapshot into the single-line list row.
 const canMorphFolderBack=await page.locator('.folder-page h1.page-title').evaluate(el=>{
  const lh=parseFloat(getComputedStyle(el).lineHeight);
  return el.scrollWidth<=el.clientWidth+1&&(!Number.isFinite(lh)||el.getBoundingClientRect().height<=lh*1.55);
 });
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/library');
 await folderRow.waitFor();
 await assertRouteTransition(before,canMorphFolderBack?{expectPair:true}:{expectFallback:true});
 await assertUnique();

 // Browser forward restores the same pair once the list's entrance settles.
 await page.waitForTimeout(350);
 before=await count();
 await page.goForward();
 await folderPage(folder);
 await assertRouteTransition(before,{expectPair:true});

 const basicRow=page.locator('.file-row').filter({hasText:basic.name});
 await assertTextInPage(basicRow.locator('.file-row-title').first());
 assert.equal(await basicRow.locator('.file-row-title').innerText(),basic.name,
  'only the clean filename may participate in sharing');
 assert.equal(await basicRow.locator('.file-row-extension').innerText(),'.md',
  'the Markdown extension stays in a separate element');
 assert.equal(await vtName(basicRow.locator('.file-row-extension')),'none',
  'the .md extension must stay in the full-page fade');
 await assertUnique();

 // The old 600ms loader cap could commit a Skeleton while this request was
 // still pending. Keep the previous folder visible instead of snapshotting it.
 let delayedRequestSeen=false;
 await page.route('**/api/records/'+basic.id,async route=>{
  delayedRequestSeen=true;
  await new Promise(resolve=>setTimeout(resolve,1700));
  await route.continue();
 },{times:1});
 before=await count();
 const click=basicRow.click();
 await page.waitForTimeout(900);
 assert.equal(delayedRequestSeen,true,'slow record fixture was not intercepted');
 assert.equal(await page.locator('.doc-skeleton-title').count(),0,'a loading skeleton replaced the current page');
 assert.ok(await page.locator('.folder-page h1.page-title').isVisible(),'the old folder must remain visible while record data loads');
 await click;
 await recordPage(basic);
 await assertRouteTransition(before,{expectPair:true});
 await assertTextInPage(page.locator('.record-page h1.page-title'));
 const basicBackPair=await canMorphCurrentHeader();
 before=await count();
 await page.goBack();
 await folderPage(folder);
 await assertRouteTransition(before,basicBackPair?{expectPair:true}:{expectFallback:true});
 await assertTextInPage(page.locator('.file-row').filter({hasText:basic.name}).locator('.file-row-title').first());

 // Persisted .md names are split into exactly two inline elements; only the
 // base name travels to the document heading, not the extension.
 const markdownRow=page.locator('.file-row').filter({hasText:markdownNamed.name});
 const pureName=markdownNamed.name.slice(0,-3);
 assert.equal(await markdownRow.locator('.file-row-title').innerText(),pureName);
 assert.equal(await markdownRow.locator('.file-row-extension').innerText(),'.md');
 assert.equal(await markdownRow.locator('.file-row-extension').count(),1);
 await page.waitForTimeout(350);
 before=await count();
 await markdownRow.click();
 await recordPage(markdownNamed);
 await page.getByRole('heading',{name:pureName,level:1}).waitFor();
 await assertRouteTransition(before,{expectPair:true});
 const markdownBackPair=await canMorphCurrentHeader();
 before=await count();
 await page.goBack();
 await folderPage(folder);
 await assertRouteTransition(before,markdownBackPair?{expectPair:true}:{expectFallback:true});

 // The exact layout families from the two user screenshots.
 for(const entry of [task,nested]){
  const kind=entry===task?'record':'folder';
  await assertUnique();
  await page.waitForTimeout(360);
  before=await count();
  await page.locator('.file-row').filter({hasText:entry.name}).click();
  if(kind==='record')await recordPage(entry);else await folderPage(entry);
  await assertRouteTransition(before,{expectPair:true});
  const entryBackPair=await canMorphCurrentHeader();
  before=await count();
  await page.goBack();
  await folderPage(folder);
  await assertRouteTransition(before,entryBackPair?{expectPair:true}:{expectFallback:true});
 }

 // Document filenames remain the header identity; the H1 stays in the body.
 await page.waitForTimeout(360);
 before=await count();
 await page.locator('.file-row').filter({hasText:promoted.name}).click();
 await recordPage(promoted);
 await page.locator('.workbench-header h1.page-title').waitFor();
 await assertRouteTransition(before,{expectPair:true});

 await assertTextInPage(page.locator('.workbench-header h1.page-title'));
 await assertUnique();

 if(!mobileRun){
  await page.getByRole('button',{name:'详细信息'}).click();
  const inspector=page.getByRole('dialog',{name:'文档检查器'});
  await inspector.getByRole('tab',{name:'目录'}).click();
  assert.equal(await inspector.locator('.workbench-tab-indicator').count(),1);
  await inspector.getByRole('button',{name:'关闭',exact:true}).click();
  await inspector.waitFor({state:'hidden'});
 }

 // A desktop topbar portal appears on the record page but not on home.
 // It must never resize or displace the animated scroll viewport.
 await page.goto(base+'/');
 const recent=page.locator('.recent-page').filter({hasText:promoted.name}).first();
 await recent.waitFor();
 await assertTextInPage(recent.locator('.recent-page-name'));
 if(!mobileRun){
  // A page without a topbar still owns a full-height spacing region INSIDE
  // the scrollable content. It must not be a fixed empty header.
  const spacing=await page.locator('.home-page').evaluate(async el=>{
   const viewport=document.querySelector('.main-scroll');
   const top=parseFloat(getComputedStyle(el).paddingTop);
   const originalHeight=el.style.minHeight;
   const beforeY=el.getBoundingClientRect().y;
   el.style.minHeight='1600px';
   viewport.scrollTop=80;
   await new Promise(requestAnimationFrame);
   const moved=beforeY-el.getBoundingClientRect().y;
   viewport.scrollTop=0;
   el.style.minHeight=originalHeight;
   await new Promise(requestAnimationFrame);
   return {top,moved};
  });
  assert.equal(spacing.top,96,'all desktop pages must share the preview/workbench first-content baseline');
  assert.ok(Math.abs(spacing.moved-80)<=2,'home top spacing must scroll away with the content');
  // Ordinary routes and library folders use the same first-content baseline
  // as document preview. Switching pages must not add another header margin.
  for(const route of ['/','/tasks','/activity','/archive','/search','/settings','/library','/graph']){
   await page.goto(base+route);
   const heading=page.locator('.page > .page-header, .folder-page > .doc-header, .knowledge-graph-page > .graph-page-heading').first();
   await heading.waitFor();
   const top=await heading.evaluate(el=>el.getBoundingClientRect().top);
   assert.ok(Math.abs(top-96)<=2,'inconsistent desktop first-content baseline '+route+': '+top);
  }
  await page.goto(base+'/');
  await recent.waitFor();
 }
 const viewportBox=async()=>page.locator('.main-scroll-host').evaluate(el=>{
  const {x,y,width,height}=el.getBoundingClientRect();
  return {x,y,width,height};
 });
 const homeBox=await viewportBox();
 await page.waitForTimeout(410);
 const canMorphRecent=await recent.locator('.rk-shared-text').evaluate(el=>{
  const lh=parseFloat(getComputedStyle(el).lineHeight);
  return el.scrollWidth<=el.clientWidth+1&&(!Number.isFinite(lh)||el.getBoundingClientRect().height<=lh*1.55);
 });
 before=await count();
 await recent.click();
 await recordPage(promoted);
 await assertRouteTransition(before,canMorphRecent?{expectPair:true}:{expectFallback:true});
 if(!mobileRun)assert.deepEqual(await viewportBox(),homeBox,'opening a portal must not move or resize the snapshot viewport');
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/');
 await recent.waitFor();
 await assertRouteTransition(before);
 if(!mobileRun)assert.deepEqual(await viewportBox(),homeBox,'closing a portal must not move or resize the snapshot viewport');

 await page.goto(base+'/search?q='+encodeURIComponent(promoted.name)+'&mode=metadata');
 const hit=page.locator('.search-result').filter({hasText:promoted.name}).first();
 await hit.waitFor();
 await assertTextInPage(hit.locator('strong').first());
 await page.waitForTimeout(410);
 const canMorphSearch=await hit.locator('.rk-shared-text').evaluate(el=>{
  const lh=parseFloat(getComputedStyle(el).lineHeight);
  return el.scrollWidth<=el.clientWidth+1&&(!Number.isFinite(lh)||el.getBoundingClientRect().height<=lh*1.55);
 });
 before=await count();
 await hit.click();
 await recordPage(promoted);
 await assertRouteTransition(before,canMorphSearch?{expectPair:true}:{expectFallback:true});
 before=await count();
 await page.goBack();
 await page.waitForURL(/\/search\?/);
 await hit.waitFor();
 await assertRouteTransition(before);


 // Search submit must commit immediately and display loading feedback while
 // the API is deliberately slow. Route loader must not await search results.
 if(engine==='chromium'&&!mobileRun){
  await page.goto(base+'/search?mode=literal');
  await page.locator('.search-page').waitFor();
  const slowTerm='latency-probe-'+suffix;
  await page.evaluate(term=>{
   const original=window.fetch.bind(window);
   window.__searchRequestFinished=false;
   window.__restoreSearchFetch=()=>{window.fetch=original;};
   window.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);
    if(url.includes('/api/search?')&&url.includes(encodeURIComponent(term))){
     await new Promise(resolve=>setTimeout(resolve,1250));
     const response=await original(input,init);
     window.__searchRequestFinished=true;
     return response;
    }
    return original(input,init);
   };
  },slowTerm);
  await page.getByRole('textbox',{name:'搜索关键字'}).fill(slowTerm);
  await page.getByRole('button',{name:'搜索',exact:true}).click();
  await page.waitForURL(url=>new URL(url).searchParams.get('q')===slowTerm);
  assert.equal(await page.evaluate(()=>window.__searchRequestFinished),false,
   'URL must update before the slow search request completes');
  await page.locator('.content-loading').waitFor({state:'visible',timeout:1000});
  await page.locator('.content-loading').waitFor({state:'hidden',timeout:10000});
  assert.equal(await page.evaluate(()=>window.__searchRequestFinished),true);
  await page.evaluate(()=>window.__restoreSearchFetch());
  // A completed search still animates the result rows, not just the spinner.
  await page.goto(base+'/search?q='+encodeURIComponent(promoted.name)+'&mode=metadata');
  await page.locator('.search-result').first().waitFor();
  assert.equal(await page.locator('.search-result').first().evaluate(el=>getComputedStyle(el).animationName),
   'data-row-fade-in','search results retain their staggered entrance animation');
 }

 // Cold refreshes should not animate data-loading states as a second page
 // swap: the final rows must be direct children, as on the archive route.
 if(!mobileRun){
  const requests=[];
  const recordRequest=request=>{
   const {pathname}=new URL(request.url());
   if(pathname==='/api/tasks'||pathname==='/api/activity')requests.push(pathname);
  };
  page.on('request',recordRequest);
  await page.goto(base+'/');
  await page.locator('.home-card > .compact-row').first().waitFor();
  await page.locator('.home-card > .recent-entry').first().waitFor();
  assert.equal(await page.locator('.home-card > .compact-row').count()>0,true,'home tasks must render without a secondary animated wrapper');
  assert.equal(await page.locator('.home-card > .recent-entry').count()>0,true,'home activity must render without a secondary animated wrapper');
  await page.waitForTimeout(400);
  assert.equal(requests.filter(path=>path==='/api/tasks').length,1,'home must load tasks only once');
  assert.equal(requests.filter(path=>path==='/api/activity').length,1,'home must load activity only once');
  page.off('request',recordRequest);

  await page.goto(base+'/tasks');
  await page.locator('.page > .task-list .task-item').first().waitFor();
  const taskRequests=[];
  const spyTasks=request=>{
   if(new URL(request.url()).pathname==='/api/tasks')taskRequests.push(request.url());
  };
  page.on('request',spyTasks);
  // Lazy OverlayScrollbars used to re-parent the viewport after CSS row
  // animations had already run. Delay its import and prove one animation.
  await page.addInitScript(()=>{
   window.__rkRowStartup={starts:[],viewportMoves:[]};
   document.addEventListener('animationstart',event=>{
    if(event.target.matches?.('.task-list .task-item')&&event.animationName==='data-row-fade-in')
     window.__rkRowStartup.starts.push(Math.round(performance.now()));
   },true);
   const monitor=()=>{
    const observer=new MutationObserver(records=>{
     for(const record of records)for(const node of record.removedNodes){
      if(node.nodeType===1&&(node.matches?.('.main-scroll')||node.querySelector?.('.main-scroll')))
       window.__rkRowStartup.viewportMoves.push(Math.round(performance.now()));
     }
    });
    observer.observe(document,{childList:true,subtree:true});
   };
   if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',monitor,{once:true});
   else monitor();
  });
  let overlayChunkDelivered=false;
  if(engine==='chromium')await page.route('**/assets/overlayscrollbars-*.js',async route=>{
   await new Promise(resolve=>setTimeout(resolve,1500));
   overlayChunkDelivered=true;
   await route.continue();
  });
  await page.reload({waitUntil:'domcontentloaded'});
  if(engine==='chromium'){
   // Authentication / connection UI paints before the optional module arrives,
   // but scroll viewports must not mount until their engine is ready.
   await page.locator('.center-screen').waitFor({state:'visible'});
   assert.equal(overlayChunkDelivered,false,'React must paint before the scrollbar chunk resolves');
   assert.equal(await page.locator('.shell').count(),0,'scroll shell must wait for the engine');
  }
  await page.locator('.page > .task-list .task-item').first().waitFor();
  await page.waitForTimeout(800);
  const startup=await page.evaluate(()=>({
   ...window.__rkRowStartup,
   animation:getComputedStyle(document.querySelector('.page .task-list .task-item')).animationName
  }));
  assert.equal(startup.animation,'data-row-fade-in','the staggered entrance animation must remain enabled');
  assert.equal(startup.starts.length,1,'each task row must animate only once: '+JSON.stringify(startup));
  if(engine==='chromium'){
   assert.ok(startup.viewportMoves.length>0,'overlay scrollbars must initialize the scroll viewport');
   assert.ok(startup.viewportMoves.every(t=>t<=startup.starts[0]),
    'scrollbars must re-parent BEFORE row animations: '+JSON.stringify(startup));
   await page.unroute('**/assets/overlayscrollbars-*.js');
  }
  page.off('request',spyTasks);
  assert.equal(taskRequests.length,1,'task page refresh must request its items only once');

  await page.goto(base+'/activity');
  await page.locator('.page > .activity-list').waitFor();
  const activityRequests=[];
  const spyActivity=request=>{
   if(new URL(request.url()).pathname==='/api/activity')activityRequests.push(request.url());
  };
  page.on('request',spyActivity);
  await page.reload();
  await page.locator('.page > .activity-list').waitFor();
  await page.waitForTimeout(350);
  page.off('request',spyActivity);
  assert.equal(activityRequests.length,1,'activity page refresh must request its items only once');

  // Archive is the baseline: it never owned an animated data-state wrapper.
  await page.goto(base+'/archive');
  await page.getByRole('heading',{name:'归档',level:1}).waitFor();
  await page.reload();
  await page.getByRole('heading',{name:'归档',level:1}).waitFor();

  // A newly opened sidebar folder must stay collapsed while its children
  // fetch, then animate its real rows. Closing retains DOM until the grid
  // transition finishes; restored open folders follow the same path.
  await page.goto(base+'/');
  const toggle=page.getByRole('button',{name:'展开 '+animationFolder.name});
  await toggle.waitFor();
  // Anchor to the stable row, not a toggle whose accessible name changes on click.
  const branch=page.locator('.page-tree .tree-row').filter({hasText:animationFolder.name}).first()
   .locator('xpath=following-sibling::div[contains(@class,"tree-branch-region")]');
  let delayedBrowse=false;
  await page.route('**/api/folders?*',async route=>{
   if(new URL(route.request().url()).searchParams.get('parentId')!==animationFolder.id){await route.fallback();return;}
   delayedBrowse=true;
   await new Promise(resolve=>setTimeout(resolve,700));
   // Keep the WebKit loopback session cookie handler in the routing chain.
   await route.fallback();
  });
  await toggle.click();
  await page.waitForTimeout(180);
  assert.equal(delayedBrowse,true,'tree folder API should be delayed by the fixture');
  assert.equal(await branch.getAttribute('data-loading'),'true','folder should indicate pending data');
  assert.equal(await branch.getAttribute('data-visible'),'false','folder must not expand a temporary loader row');
  assert.equal(await branch.locator('ul.tree-list').count(),0,'folder children must wait for data');
  await page.waitForFunction(name=>{
   const button=[...document.querySelectorAll('.tree-toggle')].find(el=>el.getAttribute('aria-label')==='收起 '+name);
   return button?.parentElement?.nextElementSibling?.getAttribute('data-visible')==='true';
  },animationFolder.name);
  await branch.locator('.tree-list').first().waitFor({state:'attached'});
  await page.waitForTimeout(300);
  const treeMetrics=await branch.evaluate(el=>{
   const inner=el.querySelector('.tree-branch-inner'),list=el.querySelector('.tree-list');
   const rect=node=>node?{y:node.getBoundingClientRect().y,height:node.getBoundingClientRect().height}:null;
   return {visible:el.dataset.visible,grid:getComputedStyle(el).gridTemplateRows,
    opacity:getComputedStyle(el).opacity,outer:rect(el),inner:rect(inner),list:rect(list)};
  });
  assert.ok(treeMetrics.outer.height>0,'folder content must be laid out after expansion: '+JSON.stringify(treeMetrics));
  await page.getByRole('button',{name:'收起 '+animationFolder.name}).click();
  await page.waitForTimeout(45);
  assert.equal(await branch.getAttribute('data-visible'),'false');
  assert.ok(await branch.locator('ul.tree-list').count()>0,'collapse must retain rows while the animation runs');
  await page.waitForTimeout(310);
  assert.equal(await branch.locator('ul.tree-list').count(),0,'collapsed children must be released after animation');

  await page.getByRole('button',{name:'展开 '+animationFolder.name}).click();
  await page.waitForFunction(name=>{
   const button=[...document.querySelectorAll('.tree-toggle')].find(el=>el.getAttribute('aria-label')==='收起 '+name);
   return button?.parentElement?.nextElementSibling?.getAttribute('data-visible')==='true';
  },animationFolder.name);
  // End the artificial API delay before full navigation; WebKit otherwise
  // reports an aborted intercepted fetch as an access-control pageerror.
  await page.unroute('**/api/folders?*');
  await page.reload();
  await page.getByRole('button',{name:'收起 '+animationFolder.name}).waitFor();
  await page.waitForFunction(name=>{
   const button=[...document.querySelectorAll('.tree-toggle')].find(el=>el.getAttribute('aria-label')==='收起 '+name);
   return button?.parentElement?.nextElementSibling?.getAttribute('data-visible')==='true';
  },animationFolder.name);
  await branch.locator('ul.tree-list').first().waitFor();
 }

 // Mobile top/bottom shell stays live, outside the route snapshot, on WebKit.
 // Avoid resizing the active WebKit page in this regression test.
 // Use a fresh mobile-sized WebKit browser session instead.
 if(engine!=='webkit'||mobileRun){
  if(!mobileRun)await page.setViewportSize({width:390,height:844});
  await assertShell();
  // View Transition snapshots live in a browser top layer above ordinary
  // z-index. The route snapshot must not overlap the live fixed tab bar,
  // otherwise its fading content visually erases the tab icons and labels.
  const assertLiveMobileTabBar=async()=>{
   const geometry=await page.evaluate(()=>{
    const snapshot=document.querySelector('.main-scroll-host').getBoundingClientRect();
    const tabs=document.querySelector('.bottom-nav').getBoundingClientRect();
    const tabStyle=getComputedStyle(document.querySelector('.bottom-nav'));
    return {snapshotBottom:snapshot.bottom,tabsTop:tabs.top,
     tabsBottom:tabs.bottom,height:tabs.height,opacity:tabStyle.opacity,
     display:tabStyle.display,background:tabStyle.backgroundColor};
   });
   assert.equal(geometry.display,'grid','mobile tab bar must be rendered');
   assert.equal(geometry.opacity,'1','live tab bar must not fade with page transitions');
   assert.ok(geometry.snapshotBottom<=geometry.tabsTop+1,
    'route snapshot must stop BEFORE live bottom tabs: '+JSON.stringify(geometry));
  };
  await assertLiveMobileTabBar();
 await page.goto(base+'/library');
 const mobileFolder=page.locator('.file-row').filter({hasText:folder.name});
 await mobileFolder.waitFor();
 await assertLiveMobileTabBar();
 await assertUnique();
 before=await count();
 await mobileFolder.click();
 await folderPage(folder);
 await assertRouteTransition(before);
 await assertShell();
 await assertLiveMobileTabBar();
 assert.ok(await page.locator('.bottom-nav').isVisible(),'mobile bottom navigation remains visible');
 // Return navigation must keep the fixed tabs outside the screenshot as well.
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/library');
 await assertRouteTransition(before);
 await assertLiveMobileTabBar();
 if(mobileRun){
  // Mobile keyboard focus hides tabs; regain that scroll space on focus.
  await page.goto(base+'/library/'+folder.id);
  await page.locator('.file-row').filter({hasText:basic.name}).click();
  await recordPage(basic);
  const title=page.locator('.record-page .page-title');
  await title.focus();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.bottom-nav')).display==='none');
  const focused=await page.evaluate(()=>({
   viewportBottom:document.querySelector('.main-scroll-host').getBoundingClientRect().bottom,
   screenHeight:innerHeight
  }));
  assert.ok(Math.abs(focused.viewportBottom-focused.screenHeight)<=1,
   'editor focus must recover the space used by hidden tabs: '+JSON.stringify(focused));
  await title.blur();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.bottom-nav')).display==='grid');
  await assertLiveMobileTabBar();
 }
 const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 assert.ok(size.scrollWidth<=size.width+1,'mobile horizontal overflow '+JSON.stringify(size));
 }

 // Reduced motion: transition may still run but no long screenshot animation.
 await page.emulateMedia({reducedMotion:'reduce'});
 const durations=await page.evaluate(()=>{
  const old=getComputedStyle(document.documentElement,'::view-transition-old(rk-route-content)');
  const newer=getComputedStyle(document.documentElement,'::view-transition-new(rk-route-content)');
  return [old.animationDuration,newer.animationDuration];
 });
 assert.ok(durations.every(duration=>parseFloat(duration)<=0.001),'reduce motion animation durations '+JSON.stringify(durations));
 if(engine==='chromium'){
  // The login page is interactive without fetching the optional scrollbar
  // chunk at all. Its first render must not be held by scroll initialization.
  const loginContext=await browser.newContext();
  try{
   const loginPage=await loginContext.newPage();
   const loginChunkRequests=[];
   loginPage.on('request',request=>{
    if(new URL(request.url()).pathname.includes('/assets/overlayscrollbars-'))loginChunkRequests.push(request.url());
   });
   await loginPage.goto(base+'/login',{waitUntil:'domcontentloaded'});
   await loginPage.getByPlaceholder('输入 MCP_AUTH_SECRET').waitFor();
   await loginPage.waitForTimeout(200);
   assert.deepEqual(loginChunkRequests,[],'login must not download or await the scrollbar engine');
  }finally{await loginContext.close();}

  // An optional scrollbar chunk must never be a single point of failure.
  // If it cannot download, render the authenticated page using native bars.
  const fallbackContext=await browser.newContext();
  await fallbackContext.addCookies(await page.context().cookies(base));
  const failurePage=await fallbackContext.newPage();
  try{
   await failurePage.route('**/assets/overlayscrollbars-*.js',route=>route.abort('failed'));
   await failurePage.goto(base+'/tasks',{waitUntil:'domcontentloaded'});
   await failurePage.locator('.page > .task-list .task-item').first().waitFor();
   const fallback=await failurePage.evaluate(()=>({
    mode:document.documentElement.dataset.scrollbarMode,
    width:getComputedStyle(document.querySelector('.main-scroll')).scrollbarWidth,
    hasShell:Boolean(document.querySelector('.shell'))
   }));
   assert.equal(fallback.mode,'native','failed overlay module must fall back to native scrollbars');
   assert.equal(fallback.hasShell,true,'authenticated app must remain usable on chunk failure');
   assert.notEqual(fallback.width,'none','native scrollbar must not be hidden by the overlay CSS policy');

   // A stalled resource must also become usable after the bounded bootstrap
   // timeout, even if the optional overlay chunk is never delivered.
   const stalledPage=await fallbackContext.newPage();
   await stalledPage.route('**/assets/overlayscrollbars-*.js',async route=>{
    await new Promise(resolve=>setTimeout(resolve,5000));
    await route.continue().catch(()=>undefined);
   });
   await stalledPage.goto(base+'/tasks',{waitUntil:'domcontentloaded'});
   await stalledPage.locator('.page > .task-list .task-item').first().waitFor({timeout:6500});
   const mode=await stalledPage.evaluate(()=>document.documentElement.dataset.scrollbarMode);
   assert.equal(mode,'native','stalled overlay module must fall back to native scrollbars');
  }finally{await fallbackContext.close();}
 }
 assert.deepEqual(faults,[],'no browser runtime faults');
 console.log('PASS atomic route View Transitions ('+engine+'): forward/back, live shell, text, slow data, mobile and reduced-motion');
}finally{await browser.close();}
