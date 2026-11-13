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
const page=await browser.newPage({viewport:mobileRun?{width:390,height:844}:{width:1365,height:900}});
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
const faults=[],failedScripts=[];
page.on('pageerror',error=>faults.push({message:error.message,url:page.url(),stack:error.stack?.slice(0,450)}));
page.on('requestfailed',request=>{
 if(/\/assets\/.*\.js/.test(request.url()))failedScripts.push({
  url:request.url(),reason:request.failure()?.errorText,page:page.url()
 });
});
page.on('response',response=>{
 if(response.status()>=400&&/\/assets\/.*\.js/.test(response.url()))
  failedScripts.push({url:response.url(),status:response.status(),page:page.url()});
});
// Hard reloads in this scenario seed cache between independent routes. Wait for
// the previous tree queries to finish before leaving the document in WebKit;
// otherwise insecure-localhost cookie proxy requests are canceled mid-flight.
const stableGoto=async url=>{if(engine==='webkit')await page.waitForLoadState('networkidle');await page.goto(url);};
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
 assert.deepEqual([...result.new].sort(),[...result.old].sort(),
  'each shared name must exist on BOTH sides even when a source lives in the persistent sidebar: '+JSON.stringify(result));
 assert.equal(new Set(result.old).size,result.old.length,'snapshot names must be unique');
 if(expectPair)assert.ok(result.old.includes('rk-shared-title'),'expected a matched resource title: '+JSON.stringify(result));
 if(expectFallback)assert.deepEqual(result.old,['rk-route-content'],'other navigation must use the original crossfade');
 assert.equal(result.error,null,'native transition was skipped');
 // Avoid racing a still-active WebKit snapshot when testing the next click.
 await page.waitForFunction(()=>window.__rkVTLog.at(-1)?.finished===true);
 await page.waitForFunction(()=>document.querySelectorAll('[data-rk-vt-active="true"]').length===0);
 return result;
};
const assertTextInPage=async(locator)=>assert.equal(await vtName(locator),'none','text must fade together with its parent viewport');
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
 const folder=await create('/folders',{name:'Transitions folder '+suffix});
 const doc=await create('/records',{name:'Shared '+suffix.slice(-4)+'.md',kind:'document',folderId:folder.id,content:'# Body heading\n\nDetails'});
 const taskList=await create('/records',{name:'Tasks '+suffix.slice(-4),kind:'task_list',folderId:folder.id,content:''});
 await page.evaluate(async(recordId)=>{
  const meta=await (await fetch('/api/records/'+recordId+'?metadataOnly=true')).json();
  for(const title of ['First generated task','Target shared task']){
   const r=await fetch('/api/tasks/mutate',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({recordId,action:'add',expectedRevision:meta.revision,
     changes:{title,status:'todo',priority:4}})});
   if(!r.ok)throw Error('task creation '+await r.text());
   const refreshed=await (await fetch('/api/records/'+recordId+'?metadataOnly=true')).json();
   meta.revision=refreshed.revision;
  }
 },taskList.id);
 const targetTasks=await page.evaluate(async id=>(await(await fetch('/api/tasks?recordId='+id+'&limit=200')).json()).items,taskList.id);
 const targetTask=targetTasks.find(t=>t.title==='Target shared task');
 assert.ok(targetTask,'Task fixture must have its own stable task ID');
 // Visit a document to populate the real localStorage-backed recent feed.
 await stableGoto(base+'/records/'+doc.id);
 await recordPage(doc);
 await stableGoto(base+'/');
 const recent=page.locator('.recent-page').filter({hasText:doc.name}).first();
 await recent.waitFor();
 assert.equal(await recent.locator('.rk-shared-text').innerText(),doc.name.slice(0,-3));
 assert.equal(await recent.locator('.rk-shared-extension').innerText(),'.md');
 let before=await count();
 await recent.click();
 await recordPage(doc);
 await assertRouteTransition(before,{expectPair:true});
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/');
 await recent.waitFor();
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS home recent title to document and history pairing');

 // Home todo links target the exact embedded task, not the record filename.
 await page.reload();
 const todo=page.locator('.compact-row').filter({hasText:targetTask.title});
 await todo.waitFor();
 // Inject after the last full reload: style tags from an earlier document
 // are discarded on page.goto()/reload(), but survive SPA navigation.
 // Put the requested task below the fold to verify its anchor wins.
 await page.addStyleTag({content:'.embedded-tasks .task-item[data-task-target="true"] { margin-top: 1100px !important; }'});
 await page.waitForTimeout(450);
 before=await count();
 await todo.locator('a').click();
 await page.waitForURL(url=>url.pathname==='/records/'+taskList.id&&url.searchParams.get('task')===targetTask.id);
 const target=page.locator('.embedded-tasks .task-item[data-task-id="'+targetTask.id+'"]');
 await target.waitFor();
 await page.waitForFunction(id=>{
  const row=document.querySelector('.embedded-tasks .task-item[data-task-id="'+id+'"]');
  return row&&row===document.activeElement&&row.getBoundingClientRect().top<innerHeight;
 },targetTask.id);
 assert.equal(await page.locator('.record-page h1.page-title').innerText(),taskList.name,
  'Home task must NOT replace its parent task-list record title');
 assert.equal(await target.locator('.task-title').innerText(),targetTask.title);
 await assertRouteTransition(before,{expectPair:true});
 const focusedPosition=await page.evaluate(taskId=>{
  const row=document.querySelector('.task-item[data-task-id="'+taskId+'"]');
  const viewport=document.querySelector('.main-scroll');
  const bounds=row.getBoundingClientRect(),clip=viewport.getBoundingClientRect();
  return {scrollTop:viewport.scrollTop,top:bounds.top,bottom:bounds.bottom,
   viewportTop:clip.top,viewportBottom:clip.bottom};
 },targetTask.id);
 assert.ok(focusedPosition.scrollTop>150&&focusedPosition.top<focusedPosition.viewportBottom&&
  focusedPosition.bottom>focusedPosition.viewportTop,
  'explicit home task deep link must override normal scroll-to-top: '+JSON.stringify(focusedPosition));
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/');
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS home todo navigates, scrolls and focuses exact task item');

 // Generate two distinct activity events for the SAME record. The source
 // is the particular event seq, not every matching resource title in the feed.
 await page.evaluate(async({recordId,suffix})=>{
  for(const tag of ['shared-first-'+suffix.slice(-4),'shared-second-'+suffix.slice(-4)]){
   const r=await fetch('/api/records/'+recordId+'/tags',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({tag,action:'add'})
   });
   if(!r.ok)throw Error('activity fixture '+await r.text());
  }
 },{recordId:doc.id,suffix});
 await page.reload();
 const matches=page.locator('.recent-entry').filter({hasText:doc.name});
 await matches.first().waitFor();
 assert.ok(await matches.count()>=2,'same document should appear in more than one activity event');
 const activity=matches.nth(1);
 await page.waitForTimeout(500);
 before=await count();
 await activity.locator('a.activity-resource').click();
 await recordPage(doc);
 await assertRouteTransition(before,{expectPair:true});
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/');
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS home activity resolves exactly the clicked duplicate event');
 await stableGoto(base+'/activity');
 const activityRows=page.locator('.activity-row').filter({hasText:doc.name});
 await activityRows.nth(1).waitFor();
 await page.waitForTimeout(400);
 before=await count();
 await activityRows.nth(1).locator('a.activity-resource').click();
 await recordPage(doc);
 await assertRouteTransition(before,{expectPair:true});
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/activity');
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS full activity list resource title to document and history pairing');

 // Search result title: only the clean matched name is shared, not .md nor
 // the highlighted mark fragments. The search route must remain on return.
 await stableGoto(base+'/search?q='+encodeURIComponent('Shared '+suffix.slice(-4))+'&mode=metadata');
 const result=page.locator('.search-result').filter({hasText:doc.name}).first();
 await result.waitFor();
 await page.waitForTimeout(410);
 before=await count();
 await result.click();
 await recordPage(doc);
 await assertRouteTransition(before,{expectPair:true});
 before=await count();
 await page.goBack();
 await page.waitForURL(/\/search\?/);
 await result.waitFor();
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS search title to document; return to same query');

 // Task-list filenames still share from the actual library CONTENT row.
 // The persistent sidebar, however, must NOT morph its always-visible label
 // into a route heading: that would briefly hide or duplicate shell text.
 await stableGoto(base+'/library/'+folder.id);
 const taskRow=page.locator('.file-row').filter({hasText:taskList.name});
 await taskRow.waitFor();
 await page.waitForTimeout(450);
 before=await count();
 await taskRow.click();
 await recordPage(taskList);
 await assertRouteTransition(before,{expectPair:true});
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/library/'+folder.id);
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS task-list filename in knowledge library tree');

 if(!mobileRun){
  const tree=page.locator('.sidebar .tree-link').filter({hasText:taskList.name});
  await tree.waitFor();
  before=await count();
  await tree.click();
  await recordPage(taskList);
  await assertRouteTransition(before,{expectFallback:true});
  assert.equal(await tree.locator('[data-rk-vt-active="true"]').count(),0,
   'persistent sidebar must never become a paired title snapshot');
  before=await count();
  await page.goBack();
  await page.waitForURL(base+'/library/'+folder.id);
  await assertRouteTransition(before,{expectFallback:true});
  assert.equal(await page.locator('.sidebar [data-rk-vt-active="true"]').count(),0);
  console.log('PASS desktop persistent sidebar text stays live; navigation uses route fade only');
 }

 // Archive-to-document is a real shared title; the archived record's kind
 // remains document. Restore/delete workflows remain unchanged.
 await page.evaluate(async recordId=>{
  const current=await(await fetch('/api/records/'+recordId+'?metadataOnly=true')).json();
  const r=await fetch('/api/records/'+recordId+'/meta',{method:'PATCH',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({status:'archived',expectedMetadataRevision:current.metadataRevision})});
  if(!r.ok)throw Error('archiving '+await r.text());
 },doc.id);
 await stableGoto(base+'/archive');
 const archived=page.locator('.archive-item').filter({hasText:doc.name});
 await archived.waitFor();
 await page.waitForTimeout(450);
 before=await count();
 await archived.locator('a.archive-item-link').click();
 await recordPage(doc);
 await assertRouteTransition(before,{expectPair:true});
 const archiveBanner=page.locator('.record-main .doc-notice [data-rk-record-notice="archive"]');
 await archiveBanner.getByText('此记录已归档').waitFor();
 await archiveBanner.getByRole('button',{name:'恢复为正常'}).waitFor();
 assert.equal(await page.locator('.record-page > .doc-notice').count(),0,
  'archived alert must not precede the document title');
 const noticeGeometry=await page.evaluate(()=>{
  const rect=selector=>document.querySelector(selector)?.getBoundingClientRect();
  const heading=rect('.workbench-header'),modes=rect('.editor-topline'),
   notice=rect('[data-rk-record-notice="archive"]'),body=rect('.editor-body');
  const native=document.querySelector('[data-rk-record-notice="archive"] .astryx-banner');
  return {headerBottom:heading.bottom,modeBottom:modes.bottom,
   noticeTop:notice.top,noticeBottom:notice.bottom,bodyTop:body.top,
   noticeWidth:notice.width,viewportWidth:document.querySelector('.main-scroll').clientWidth,
   nativeBanner:Boolean(native)};
 });
 assert.ok(noticeGeometry.noticeTop>=Math.max(noticeGeometry.headerBottom,noticeGeometry.modeBottom)-2,
  'archive status must live BELOW the title and mode controls: '+JSON.stringify(noticeGeometry));
 assert.ok(noticeGeometry.noticeBottom<=noticeGeometry.bodyTop+2,
  'archive status must precede editable content: '+JSON.stringify(noticeGeometry));
 assert.equal(noticeGeometry.nativeBanner,true,
  'archived notice must use the native Astryx Banner structure');
 assert.ok(noticeGeometry.noticeWidth<=noticeGeometry.viewportWidth,
  'native Astryx Banner must not overflow the mobile viewport');
 if(mobileRun){
  await page.screenshot({path:'tmp/record-archive-mobile-preview.png',fullPage:false});
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForTimeout(160);
  await page.screenshot({path:'tmp/record-archive-mobile-dark.png',fullPage:false});
 }
 console.log('PASS archived document notice follows header and modes ('+engine+')');
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/archive');
 await archived.waitFor();
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS archive title to document and history pairing');
 // A task-list record uses the same status placement even though it has no
 // document view switcher or rich-text editor.
 await page.evaluate(async recordId=>{
  const record=await(await fetch('/api/records/'+recordId+'?metadataOnly=true')).json();
  const response=await fetch('/api/records/'+recordId+'/meta',{method:'PATCH',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({status:'archived',expectedMetadataRevision:record.metadataRevision})});
  if(!response.ok)throw Error('archiving task-list record: '+await response.text());
 },taskList.id);
 await stableGoto(base+'/records/'+taskList.id);
 await page.locator('.record-page .doc-header').waitFor();
 const taskArchive=page.locator('.record-main .doc-notice [data-rk-record-notice="archive"]');
 await taskArchive.getByText('此记录已归档').waitFor();
 assert.ok(await page.evaluate(()=>{
  const header=document.querySelector('.record-page .doc-header').getBoundingClientRect();
  const notice=document.querySelector('[data-rk-record-notice="archive"]').getBoundingClientRect();
  const tasks=document.querySelector('.embedded-tasks').getBoundingClientRect();
  return header.bottom<=notice.top+2&&notice.bottom<=tasks.top+2;
 }),'task-list status must follow record identity and precede tasks');
 await taskArchive.getByRole('button',{name:'恢复为正常'}).click();
 await taskArchive.waitFor({state:'detached'});
 assert.equal(await page.locator('.record-main .doc-notice [data-rk-record-notice="archive"]').count(),0);
 console.log('PASS task-list archive state and restore action without header displacement');
 assert.deepEqual(faults,[],'new navigation sources must not cause runtime errors; failed scripts='+JSON.stringify(failedScripts));
}finally{await browser.close();}
