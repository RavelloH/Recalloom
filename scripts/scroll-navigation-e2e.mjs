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
   const scroll=()=>document.querySelector('.main-scroll')?.scrollTop??0;
   const record={old:names(),new:null,oldScroll:scroll(),newScroll:null,ready:false,finished:false,error:null};
   window.__rkVTLog.push(record);
   const transition=original(...args);
   transition.updateCallbackDone.then(()=>{
    record.new=names();
    record.newScroll=scroll();
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

try {
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 // Keep the fixture tall even AFTER route remount, allowing history POP
 // positions to be restored instead of clamped by a short replacement page.
 await page.addStyleTag({content:'.home-page, .folder-page { min-height: 1900px !important; }'});
 const suffix=String(Date.now());
 const folder=await create('/folders',{name:'Scroll test '+suffix});
 const doc=await create('/records',{name:'Scroll destination.md',kind:'document',folderId:folder.id,content:'# Content\n\nDocument'});
 const measure=()=>page.locator('.main-scroll').evaluate(el=>({
  top:Math.round(el.scrollTop),height:Math.round(el.clientHeight),
  scrollHeight:Math.round(el.scrollHeight),path:location.pathname+location.search
 }));
 const setScroll=async(top)=>page.locator('.main-scroll').evaluate(async(el,top)=>{
  el.scrollTo({top,behavior:'instant'});
  await new Promise(requestAnimationFrame);
 },top);
 await setScroll(530);
 console.log('INITIAL '+JSON.stringify(await measure()));
 assert.ok((await measure()).top>=450,'fixture must be scrolled before navigating');
 const before=await count();
 await page.locator(mobileRun?'.bottom-nav a[href="/library"]':'.sidebar .tree-heading-link').click();
 await page.waitForURL(base+'/library');
 await assertRouteTransition(before);
 console.log('AFTER_NEW_LIBRARY '+JSON.stringify(await measure()));
 const pushCapture=await page.evaluate(()=>window.__rkVTLog.at(-1));
 assert.ok(pushCapture.oldScroll>=450,'old snapshot must preserve outgoing page scroll');
 assert.equal(pushCapture.newScroll,0,'new page snapshot MUST capture its top, not old scroll position: '+JSON.stringify(pushCapture));
 assert.equal((await measure()).top,0,'a new page should begin at the top');
 // Browser Back should return to the scroll position of that history entry.
 const backBefore=await count();
 await page.goBack();
 await page.waitForURL(base+'/');
 await assertRouteTransition(backBefore);
 console.log('AFTER_HISTORY_BACK '+JSON.stringify(await measure()));
 const backCapture=await page.evaluate(()=>window.__rkVTLog.at(-1));
 assert.ok(backCapture.newScroll>=450,
  'back navigation snapshot must capture the restored old scroll position: '+JSON.stringify(backCapture));
 assert.ok((await measure()).top>=450,'history back should restore the previous scroll position');
 const folderBefore=await count();
 await page.locator(mobileRun?'.bottom-nav a[href="/library"]':'.sidebar .tree-heading-link').click();
 await page.waitForURL(base+'/library');
 await assertRouteTransition(folderBefore);
 console.log('AFTER_REPEAT_LIBRARY '+JSON.stringify(await measure()));
 assert.equal((await measure()).top,0,'a newly pushed library entry must not inherit old scroll');
 await page.locator('.file-row').filter({hasText:folder.name}).click();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.locator('.file-row').filter({hasText:doc.name}).waitFor();
 await setScroll(390);
 const nextBefore=await count();
 await page.locator('.file-row').filter({hasText:doc.name}).evaluate(el=>el.click());
 await page.waitForURL(base+'/records/'+doc.id);
 await assertRouteTransition(nextBefore);
 console.log('AFTER_DOCUMENT '+JSON.stringify(await measure()));
 assert.equal((await measure()).top,0,'document should begin at top, not retain a folder scroll position');
 const docBackBefore=await count();
 await page.goBack();
 await page.waitForURL(base+'/library/'+folder.id);
 await assertRouteTransition(docBackBefore);
 console.log('AFTER_FOLDER_BACK '+JSON.stringify(await measure()));
 assert.ok((await measure()).top>=300,'browser history should restore folder scroll after visiting a document');
 // A new search mode changes URL search parameters but keeps the same
 // pathname/component. It should still reset the persistent viewport.
 await page.goto(base+'/search?q=scroll&mode=metadata');
 await page.addStyleTag({content:'.search-page { min-height:1900px !important; }'});
 await page.locator('.search-modes').waitFor();
 await setScroll(430);
 assert.ok((await measure()).top>=400);
 const queryBefore=await count();
 await page.getByRole('radio',{name:'关键词',exact:true}).evaluate(el=>el.click());
 await page.waitForURL(url=>url.pathname==='/search'&&url.searchParams.get('mode')==='literal');
 await assertRouteTransition(queryBefore);
 console.log('AFTER_SEARCH_MODE '+JSON.stringify(await measure()));
 assert.equal((await measure()).top,0,'search route parameter changes should begin at the top');
 console.log('PASS new page top + history restoration + query changes ('+engine+')');
 assert.deepEqual(faults,[],'scroll restoration must not introduce runtime errors');
} finally {await browser.close();}
