/** Cross-browser shared-element navigation in an isolated local Worker/D1. */
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
 const boxes=()=>Object.fromEntries([...document.querySelectorAll('*')].flatMap(el=>{
  const name=getComputedStyle(el).viewTransitionName;
  if(name==='none'||name==='root')return [];
  const {x,y,width,height}=el.getBoundingClientRect();
  return [[name,{x,y,width,height}]];
 }));
 window.__rkVTLog=[];
 if(typeof document.startViewTransition==='function'){
  const original=document.startViewTransition.bind(document);
  document.startViewTransition=(...args)=>{
   const record={old:names(),new:null,oldBoxes:boxes(),newBoxes:null,ready:false,error:null};
   window.__rkVTLog.push(record);
   const transition=original(...args);
   transition.updateCallbackDone.then(()=>{
    record.new=names();
    record.newBoxes=boxes();
   },error=>{record.error=String(error);});
   transition.ready.then(()=>{record.ready=true;},error=>{record.error=String(error);});
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
const named=(kind,id)=>'rk-'+kind+'-'+id;
const vtName=locator=>locator.evaluate(el=>getComputedStyle(el).viewTransitionName);
const activeNames=()=>page.evaluate(()=>[...document.querySelectorAll('*')].map(el=>getComputedStyle(el).viewTransitionName)
 .filter(n=>n!=='none'&&n!=='root'));
const assertUnique=async()=>{
 const names=await activeNames();
 assert.equal(names.length,new Set(names).size,'a duplicate view-transition-name would skip the animation: '+JSON.stringify(names));
};
const count=()=>page.evaluate(()=>window.__rkVTLog.length);
const assertMatched=async(resource,since,{movement=true}={})=>{
 await page.waitForFunction(n=>window.__rkVTLog.length>n,since);
 await page.waitForFunction(()=>window.__rkVTLog.at(-1)?.new!==null);
 const result=await page.evaluate(()=>window.__rkVTLog.at(-1));
 assert.ok(result.old.includes(resource),'old snapshot lacks '+resource+': '+JSON.stringify(result.old));
 assert.ok(result.new.includes(resource),'new snapshot lacks '+resource+': '+JSON.stringify(result.new));
 assert.equal(result.error,null,'native transition was skipped');
 assert.equal(result.old.length,new Set(result.old).size,'duplicate old resource snapshot');
 assert.equal(result.new.length,new Set(result.new).size,'duplicate new resource snapshot');
 if(movement){
  const old=result.oldBoxes[resource],next=result.newBoxes[resource];
  assert.ok(old&&next,'both element bounds must be captured');
  assert.ok(Math.hypot(old.x-next.x,old.y-next.y)>12,'resource did not move '+JSON.stringify({old,next}));
 }
 return result;
};
const assertShell=async()=>{
 const computed=await page.evaluate(()=>{
  const css=(part)=>getComputedStyle(document.documentElement,part);
  return {
   html:getComputedStyle(document.documentElement).viewTransitionName,
   route:getComputedStyle(document.querySelector('.main-scroll-host')).viewTransitionName,
   topbar:getComputedStyle(document.querySelector('.topbar')).viewTransitionName,
   bottom:getComputedStyle(document.querySelector('.bottom-nav')).viewTransitionName,
   oldRootAnimation:css('::view-transition-old(root)').animationName,
   newRootAnimation:css('::view-transition-new(root)').animationName,
   oldRootOpacity:css('::view-transition-old(root)').opacity,
   newRootOpacity:css('::view-transition-new(root)').opacity
  };
 });
 assert.equal(computed.html,'root','app chrome must have the default root snapshot');
 assert.equal(computed.route,'rk-route-content','only the fixed scroll viewport should crossfade');
 assert.equal(computed.topbar,'none');
 assert.equal(computed.bottom,'none');
 assert.equal(computed.oldRootAnimation,'none','old shell must not crossfade');
 assert.equal(computed.newRootAnimation,'none','new shell must not crossfade');
 assert.equal(computed.oldRootOpacity,'1','old shell must remain visible while the destination is prepared');
 assert.equal(computed.newRootOpacity,'1','new shell must remain fully opaque');
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
 const promoted=await create('/records',{name:'1 With heading '+suffix,kind:'document',folderId:folder.id,content:'# Promoted content title\n\nBody text.\n'});
 const task=await create('/records',{name:'2 RMD task list '+suffix,kind:'task_list',folderId:folder.id,content:''});
 const nested=await create('/folders',{name:'3 Journal '+suffix,parentId:folder.id});

 await page.goto(base+'/library');
 const folderRow=page.locator('.file-row').filter({hasText:folder.name});
 await folderRow.waitFor();
 await assertShell();
 const folderId=named('folder',folder.id);
 assert.equal(await vtName(folderRow.locator('.truncate').first()),folderId);
 await assertUnique();
 let before=await count();
 await folderRow.click();
 await folderPage(folder);
 await assertMatched(folderId,before);
 assert.equal(await vtName(page.locator('.folder-page h1.page-title')),folderId);
 await assertShell();

 // History back MUST match the same stable ID without any click handler.
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/library');
 await folderRow.waitFor();
 await assertMatched(folderId,before);
 await assertUnique();

 // Browser forward must also match the folder title and list row.
 before=await count();
 await page.goForward();
 await folderPage(folder);
 await assertMatched(folderId,before);

 const basicId=named('record',basic.id);
 const basicRow=page.locator('.file-row').filter({hasText:basic.name});
 assert.equal(await vtName(basicRow.locator('.truncate').first()),basicId);
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
 await assertMatched(basicId,before);
 assert.equal(await vtName(page.locator('.record-page h1.page-title')),basicId);
 before=await count();
 await page.goBack();
 await folderPage(folder);
 await assertMatched(basicId,before);
 assert.equal(await vtName(page.locator('.file-row').filter({hasText:basic.name}).locator('.truncate').first()),basicId);

 // The exact layout families from the two user screenshots.
 for(const entry of [task,nested]){
  const kind=entry===task?'record':'folder';
  const shared=named(kind,entry.id);
  await assertUnique();
  before=await count();
  await page.locator('.file-row').filter({hasText:entry.name}).click();
  if(kind==='record')await recordPage(entry);else await folderPage(entry);
  await assertMatched(shared,before);
  before=await count();
  await page.goBack();
  await folderPage(folder);
  await assertMatched(shared,before);
 }

 // A promoted Markdown H1 has a different identity from the filename.
 const promotedId=named('record',promoted.id);
 before=await count();
 await page.locator('.file-row').filter({hasText:promoted.name}).click();
 await recordPage(promoted);
 await page.locator('.workbench-file-identity').waitFor();
 await assertMatched(promotedId,before);
 assert.equal(await vtName(page.locator('.workbench-file-identity')),promotedId);
 assert.equal(await vtName(page.locator('.workbench-header h1.page-title')),'none');
 await assertUnique();

 if(!mobileRun){
  await page.getByRole('button',{name:'详细信息'}).click();
  const inspector=page.getByRole('dialog',{name:'文档检查器'});
  await inspector.getByRole('tab',{name:'目录'}).click();
  assert.equal(await inspector.locator('.workbench-tab-indicator').count(),1);
  await inspector.getByRole('button',{name:'关闭',exact:true}).click();
  await inspector.waitFor({state:'hidden'});
 }

 // Shared identity persists through recent pages and search, without a selected click.
 await page.goto(base+'/');
 const recent=page.locator('.recent-page').filter({hasText:promoted.name}).first();
 await recent.waitFor();
 assert.equal(await vtName(recent.locator('.recent-page-name')),promotedId);
 before=await count();
 await recent.click();
 await recordPage(promoted);
 await assertMatched(promotedId,before);
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/');
 await recent.waitFor();
 await assertMatched(promotedId,before);

 await page.goto(base+'/search?q='+encodeURIComponent(promoted.name)+'&mode=metadata');
 const hit=page.locator('.search-result').filter({hasText:promoted.name}).first();
 await hit.waitFor();
 assert.equal(await vtName(hit.locator('strong').first()),promotedId);
 before=await count();
 await hit.click();
 await recordPage(promoted);
 await assertMatched(promotedId,before);
 before=await count();
 await page.goBack();
 await page.waitForURL(/\/search\?/);
 await hit.waitFor();
 await assertMatched(promotedId,before);

 // Mobile top/bottom shell remains in the root snapshot on native WebKit.
 // Resizing a heavily transitioned WebKit page can crash the Playwright port.
 // Use a fresh mobile-sized WebKit browser session instead.
 if(engine!=='webkit'||mobileRun){
  if(!mobileRun)await page.setViewportSize({width:390,height:844});
  await assertShell();
 await page.goto(base+'/library');
 const mobileFolder=page.locator('.file-row').filter({hasText:folder.name});
 await mobileFolder.waitFor();
 await assertUnique();
 before=await count();
 await mobileFolder.click();
 await folderPage(folder);
 await assertMatched(folderId,before);
 await assertShell();
 assert.ok(await page.locator('.bottom-nav').isVisible(),'mobile bottom navigation remains visible');
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
 assert.deepEqual(faults,[],'no browser runtime faults');
 console.log('PASS stable View Transitions ('+engine+'): forward/back, fixed shell, task, nested folder, H1, recent, search, mobile and reduced-motion');
}finally{await browser.close();}
