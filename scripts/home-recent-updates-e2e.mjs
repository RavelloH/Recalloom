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
 const suffix=String(Date.now()).slice(-5);
 const docA=await create('/records',{name:'更新A'+suffix+'.md',kind:'document',folderId:null,content:'# Version A'});
 const docB=await create('/records',{name:'最近更新文稿共享标题测试-'+suffix+'.md',kind:'document',folderId:null,content:'# Version B'});
 const task=await create('/records',{name:'Tasks'+suffix,kind:'task_list',folderId:null,content:''});
 const archived=await create('/records',{name:'已归档'+suffix+'.md',kind:'document',folderId:null,content:'Archived'});
 await page.waitForTimeout(35);
 await page.evaluate(async({docA,docB,task,archived,suffix})=>{
  const req=async(path,method,body)=>{
   const res=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   const payload=await res.json();
   if(!res.ok)throw Error(path+' '+res.status+' '+JSON.stringify(payload));
   return payload;
  };
  await req('/tasks/mutate','POST',{recordId:task.id,action:'add',expectedRevision:1,
   changes:{title:'新任务',status:'todo',priority:3}});
  await req('/records/'+docB.id+'/content','PATCH',
   {expectedRevision:1,content:'# Updated B',message:'Browser content update'});
  await req('/records/'+docA.id+'/meta','PATCH',
   {expectedMetadataRevision:1,name:'改名A'+suffix+'.md'});
  await req('/records/'+archived.id+'/meta','PATCH',
   {expectedMetadataRevision:1,status:'archived'});
 },{docA,docB,task,archived,suffix});
 const fetchUpdates=()=>page.evaluate(async()=>{
  const response=await fetch('/api/recent-updates?limit=8');
  if(!response.ok)throw Error('recent updates '+response.status);
  return response.json();
 });
 const payload=await fetchUpdates();
 const ids=payload.items.map(item=>item.id);
 assert.equal(ids[0],docB.id,'latest CONTENT edit must outrank metadata-only rename');
 assert.equal(new Set(ids).size,ids.length,'one card per resource even after multiple revisions');
 assert.ok(ids.includes(task.id),'task-list changes must count as a content update');
 assert.ok(ids.includes(docA.id),'active edited document must appear');
 assert.ok(!ids.includes(archived.id),'archived record must not appear');
 assert.equal(payload.items.find(item=>item.id===docA.id).name,'改名A'+suffix+'.md');
 assert.equal(payload.items.find(item=>item.id===docA.id).revision,1,
  'metadata rename must not create a content revision');
 assert.equal(payload.items.find(item=>item.id===task.id).revision,2);
 assert.equal(payload.items.find(item=>item.id===docB.id).revision,2);
 assert.equal(payload.items.find(item=>item.id===docB.id).actorName,'本人（Web）');
 console.log('PASS recent updated API filters archives, deduplicates versions and ignores metadata-only updates');

 await stableGoto(base+'/');
 const radio=label=>page.getByRole('radio',{name:label,exact:true});
 await radio('最近访问').waitFor();
 assert.equal(await radio('最近访问').locator('svg').count(),1,'visited segment needs a semantic icon');
 assert.equal(await radio('最近更新').locator('svg').count(),1,'updated segment needs a semantic icon');
 const switcherSize=await page.locator('.recent-mode-heading [role="radiogroup"]').evaluate(el=>{
  const rect=el.getBoundingClientRect();
  return {width:rect.width,height:rect.height,viewport:innerWidth};
 });
 assert.ok(switcherSize.height>=34&&switcherSize.width<switcherSize.viewport,
  'native Astryx switcher must be touchable without overflowing: '+JSON.stringify(switcherSize));
 const dashboardRows=await page.evaluate(()=>{
  const task=document.querySelector('.home-card .compact-row');
  const activity=document.querySelector('.home-card .recent-entry');
  if(!task||!activity)return null;
  return {taskHeight:task.getBoundingClientRect().height,
   dotCenter:(()=>{const r=task.querySelector('.status-dot').getBoundingClientRect();return r.top+r.height/2;})(),
   textCenter:(()=>{const r=task.querySelector('.rk-shared-text').getBoundingClientRect();return r.top+r.height/2;})(),
   activityHeight:activity.getBoundingClientRect().height,
   taskPadding:getComputedStyle(task).paddingTop,
   activityPadding:getComputedStyle(activity).paddingTop,
   activitySummary:getComputedStyle(activity.querySelector('.activity-summary')).whiteSpace};
 });
 assert.ok(dashboardRows&&Math.abs(dashboardRows.taskHeight-dashboardRows.activityHeight)<=1,
  'home task/activity preview row heights must match: '+JSON.stringify(dashboardRows));
 assert.equal(dashboardRows.activitySummary,'nowrap','home activity should truncate rather than change row height');
 assert.ok(Math.abs(dashboardRows.taskHeight-48)<=1,
  'dashboard previews should stay compact on desktop and mobile');
 assert.ok(Math.abs(dashboardRows.dotCenter-dashboardRows.textCenter)<=1,
  'home task status dot and title must share a horizontal center line: '+JSON.stringify(dashboardRows));
 assert.equal(await page.getByText('近期记录',{exact:true}).count(),0,
  'the switcher alone must label the recent section; no redundant heading');
 const switcherLeft=await page.locator('.recent-mode-heading [role="radiogroup"]').evaluate(el=>
  el.getBoundingClientRect().left);
 const overviewLeft=await page.locator('.home-page h1').evaluate(el=>
  el.getBoundingClientRect().left);
 assert.ok(Math.abs(switcherLeft-overviewLeft)<=2,
  'recent mode switcher should align to left content edge');
 const initialPanel=page.locator('.home-recent-resizer');
 await initialPanel.waitFor();
 assert.equal(await initialPanel.locator('.home-recent-content').count(),1,
  'first mount must not duplicate the entrance animation');
 await radio('最近更新').click();
 await page.locator('.recent-page').filter({hasText:docB.name}).waitFor();
 const cards=page.locator('.recent-pages .recent-page');
 assert.equal(await cards.count(),payload.items.length);
 assert.equal(await cards.first().locator('.rk-shared-text').innerText(),docB.name.slice(0,-3));
 assert.ok((await cards.first().locator('.recent-page-meta').innerText()).includes('本人（Web）'));
 await page.waitForTimeout(180);
 const initial=await page.locator('.recent-pages').evaluate(el=>{
  const first=el.firstElementChild.getBoundingClientRect();
  const outer=document.querySelector('.home-recent-resizer').getBoundingClientRect();
  return {x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width,
   firstLeft:first.left,viewport:innerWidth,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
   pad:parseFloat(getComputedStyle(el).paddingLeft),
   outerX:outer.x,outerWidth:outer.width};
 });
 if(mobileRun){
  assert.ok(Math.abs(initial.x)<=2&&Math.abs(initial.width-initial.viewport)<=2,
   'updated mode reuses full-bleed mobile rail');
  assert.ok(Math.abs(initial.firstLeft-initial.pad)<=2,
   'updated cards must retain their scrollable leading inset');
  assert.ok(Math.abs(initial.outerX)<=2&&Math.abs(initial.outerWidth-initial.viewport)<=2,
   'AutoResizer must be full-bleed, never clip the edge carousel: '+JSON.stringify(initial));
 }
 if(!mobileRun){
  const desktopClearance=await page.locator('.home-recent-resizer').evaluate(el=>{
   const clip=el.getBoundingClientRect();
   const all=[...el.querySelectorAll('.recent-page')].map(node=>node.getBoundingClientRect());
   return {left:Math.min(...all.map(r=>r.left))-clip.left,
    right:clip.right-Math.max(...all.map(r=>r.right)),
    top:Math.min(...all.map(r=>r.top))-clip.top,
    bottom:clip.bottom-Math.max(...all.map(r=>r.bottom))};
  });
  assert.ok(Object.values(desktopClearance).every(value=>value>=20),
   'updated mode should have four-sided card shadow clearance: '+JSON.stringify(desktopClearance));
  await page.screenshot({path:'tmp/home-recent-updates-desktop.png',fullPage:false});
 }
 if(mobileRun)await page.screenshot({path:'tmp/home-recent-updates-mobile.png',fullPage:false});
 console.log('PASS Astryx icon switcher, compact dashboard rows and unclipped carousel');

 // The detail has never been opened in this browser. The server summary must
 // still allow a matching title snapshot on the FIRST click.
 const target=cards.filter({hasText:docB.name}).first();
 let before=await count();
 await target.click();
 await recordPage(docB);
 await assertRouteTransition(before,{expectPair:true});
 before=await count();
 await page.goBack();
 await page.waitForURL(base+'/');
 await radio('最近更新').waitFor();
 await page.locator('.recent-page').filter({hasText:docB.name}).waitFor();
 await assertRouteTransition(before,{expectPair:true});
 console.log('PASS cold recent-update title to detail and back without losing selection');

 await radio('最近访问').click();
 await page.locator('.recent-page').filter({hasText:docB.name}).waitFor();
 assert.ok(await page.locator('.recent-page').count()>=1);
 await radio('最近更新').click();
 await page.locator('.recent-page').filter({hasText:docB.name}).waitFor();
 await page.reload();
 await radio('最近更新').waitFor();
 await page.locator('.recent-page').filter({hasText:docB.name}).waitFor();
 assert.equal(await cards.count(),payload.items.length);
 console.log('PASS tab selection survives history and reload without duplicating cards');
 // Verify BOTH animations are real: content fades, while its height resizes
 // between an empty local history and populated server results. This catches
 // regressions where a clipping wrapper is present but never animates.
 await page.evaluate(()=>localStorage.setItem('recalloom:recent-pages','[]'));
 await page.reload();
 await radio('最近更新').waitFor();
 await page.locator('.recent-page').filter({hasText:docB.name}).waitFor();
 await radio('最近访问').click();
 await page.locator('.recent-empty').waitFor();
 await page.waitForTimeout(480);
 const emptyHeight=await page.locator('.home-recent-resizer').evaluate(el=>el.getBoundingClientRect().height);
 await page.evaluate(()=>{
  window.__rkRecentMotion=[];
  const until=performance.now()+960;
  const sample=()=>{
   const box=document.querySelector('.home-recent-resizer');
   const panes=[...document.querySelectorAll('.home-recent-content')];
   window.__rkRecentMotion.push({
    h:box?.getBoundingClientRect().height??0,
    opacity:panes.map(el=>Number(getComputedStyle(el).opacity))
   });
   if(performance.now()<until)requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
 });
 await radio('最近更新').click();
 await page.locator('.recent-page').filter({hasText:docB.name}).waitFor();
 await page.waitForTimeout(600);
 const motion=await page.evaluate(()=>window.__rkRecentMotion);
 const finalHeight=await page.locator('.home-recent-resizer').evaluate(el=>el.getBoundingClientRect().height);
 assert.ok(finalHeight>emptyHeight+35,
  'AutoResizer must adapt to larger content: '+JSON.stringify({emptyHeight,finalHeight}));
 assert.ok(motion.some(sample=>sample.opacity.some(op=>op>0.05&&op<0.95)),
  'AutoTransition must actually fade swapped content: '+JSON.stringify(motion.slice(0,8)));
 assert.ok(motion.some(sample=>sample.h>emptyHeight+10&&sample.h<finalHeight-10),
  'AutoResizer must interpolate height rather than jump: '+JSON.stringify({emptyHeight,finalHeight,heights:motion.map(item=>item.h).slice(0,15)}));
 console.log('PASS AutoTransition fade and AutoResizer interpolated height on real content swap');
 assert.deepEqual(faults,[],'recent updates must not introduce runtime errors');
}finally{await browser.close();}
