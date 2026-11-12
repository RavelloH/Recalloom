/** Mobile sidebar exit must finish before route snapshots, in isolated Worker/D1. */
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
const mobileRun=true; // This dedicated suite always exercises the touch drawer.
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
  .filter(n=>Boolean(n)&&n!=='none'&&n!=='root');
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
const activeNames=()=>page.evaluate(()=>[...document.querySelectorAll('*')].map(el=>getComputedStyle(el).viewTransitionName).filter(n=>Boolean(n)&&n!=='none'&&n!=='root'));
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
 await page.getByRole('button',{name:'打开导航'}).waitFor({state:'visible'});
 // Record the real overlay state when TanStack Router starts its snapshot.
 await page.evaluate(()=>{
  window.__drawerSnapshotTrace=[];
  const original=document.startViewTransition.bind(document);
  document.startViewTransition=(...args)=>{
   const drawer=document.querySelector('.sidebar').getBoundingClientRect();
   const scrim=getComputedStyle(document.querySelector('.mobile-scrim'));
   window.__drawerSnapshotTrace.push({
    drawerRight:drawer.right,
    scrimOpacity:parseFloat(scrim.opacity),
    from:location.pathname
   });
   return original(...args);
  };
 });
 const openDrawer=async()=>{
  await page.getByRole('button',{name:'打开导航'}).click();
  await page.locator('.sidebar.mobile-open').waitFor();
  await page.waitForTimeout(340);
 };
 const closedWhenCaptured=async()=>{
  const data=await page.evaluate(()=>window.__drawerSnapshotTrace.at(-1));
  assert.ok(data&&data.drawerRight<=1&&data.scrimOpacity<=0.06,
   'View Transition screenshot must not cover an exiting drawer: '+JSON.stringify(data));
 };
 await openDrawer();
 let before=await count();
 await page.locator('.sidebar .nav-list a[href="/tasks"]').click();
 await page.waitForTimeout(120);
 assert.equal(new URL(page.url()).pathname,'/','do not navigate before drawer slide-out finishes');
 assert.equal(await count(),before,'route snapshot must not start during drawer exit');
 await page.waitForURL(base+'/tasks');
 await assertRouteTransition(before,{expectFallback:true});
 await closedWhenCaptured();
 console.log('PASS drawer main nav: close before View Transition snapshot');

 // The knowledge tree's Link must follow the same lifecycle, without
 // changing its native TanStack Router href, preload or back history.
 await openDrawer();
 before=await count();
 await page.locator('.sidebar .tree-heading-link').click();
 await page.waitForTimeout(120);
 assert.equal(new URL(page.url()).pathname,'/tasks','knowledge tree link must also wait for drawer exit');
 assert.equal(await count(),before);
 await page.waitForURL(base+'/library');
 await assertRouteTransition(before,{expectFallback:true});
 await closedWhenCaptured();
 console.log('PASS drawer knowledge tree: close before View Transition snapshot');

 // Pure drawer dismissal is not navigation and must never animate the page.
 await openDrawer();
 before=await count();
 await page.getByRole('button',{name:'关闭侧栏'}).click();
 await page.locator('.sidebar.mobile-open').waitFor({state:'detached'});
 await page.waitForTimeout(330);
 assert.equal(await count(),before,'drawer close icon must not trigger route transition');
 await page.goBack();
 await page.waitForURL(base+'/tasks');
 await assertRouteTransition(before,{expectFallback:true});
 // In reduced-motion mode transform transitions may not produce a useful
 // transitionend; the zero-delay fallback must still perform navigation.
 await page.emulateMedia({reducedMotion:'reduce'});
 await openDrawer();
 before=await count();
 await page.locator('.sidebar .nav-list a[href="/"]').click();
 await page.waitForURL(base+'/');
 await assertRouteTransition(before,{expectFallback:true});
 await closedWhenCaptured();
 assert.deepEqual(faults,[],'mobile drawer navigation must not cause JS runtime errors');
 console.log('PASS drawer dismissal, browser history and reduced motion ('+engine+')');
}finally{await browser.close();}
