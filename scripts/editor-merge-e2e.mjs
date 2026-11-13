import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const engine=process.env.RECALLOOM_TEST_ENGINE==='webkit'?'webkit':'chromium';
const bin=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x)):undefined;
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
const secret=process.env.RECALLOOM_TEST_SECRET||line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(bin?{executablePath:bin}:{})});
const mobile=process.env.RECALLOOM_TEST_MOBILE==='1';
const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1200,height:850},isMobile:mobile,hasTouch:mobile});
const page=await context.newPage();
page.setDefaultTimeout(25000);
if(engine==='webkit'){
 let cookie='';
 await page.route('**/api/**',async route=>{
  const req=route.request();
  if(req.url().endsWith('/api/auth/login')){
   const result=await route.fetch();
   const match=/^(__Host-recalloom_session=[^;]+)/.exec(result.headers()['set-cookie']??'');
   if(match)cookie=match[1];
   await route.fulfill({response:result});return;
  }
  if(!cookie){await route.continue();return;}
  const response=await route.fetch({headers:{...(await req.allHeaders()),cookie}});
  await route.fulfill({response});
 });
}
const faults=[];page.on('pageerror',error=>faults.push(error.message));
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const create=async(content)=>page.evaluate(async content=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Three way merge '+Date.now()+'-'+Math.random().toString(36).slice(2)+'.md',kind:'document',content})});
  if(!response.ok)throw Error(await response.text());
  return response.json();
 },content);
 const get=async(id)=>page.evaluate(async id=>{
  const response=await fetch('/api/records/'+id);if(!response.ok)throw Error(await response.text());
  return response.json();
 },id);
 const update=async(id,revision,content)=>page.evaluate(async({id,revision,content})=>{
  const response=await fetch('/api/records/'+id+'/content',{method:'PATCH',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedRevision:revision,content,message:'Concurrent merge fixture'})});
  if(!response.ok)throw Error('Unexpected server write failure: '+await response.text());
  return response.json();
 },{id,revision,content});
 const refresh=async()=>page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 const content='# Merge\n\nAlpha\n\nBeta\n\nGamma\n';
 const record=await create(content);
 await page.goto(base+'/records/'+record.id+'?mode=source');
 const source=page.locator('.cm-content');
 await source.waitFor();
 const local=content.replace('Alpha','Alpha local');
 const remote=content.replace('Gamma','Gamma remote');
 await source.fill(local);
 await page.locator('.save-status').getByText('未保存').waitFor();
 await update(record.id,1,remote);await refresh();
 await page.getByRole('button',{name:'合并修改'}).waitFor();
 await page.getByRole('button',{name:'合并修改'}).click();
 const dialog=page.getByRole('dialog',{name:'三方合并审查'});
 await dialog.waitFor();
 await dialog.getByText('已找到可安全合并的独立修改').waitFor();
 assert.equal(await dialog.locator('[data-merge-conflict]').count(),0);
 const expected='# Merge\n\nAlpha local\n\nBeta\n\nGamma remote\n';
 assert.match(await dialog.locator('.rk-merge-output pre').innerText(),/Alpha local/);
 await dialog.getByRole('button',{name:'确认合并并保存'}).click();
 await dialog.waitFor({state:'hidden'});
 await page.locator('.save-status').getByText('已保存').waitFor();
 let saved=await get(record.id);
 assert.equal(saved.revision,3);assert.equal(saved.content,expected);
 console.log('PASS conflict-free merge reviewed and saved with latest R2 CAS',engine);

 const localOverlap=expected.replace('Alpha local','Alpha mine');
 const remoteOverlap=expected.replace('Alpha local','Alpha agent');
 await source.fill(localOverlap);
 await page.locator('.save-status').getByText('未保存').waitFor();
 await update(record.id,3,remoteOverlap);await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();
 await dialog.waitFor();
 await dialog.getByText(/处需要明确处理/).waitFor();
 assert.equal(await dialog.locator('[data-merge-conflict]').count(),1);
 const reviewLayout=await dialog.evaluate(el=>{
  const rect=el.getBoundingClientRect();
  const grid=el.querySelector('.rk-merge-variants');
  return {left:rect.left,right:rect.right,viewport:innerWidth,
   clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,
   gridColumns:getComputedStyle(grid).gridTemplateColumns.split(' ').length};
 });
 assert.ok(reviewLayout.left>=-2&&reviewLayout.right<=reviewLayout.viewport+2,
  'merge review dialog must fit the viewport: '+JSON.stringify(reviewLayout));
 assert.ok(reviewLayout.scrollWidth<=reviewLayout.clientWidth+2,
  'merge review may not overflow horizontally: '+JSON.stringify(reviewLayout));
 if(mobile){
  assert.equal(reviewLayout.gridColumns,1,'phone compares conflict variants vertically');
  // Wait for Astryx dialog entrance and any route snapshot to fully settle.
  await page.waitForTimeout(650);
  await page.screenshot({path:'tmp/merge-review-mobile-'+engine+'.png',fullPage:false});
 }

 assert.equal(await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).isDisabled(),true);
 await dialog.locator('[data-merge-conflict]').getByRole('button',{name:'保留本地'}).click();
 assert.equal(await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).isDisabled(),false);
 await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).click();
 await dialog.waitFor({state:'hidden'});
 await page.getByText('已保留合并前的本地草稿').waitFor();
 saved=await get(record.id);
 assert.equal(saved.revision,4,'conflict review may not write until user saves source');
 assert.equal(saved.content,remoteOverlap);
 assert.match(await source.innerText(),/Alpha mine/);
 assert.equal(await page.locator('.editor-section').getAttribute('data-base-revision'),'4');
 console.log('PASS overlapping changes require explicit choice and stage source without server write',engine);
 await page.reload();
 await page.getByText('已保留合并前的本地草稿').waitFor();
 await page.getByText('已恢复本标签页未保存的草稿').waitFor();
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Alpha mine'));
 console.log('PASS staged merge and original local backup both survive tab reload',engine);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.locator('.save-status').getByText('已保存').waitFor();
 await page.getByText('已恢复本标签页未保存的草稿').waitFor({state:'hidden'});
 saved=await get(record.id);
 assert.equal(saved.revision,5);
 assert.equal(saved.content,localOverlap);
 await page.getByRole('button',{name:'恢复合并前草稿'}).click();
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.dataset.baseRevision==='3');
 assert.match(await source.innerText(),/Alpha mine/);
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true,
  'restoring original R3 local text must not allow overwriting R5');
 await page.getByRole('button',{name:'放弃本地修改并加载新版'}).click();
 await page.getByRole('button',{name:'放弃本地修改',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.dataset.baseRevision==='5');
 console.log('PASS original local backup restores pinned older base and never allows stale overwrite',engine);

 const structured='# Rich\n\n::: callout tip\noriginal text\n:::\n\nEnd\n';
 const rich=await create(structured);
 await page.goto(base+'/records/'+rich.id+'?mode=source');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('original text'));
 const structuredLocal=structured.replace('original text','local text');
 const structuredRemote=structured.replace('End','End remote');
 await source.fill(structuredLocal);
 await update(rich.id,1,structuredRemote);await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();await dialog.waitFor();
 await dialog.getByText(/RMD \/ 结构性修改/).waitFor();
 assert.equal(await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).isDisabled(),true);
 await dialog.locator('[data-merge-conflict]').getByRole('button',{name:'保留本地'}).click();
 await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).click();
 await dialog.waitFor({state:'hidden'});
 saved=await get(rich.id);
 assert.equal(saved.revision,2,'structure-sensitive merge must never auto-save');
 assert.equal(saved.content,structuredRemote);
 // The mode stays "source", but editorKey intentionally resets CodeMirror
 // through AutoTransition(mode=wait). Read the NEW editor after its exit fade.
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('End remote'));
 assert.match(await source.innerText(),/local text/);
 assert.match(await source.innerText(),/End remote/);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.locator('.save-status').getByText('已保存').waitFor();
 saved=await get(rich.id);
 assert.equal(saved.revision,3);
 assert.equal(saved.content,structured.replace('original text','local text').replace('End','End remote'));
 console.log('PASS RMD structure requires manual selection, staged source review, and explicit save',engine);

 const race=await create(content);
 await page.goto(base+'/records/'+race.id+'?mode=source');
 // Wait for the NEW record editor, not the old snapshot still visible during
 // a WebKit View Transition from the previous RMD document.
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Alpha'));
 await source.fill(local);await update(race.id,1,remote);await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();await dialog.waitFor();
 // A second agent commits R3 after the merge preview was generated for R2.
 const newer=remote.replace('Beta','Beta updated again');
 await update(race.id,2,newer);
 await dialog.getByRole('button',{name:'确认合并并保存'}).click();
 await dialog.waitFor({state:'hidden'});
 saved=await get(race.id);
 assert.equal(saved.revision,3);
 assert.equal(saved.content,newer);
 assert.match(await source.innerText(),/Alpha local/);
 await page.getByText(/审查期间服务器再次更新|合并提交期间服务器再次更新/).waitFor();
 console.log('PASS preview invalidates safely when a second agent commits before CAS',engine);

 // The merge entrypoint must also read live ProseMirror content and reset
 // it only AFTER the user explicitly confirms the conflict-free preview.
 const visualBase='# Visual\n\nFirst plain paragraph\n\nSecond paragraph\n\nThird paragraph\n';
 const visualRecord=await create(visualBase);
 await page.goto(base+'/records/'+visualRecord.id+'?mode=visual');
 const visual=page.locator('.tiptap');
 await visual.waitFor();
 await visual.locator('p').filter({hasText:'First plain paragraph'}).first().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' local');
 await page.locator('.save-status').getByText('未保存').waitFor();
 const visualRemote=visualBase.replace('Third paragraph','Third paragraph remote');
 await update(visualRecord.id,1,visualRemote);await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();
 await dialog.waitFor();
 await dialog.getByText('已找到可安全合并的独立修改').waitFor();
 await dialog.getByRole('button',{name:'确认合并并保存'}).click();
 await dialog.waitFor({state:'hidden'});
 await page.locator('.save-status').getByText('已保存').waitFor();
 await page.waitForFunction(()=>document.querySelector('.tiptap')?.textContent?.includes('Third paragraph remote'));
 const result=await get(visualRecord.id);
 assert.equal(result.revision,3);
 assert.match(result.content,/First plain paragraph local/);
 assert.match(result.content,/Third paragraph remote/);
 console.log('PASS visual ProseMirror merge captures latest draft and preserves both branches',engine);

 // A second manual merge must never overwrite the first still-unresolved
 // local backup. User must explicitly restore or delete it first.
 const backupBase='# Backup\n\nOne\n\nTwo\n';
 const backupRecord=await create(backupBase);
 await page.goto(base+'/records/'+backupRecord.id+'?mode=source');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('One'));
 const backupLocal=backupBase.replace('One','One LOCAL');
 await source.fill(backupLocal);
 await update(backupRecord.id,1,backupBase.replace('One','One REMOTE'));await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();await dialog.waitFor();
 await dialog.locator('[data-merge-conflict]').getByRole('button',{name:'保留本地'}).click();
 await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).click();
 await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.dataset.baseRevision==='2');
 const firstBackup=await page.evaluate(id=>{
  const value=Object.entries(sessionStorage).find(([key])=>key.startsWith('recalloom:merge-backup:')&&key.endsWith(':'+id))?.[1];
  return value?JSON.parse(value):null;
 },backupRecord.id);
 assert.equal(firstBackup?.baseRevision,1);
 assert.equal(firstBackup?.localContent,backupLocal);
 await update(backupRecord.id,2,backupBase.replace('One','One REMOTE AGAIN'));await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();await dialog.waitFor();
 await dialog.locator('[data-merge-conflict]').getByRole('button',{name:'保留本地'}).click();
 await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).click();
 await dialog.waitFor({state:'hidden'});
 await page.getByText(/已有更早的合并草稿备份/).waitFor();
 const afterBackup=await page.evaluate(id=>{
  const value=Object.entries(sessionStorage).find(([key])=>key.startsWith('recalloom:merge-backup:')&&key.endsWith(':'+id))?.[1];
  return value?JSON.parse(value):null;
 },backupRecord.id);
 assert.deepEqual(afterBackup,firstBackup,'existing backup may not be silently replaced');
 assert.equal((await get(backupRecord.id)).revision,3);
 assert.match(await source.innerText(),/One LOCAL/);
 console.log('PASS repeated conflicts cannot overwrite an earlier unhandled local backup',engine);
 assert.deepEqual(faults,[]);
}finally{
 if(engine==='webkit')await page.unrouteAll({behavior:'ignoreErrors'});
 await context.close();
 await browser.close();
}
