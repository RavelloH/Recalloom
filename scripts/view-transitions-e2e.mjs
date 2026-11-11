/** Shared-element navigation against an isolated local Worker/D1. */
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
 window.__rkVTCalls=0;
 if(typeof document.startViewTransition==='function'){
  const start=document.startViewTransition.bind(document);
  document.startViewTransition=(...args)=>{
   window.__rkVTCalls++;
   return start(...args);
  };
 }
});
const faults=[];
page.on('pageerror',error=>faults.push(error.message));
const create=async(path,payload)=>page.evaluate(async ({path,payload})=>{
 const r=await fetch('/api'+path,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(payload)
 });
 const data=await r.json();
 if(!r.ok)throw new Error(path+' '+r.status+' '+JSON.stringify(data));
 return data;
},{path,payload});
const vtName=async(locator)=>locator.evaluate(el=>getComputedStyle(el).viewTransitionName);
const named=async(kind,id)=>'rk-'+kind+'-'+id; // Test fixtures use UUID IDs.
const assertUniqueNames=async()=>{
 const duplicate=await page.evaluate(()=>{
  const names=[...document.querySelectorAll('*')].map(el=>getComputedStyle(el).viewTransitionName).filter(n=>n!=='none');
  return names.filter((name,i)=>names.indexOf(name)!==i);
 });
 assert.deepEqual(duplicate,[],'duplicate view-transition-name causes skipped animations');
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
 const folderShared=await vtName(folderRow.locator('.truncate').first());
 assert.equal(folderShared,await named('folder',folder.id));
 await folderRow.click();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{level:1,name:folderName}).waitFor();
 const folderTitle=page.locator('.folder-page h1.page-title');
 assert.equal(await vtName(folderTitle),folderShared,'folder row morphs into folder heading');
 assert.ok(await page.evaluate(()=>window.__rkVTCalls>0),'TanStack Router starts a native navigation transition');
 await assertUniqueNames();

 const row=page.locator('.file-row').filter({hasText:basic.name});
 await row.waitFor();
 const basicShared=await vtName(row.locator('.truncate').first());
 await row.click();
 await page.waitForURL(base+'/records/'+basic.id);
 const documentTitle=page.locator('.workbench-header h1.page-title');
 await documentTitle.waitFor();
 assert.equal(await vtName(documentTitle),basicShared,'filename morphs into H1 when no markdown H1 exists');
 assert.equal(await page.locator('.page-transition').getAttribute('data-phase'),'idle','legacy page slide is suppressed');
 await assertUniqueNames();

 // Returning to the folder should restore matching names for browser-history navigation.
 await page.goBack();
 await page.waitForURL(base+'/library/'+folder.id);
 await page.getByRole('heading',{level:1,name:folderName}).waitFor();
 assert.equal(await vtName(page.locator('.file-row').filter({hasText:basic.name}).locator('.truncate').first()),basicShared);

 const promotedRow=page.locator('.file-row').filter({hasText:promoted.name});
 const promotedShared=await vtName(promotedRow.locator('.truncate').first());
 await promotedRow.click();
 await page.waitForURL(base+'/records/'+promoted.id);
 const filename=page.locator('.workbench-file-identity');
 await filename.waitFor();
 assert.equal(await vtName(filename),promotedShared,'filename maps to small identity label when Markdown H1 differs');
 assert.equal(await vtName(page.locator('.workbench-header h1.page-title')),'none','promoted Markdown H1 must not pretend to be the filename');
 await assertUniqueNames();
 // The workbench inspector uses one shared Motion layout indicator, not a page snapshot.
 await page.getByRole('button',{name:'详细信息'}).click();
 const inspector=page.getByRole('dialog',{name:'文档检查器'});
 await inspector.getByRole('tab',{name:'目录'}).click();
 assert.equal(await inspector.locator('.workbench-tab-indicator').count(),1);
 assert.equal(await inspector.getByRole('tab',{name:'目录'}).getAttribute('aria-selected'),'true');
 await inspector.getByRole('tab',{name:'版本'}).click();
 assert.equal(await inspector.locator('.workbench-tab-indicator').count(),1);
 await inspector.getByRole('button',{name:'关闭',exact:true}).click();
 await inspector.waitFor({state:'hidden'});

 await page.goto(base+'/');
 const recent=page.locator('.recent-page').filter({hasText:promoted.name}).first();
 await recent.waitFor();
 assert.equal(await vtName(recent.locator('.recent-page-name')),promotedShared);
 await recent.click();
 await page.waitForURL(base+'/records/'+promoted.id);
 await filename.waitFor();
 assert.equal(await vtName(filename),promotedShared);

 await page.goto(base+'/search?q='+encodeURIComponent(promoted.name)+'&mode=metadata');
 const hit=page.locator('.search-result').filter({hasText:promoted.name}).first();
 await hit.waitFor();
 assert.equal(await vtName(hit.locator('strong').first()),promotedShared);
 await assertUniqueNames();
 await hit.click();
 await page.waitForURL(base+'/records/'+promoted.id);
 await filename.waitFor();
 assert.equal(await vtName(filename),promotedShared);

 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('.crumbs').getByRole('link',{name:folderName}).click();
 await page.waitForURL(base+'/library/'+folder.id);
 assert.equal(await page.locator('.page-transition').getAttribute('data-phase'),'idle');
 assert.deepEqual(faults,[],'no browser runtime errors');
 console.log('PASS View Transitions: library/folder, plain/H1 documents, back, recent, search, reduced motion');
}finally{
 await browser.close();
}
