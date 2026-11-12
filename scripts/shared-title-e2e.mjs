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
 const folder=await create('/folders',{name:'Game'});
 const child=await create('/folders',{name:'Nested folder '+suffix,parentId:folder.id});
 const documentRecord=await create('/records',{name:'Project design '+suffix+'.md',kind:'document',folderId:folder.id,content:'# Markdown heading\n\nBody text.'});
 const shortDocument=await create('/records',{name:'Note.md',kind:'document',folderId:folder.id,content:'A short title for geometry regression.'});
 const brokenRecord=await create('/records',{name:'Unavailable destination '+suffix,kind:'document',folderId:folder.id,content:'Body'});

 await page.goto(base+'/library');
 const folderRow=page.locator('.file-row').filter({hasText:folder.name});
 await folderRow.waitFor();
 await page.waitForTimeout(470);
 await assertUnique();
 let before=await count();
 const listTitleWidth=await folderRow.locator('.file-row-title').evaluate(el=>el.getBoundingClientRect().width);
 await folderRow.click();
 await folderPage(folder);
 const folderTitleGeometry=await page.locator('.folder-page h1.page-title').evaluate(el=>{
  const style=getComputedStyle(el),rect=el.getBoundingClientRect();
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return {box:rect.width,actualText:ctx.measureText(el.textContent).width,layout:style.display};
 });
 assert.ok(folderTitleGeometry.box<=folderTitleGeometry.actualText+24,
  'short shared title must have intrinsic width, not a page-wide screenshot: '+JSON.stringify({listTitleWidth,folderTitleGeometry}));
 assert.ok(folderTitleGeometry.box<=listTitleWidth*4,
  'short title should not scale an old screenshot many times larger: '+JSON.stringify({listTitleWidth,folderTitleGeometry}));
 await assertRouteTransition(before,{expectPair:true});
 await assertUnique();

 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/library');
 await assertRouteTransition(before,{expectPair:true});
 await page.waitForTimeout(350);

 before=await count();
 await page.goForward();
 await folderPage(folder);
 await assertRouteTransition(before,{expectPair:true});

 const documentRow=page.locator('.file-row').filter({hasText:documentRecord.name});
 await documentRow.waitFor();
 assert.equal(await documentRow.locator('.file-row-title').innerText(),documentRecord.name.slice(0,-3));
 assert.equal(await documentRow.locator('.file-row-extension').innerText(),'.md');
 assert.equal(await vtName(documentRow.locator('.file-row-extension')),'none');
 await page.waitForTimeout(400);
 before=await count();
 await documentRow.click();
 await recordPage(documentRecord);
 await page.getByRole('heading',{name:documentRecord.name.slice(0,-3),level:1}).waitFor();
 await assertRouteTransition(before,{expectPair:true});
 await page.locator('.tiptap h1').getByText('Markdown heading').waitFor();
 await assertUnique();

 before=await count();
 await page.goBack();
 await folderPage(folder);
 await assertRouteTransition(before,{expectPair:true});
 await page.waitForTimeout(350);

 // A second short label tests the editable Markdown workbench title. It used
 // to capture the full page width too, producing the same oversized ghost.
 const shortRow=page.locator('.file-row').filter({hasText:shortDocument.name});
 await shortRow.waitFor();
 const oldShortWidth=await shortRow.locator('.file-row-title').evaluate(el=>el.getBoundingClientRect().width);
 before=await count();
 await shortRow.click();
 await recordPage(shortDocument);
 const shortTitle=await page.locator('.workbench-header h1.page-title').evaluate(el=>{
  const style=getComputedStyle(el),rect=el.getBoundingClientRect();
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return {width:rect.width,text:ctx.measureText(el.textContent).width};
 });
 assert.ok(shortTitle.width<=shortTitle.text+24&&shortTitle.width<=oldShortWidth*4,
  'Markdown shared title must not span the page: '+JSON.stringify({oldShortWidth,shortTitle}));
 await assertRouteTransition(before,{expectPair:true});
 before=await count();
 await page.goBack();
 await folderPage(folder);
 await assertRouteTransition(before,{expectPair:true});
 await page.waitForTimeout(350);

 before=await count();
 await page.locator('.file-row').filter({hasText:child.name}).click();
 await folderPage(child);
 await assertRouteTransition(before,{expectPair:true});

 before=await count();
 await page.goBack();
 await folderPage(folder);
 await assertRouteTransition(before,{expectPair:true});

 await page.goto(base+'/');
 const recent=page.locator('.recent-page').filter({hasText:documentRecord.name}).first();
 await recent.waitFor();
 await page.waitForTimeout(420);
 const recentNameUnwrapped=await recent.locator('.rk-shared-text').evaluate(el=>{
  const lineHeight=parseFloat(getComputedStyle(el).lineHeight);
  return el.scrollWidth<=el.clientWidth+1&&
   (!Number.isFinite(lineHeight)||el.getBoundingClientRect().height<=lineHeight*1.55);
 });
 before=await count();
 await recent.click();
 await recordPage(documentRecord);
 await assertRouteTransition(before,recentNameUnwrapped?{expectPair:true}:{expectFallback:true});

 if(engine==='chromium'){
  // The source is real, but the destination loader fails. Do not capture an
  // unmatched old title: the route's error view has no corresponding heading.
  await page.goto(base+'/library/'+folder.id);
  const brokenRow=page.locator('.file-row').filter({hasText:brokenRecord.name});
  await brokenRow.waitFor();
  await page.waitForTimeout(400);
  await page.route('**/api/records/'+brokenRecord.id,route=>route.fulfill({
   status:503,contentType:'application/json',body:JSON.stringify({code:'TEMPORARILY_UNAVAILABLE'})
  }));
  before=await count();
  await brokenRow.click();
  await page.waitForURL(base+'/records/'+brokenRecord.id);
  await assertRouteTransition(before,{expectFallback:true});
  await page.unroute('**/api/records/'+brokenRecord.id);

  // The same ID alone is insufficient. A stale list row with a different
  // visible filename must not morph into the current title from its cache.
  await page.goto(base+'/library/'+folder.id);
  const staleRow=page.locator('.file-row').filter({hasText:documentRecord.name});
  await staleRow.waitFor();
  await page.waitForTimeout(400);
  await staleRow.locator('.file-row-title').evaluate(el=>{el.textContent='Outdated cached filename';});
  before=await count();
  await page.locator('.file-row').filter({hasText:'Outdated cached filename'}).click();
  await recordPage(documentRecord);
  await assertRouteTransition(before,{expectFallback:true});
 }

 // Suppress shared capture entirely when the user requests reduced motion.
 await page.goto(base+'/library');
 await page.emulateMedia({reducedMotion:'reduce'});
 await folderRow.waitFor();
 before=await count();
 await folderRow.click();
 await folderPage(folder);
 await assertRouteTransition(before,{expectFallback:true});
 assert.deepEqual(faults,[],'shared-title navigation must have no browser runtime faults');
 console.log('PASS paired file/folder titles, .md split, history, non-library fallback and reduced motion ('+engine+(mobileRun?' mobile':' desktop')+')');
}finally{await browser.close();}
