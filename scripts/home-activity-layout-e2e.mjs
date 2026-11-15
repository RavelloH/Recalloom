/** Homepage activity resource-name layout regression in an isolated Worker/D1. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright-core';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Use scripts/run-editor-e2e.mjs with an isolated local Worker');
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe']
 .find(path=>path&&existsSync(path)):undefined;
const secretLine=readFileSync(join(root,'.dev.vars'),'utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local MCP_AUTH_SECRET is required');

const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executable?{executablePath:executable}:{})});
const context=await browser.newContext({viewport:{width:1365,height:900},colorScheme:'light'});
const page=await context.newPage();
page.setDefaultTimeout(20000);
const faults=[];page.on('pageerror',error=>faults.push(error.message));
const runId=Date.now().toString(36).toUpperCase(),artifactDir=join(root,'tmp','home-activity-layout-'+engine+'-'+runId);
mkdirSync(artifactDir,{recursive:true});
if(engine==='webkit'){
 let sessionCookie='';
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(new URL(request.url()).pathname==='/api/auth/login'){
   const response=await route.fetch();sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
   await route.fulfill({response});return;
  }
  if(sessionCookie){await route.fulfill({response:await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}})});return;}
  await route.continue();
 });
}

const create=async(path,body)=>page.evaluate(async({path,body})=>{
 const response=await fetch('/api'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Error(path+' '+response.status+' '+JSON.stringify(data));return data;
},{path,body});
const compactGeometry=locator=>locator.evaluate(row=>{
 const summary=row.querySelector('.activity-summary'),actor=row.querySelector('.activity-actor'),verb=row.querySelector('.activity-verb');
 const resource=row.querySelector('.activity-resource'),shared=resource?.querySelector('.rk-shared-text');
 const rect=element=>{const value=element.getBoundingClientRect();return {left:value.left,right:value.right,width:value.width,height:value.height};};
 return {summary:rect(summary),actor:rect(actor),verb:rect(verb),resource:rect(resource),shared:rect(shared),
  sharedClientWidth:shared.clientWidth,sharedScrollWidth:shared.scrollWidth,
  resourceOverflow:getComputedStyle(resource).overflow,sharedEllipsis:getComputedStyle(shared).textOverflow,
  sharedDisplay:getComputedStyle(shared).display,sharedSource:shared.getAttribute('data-rk-vt-source'),sharedText:shared.textContent};
});
const waitForReadableActivity=locator=>locator.evaluate(async row=>{
 const deadline=performance.now()+6000;let stableFrames=0,last=null;
 while(performance.now()<deadline){
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if(!row.isConnected)throw Error('Activity row was replaced while waiting for its entrance');
  const resource=row.querySelector('.activity-resource'),shared=resource?.querySelector('.rk-shared-text');
  if(!resource||!shared)return;
  let opacity=1,visible=true;
  for(let node=row;node;node=node.parentElement){
   const style=getComputedStyle(node);opacity*=Number(style.opacity);visible&&=style.visibility!=='hidden'&&style.display!=='none';
   if(node===document.body)break;
  }
  const resourceRect=resource.getBoundingClientRect(),sharedRect=shared.getBoundingClientRect();
  const visibleWidth=Math.max(0,Math.min(sharedRect.right,resourceRect.right,innerWidth)-Math.max(sharedRect.left,resourceRect.left,0));
  last={opacity,visibleWidth,text:shared.textContent};
  const ready=visible&&opacity>=.995&&visibleWidth>32&&Boolean(shared.textContent?.trim());
  stableFrames=ready?stableFrames+1:0;if(stableFrames>=4)return;
 }
 throw Error('Activity row did not become readable: '+JSON.stringify(last));
});
const assertCompact=(geometry,width)=>{
 assert.equal(geometry.sharedDisplay,'block','compact shared title keeps a stable transition box');
 assert.match(geometry.sharedSource??'',/^activity:/,'activity shared-source identity remains attached to the title');
 assert.ok(geometry.sharedText.startsWith('首页最近活动资源名称'),'the visible resource starts with its real name');
 assert.equal(geometry.resourceOverflow,'hidden');assert.equal(geometry.sharedEllipsis,'ellipsis');
 assert.ok(geometry.resource.left>=geometry.verb.right-1&&geometry.resource.right<=geometry.summary.right+1,
  'resource stays inside the summary after actor and verb: '+JSON.stringify({width,geometry}));
 assert.ok(geometry.resource.width>=Math.min(120,geometry.summary.width*.35),
  'resource receives meaningful remaining width instead of collapsing to an ellipsis: '+JSON.stringify({width,geometry}));
 assert.ok(geometry.shared.width>32&&geometry.sharedClientWidth>32&&geometry.sharedScrollWidth>geometry.sharedClientWidth,
  'long fixture is genuinely truncated after a readable prefix: '+JSON.stringify({width,geometry}));
};

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/');
 const suffix=Date.now().toString(36).toUpperCase();
 const name='首页最近活动资源名称应在可用空间内显示而不是只剩省略号-'+suffix+'-extended-document.md';
 await create('/records',{name,kind:'document',folderId:null,content:'# Activity layout fixture'});
 await page.reload();
 const compact=page.locator('.home-card .recent-entry').filter({hasText:name}).first();await compact.waitFor();
 await waitForReadableActivity(compact);
 assertCompact(await compactGeometry(compact),1365);
 await page.screenshot({path:join(artifactDir,'desktop.png')});

 await page.setViewportSize({width:390,height:844});
 await page.reload();await page.waitForFunction(()=>innerWidth===390);
 const mobileCompact=page.locator('.home-card .recent-entry').filter({hasText:name}).first();await mobileCompact.waitFor();
 await waitForReadableActivity(mobileCompact);
 assertCompact(await compactGeometry(mobileCompact),390);
 await page.screenshot({path:join(artifactDir,'mobile.png')});

 await page.goto(base+'/activity');
 const full=page.locator('.activity-row').filter({hasText:name}).first();await full.waitFor();
 await waitForReadableActivity(full);
 const fullLayout=await full.evaluate(row=>{
  const summary=row.querySelector('.activity-summary'),resource=row.querySelector('.activity-resource'),shared=resource.querySelector('.rk-shared-text');
  const style=getComputedStyle(summary),sharedStyle=getComputedStyle(shared),rect=shared.getBoundingClientRect();
  return {summaryDisplay:style.display,summaryWhiteSpace:style.whiteSpace,summaryOverflow:style.overflow,
   resourceOverflow:getComputedStyle(resource).overflow,sharedHeight:rect.height,lineHeight:parseFloat(sharedStyle.lineHeight),
   sharedSource:shared.getAttribute('data-rk-vt-source')};
 });
 assert.equal(fullLayout.summaryDisplay,'block','full activity rows retain normal inline text layout');
 assert.equal(fullLayout.summaryWhiteSpace,'normal');assert.equal(fullLayout.summaryOverflow,'visible');
 assert.equal(fullLayout.resourceOverflow,'visible');assert.match(fullLayout.sharedSource??'',/^activity:/);
 assert.ok(fullLayout.sharedHeight>fullLayout.lineHeight*1.5,'long resource names wrap on the full activity page: '+JSON.stringify(fullLayout));
 await page.screenshot({path:join(artifactDir,'activity.png')});
 assert.deepEqual(faults,[],'browser runtime errors');
 console.log('PASS home activity resource names keep readable width and full activity rows wrap:',engine,artifactDir);
}finally{await browser.close();}
