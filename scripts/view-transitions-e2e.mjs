/** Shared-element transitions against a local-only Worker and isolated D1. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Only isolated localhost tests are allowed');
const bin=[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path));
const line=existsSync('.dev.vars')?readFileSync('.dev.vars','utf8').split(/\r?\n/).find(s=>/^\s*MCP_AUTH_SECRET\s*=/.test(s)):null;
const secret=process.env.RECALLOOM_TEST_SECRET||line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(bin&&secret,'Local Edge/Chrome and test secret required');

const browser=await chromium.launch({headless:true,executablePath:bin});
const page=await browser.newPage({viewport:{width:1365,height:900}});
page.setDefaultTimeout(25000);
await page.addInitScript(()=>{
 const named=()=>[...document.querySelectorAll('*')]
  .map(el=>getComputedStyle(el).viewTransitionName).filter(name=>name!=='none'&&name!=='root');
 window.__rkVTStarts=[];
 if(typeof document.startViewTransition==='function'){
  const native=document.startViewTransition.bind(document);
  document.startViewTransition=(...args)=>{
   window.__rkVTStarts.push(named());
   return native(...args);
  };
 }
});
const faults=[];
page.on('pageerror',error=>faults.push(error.message));
const create=async(path,payload)=>page.evaluate(async ({path,payload})=>{
 const response=await fetch('/api'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 const data=await response.json();
 if(!response.ok)throw new Error(path+' '+response.status+' '+JSON.stringify(data));
 return data;
},{path,payload});
const vtName=locator=>locator.evaluate(el=>getComputedStyle(el).viewTransitionName);
const named=(kind,id)=>'rk-'+kind+'-'+id;
const getActiveNames=()=>page.evaluate(()=>[...document.querySelectorAll('*')]
 .map(el=>getComputedStyle(el).viewTransitionName).filter(name=>name!=='none'&&name!=='root'));
const assertIdle=async()=>{
 await page.waitForFunction(()=>[...document.querySelectorAll('*')]
  .every(el=>!/^rk-(?:record|folder)-/.test(getComputedStyle(el).viewTransitionName)),{timeout:4000});
 assert.deepEqual(await getActiveNames(),[],'idle pages must not snapshot every list item');
};
const expectOneSource=async(resource)=>{
 const starts=await page.evaluate(()=>window.__rkVTStarts);
 assert.ok(starts.length,'router should start a native transition for a selected link');
 assert.deepEqual(starts.at(-1),[resource],'only clicked resource may be in the old snapshot');
};
const assertUniqueNames=async()=>{
 const names=await getActiveNames();
 assert.equal(new Set(names).size,names.length,'duplicate names would skip the native transition');
};

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const stamp=String(Date.now());
 const folderName='0 Transition audit '+stamp;
 const folder=await create('/folders',{name:folderName});
 const basic=await create('/records',{name:'0 Native transition '+stamp,kind:'document',folderId:folder.id,content:'A document without a heading.\n'});
 const promoted=await create('/records',{name:'1 With heading '+stamp,kind:'document',folderId:folder.id,content:'# Promoted content title\n\nBody text.\n'});

 await page.goto(base+'/library');
 const folderRow=page.locator('.file-row').filter({hasText:folderName});
 await folderRow.waitFor();
 await assertIdle();
 assert.equal(await vtName(folderRow.locator('.truncate').first()),'none');
 await folderRow.click();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{level:1,name:folderName}).waitFor();
 const folderShared=named('folder',folder.id);
 await expectOneSource(folderShared);
 assert.equal(await vtName(page.locator('.folder-page h1.page-title')),folderShared);
 await assertUniqueNames();
 const rootRule=await page.evaluate(()=>({
  oldAnimation:getComputedStyle(document.documentElement,'::view-transition-old(root)').animationName,
  oldOpacity:getComputedStyle(document.documentElement,'::view-transition-old(root)').opacity
 }));
 assert.equal(rootRule.oldAnimation,'none','root should not crossfade whole pages');
 assert.equal(rootRule.oldOpacity,'0','old root must not show duplicate page content');

 // The other records are never captured as independent old layers.
 await assertIdle();
 const row=page.locator('.file-row').filter({hasText:basic.name});
 await row.waitFor();
 assert.equal(await vtName(row.locator('.truncate').first()),'none');
 await row.click();
 await page.waitForURL(base+'/records/'+basic.id);
 const documentTitle=page.locator('.workbench-header h1.page-title');
 await documentTitle.waitFor();
 const basicShared=named('record',basic.id);
 await expectOneSource(basicShared);
 assert.equal(await vtName(documentTitle),basicShared);
 assert.equal(await page.locator('.page-transition').getAttribute('data-phase'),'idle');
 await assertUniqueNames();

 await assertIdle();
 await page.goBack();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{level:1,name:folderName}).waitFor();
 assert.equal(await vtName(page.locator('.file-row').filter({hasText:basic.name}).locator('.truncate').first()),'none');

 const promotedRow=page.locator('.file-row').filter({hasText:promoted.name});
 await assertIdle();
 await promotedRow.click();
 await page.waitForURL(base+'/records/'+promoted.id);
 const filename=page.locator('.workbench-file-identity');
 await filename.waitFor();
 const promotedShared=named('record',promoted.id);
 await expectOneSource(promotedShared);
 assert.equal(await vtName(filename),promotedShared,'filename maps to the identity label when Markdown H1 differs');
 assert.equal(await vtName(page.locator('.workbench-header h1.page-title')),'none','H1 must not pretend to be the filename');
 await assertUniqueNames();

 await page.getByRole('button',{name:'详细信息'}).click();
 const inspector=page.getByRole('dialog',{name:'文档检查器'});
 await inspector.getByRole('tab',{name:'目录'}).click();
 assert.equal(await inspector.locator('.workbench-tab-indicator').count(),1);
 await inspector.getByRole('tab',{name:'版本'}).click();
 assert.equal(await inspector.locator('.workbench-tab-indicator').count(),1);
 await inspector.getByRole('button',{name:'关闭',exact:true}).click();
 await inspector.waitFor({state:'hidden'});

 await page.goto(base+'/');
 const recent=page.locator('.recent-page').filter({hasText:promoted.name}).first();
 await recent.waitFor();
 await assertIdle();
 await recent.click();
 await page.waitForURL(base+'/records/'+promoted.id);
 await filename.waitFor();
 await expectOneSource(promotedShared);
 assert.equal(await vtName(filename),promotedShared);

 await page.goto(base+'/search?q='+encodeURIComponent(promoted.name)+'&mode=metadata');
 const hit=page.locator('.search-result').filter({hasText:promoted.name}).first();
 await hit.waitFor();
 await assertIdle();
 await hit.click();
 await page.waitForURL(base+'/records/'+promoted.id);
 await filename.waitFor();
 await expectOneSource(promotedShared);
 assert.equal(await vtName(filename),promotedShared);

 // Breadcrumb targets work, while persistent file-tree siblings remain unnamed.
 await assertIdle();
 await page.locator('.crumbs').getByRole('link',{name:folderName}).click();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{level:1,name:folderName}).waitFor();
 await expectOneSource(folderShared);
 await assertUniqueNames();

 // Non-resource navigation must not start a native transition.
 await assertIdle();
 const before=await page.evaluate(()=>window.__rkVTStarts.length);
 await page.getByRole('link',{name:'知识库',exact:true}).first().click();
 await page.waitForURL(base+'/library');
 assert.equal(await page.evaluate(()=>window.__rkVTStarts.length),before);

 // Even opted-in links must not capture a title when reduce-motion is requested.
 await page.emulateMedia({reducedMotion:'reduce'});
 const reducedRow=page.locator('.file-row').filter({hasText:folderName});
 await reducedRow.waitFor();
 await assertIdle();
 await reducedRow.click();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{level:1,name:folderName}).waitFor();
 const reducedSource=await page.evaluate(()=>window.__rkVTStarts.at(-1));
 assert.deepEqual(reducedSource,[],'reduced motion must not select a shared title');
 assert.equal(await page.locator('.page-transition').getAttribute('data-phase'),'idle');
 await assertIdle();

 // Regression for the iPhone-sized screenshot: bottom navigation stays stable
 // and only the selected folder name is captured, not every file row.
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.setViewportSize({width:390,height:844});
 await page.locator('.bottom-nav .bottom-link').filter({hasText:'知识库'}).click();
 await page.waitForURL(base+'/library');
 const mobileFolder=page.locator('.file-row').filter({hasText:folderName});
 await mobileFolder.waitFor();
 await assertIdle();
 await mobileFolder.click();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{level:1,name:folderName}).waitFor();
 await expectOneSource(folderShared);
 await assertUniqueNames();
 const mobileSize=await page.evaluate(()=>({width:innerWidth,contentWidth:document.documentElement.scrollWidth}));
 assert.ok(mobileSize.contentWidth<=mobileSize.width+1,'mobile layout overflow after navigation: '+JSON.stringify(mobileSize));

 await assertIdle();
 assert.deepEqual(faults,[],'no browser runtime errors');
 console.log('PASS View Transitions: exactly one source, root no ghost, plain/H1, back, recent, search, breadcrumbs, reduced motion, mobile viewport');
}finally{await browser.close();}
