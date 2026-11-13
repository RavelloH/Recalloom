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
   body:JSON.stringify({name:'Merge manual review '+Date.now()+'-'+Math.random().toString(36).slice(2)+'.md',kind:'document',content})});
  if(!response.ok)throw Error(await response.text());
  return response.json();
 },content);
 const get=async id=>page.evaluate(async id=>{
  const response=await fetch('/api/records/'+id);if(!response.ok)throw Error(await response.text());
  return response.json();
 },id);
 const update=async(id,revision,content)=>page.evaluate(async({id,revision,content})=>{
  const response=await fetch('/api/records/'+id+'/content',{method:'PATCH',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedRevision:revision,content,message:'Manual merge fixture'})});
  if(!response.ok)throw Error(await response.text());
  return response.json();
 },{id,revision,content});
 const refresh=async()=>page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 const baseText='# Manual\n\nAlpha\n\nMiddle\n\nBeta\n\nTail\n';
 const local=baseText.replace('Alpha','Alpha LOCAL').replace('Beta','Beta LOCAL');
 const remote=baseText.replace('Alpha','Alpha REMOTE').replace('Beta','Beta REMOTE').replace('Tail','Tail remote');
 const record=await create(baseText);
 await page.goto(base+'/records/'+record.id+'?mode=source');
 const source=page.locator('.cm-content');await source.waitFor();
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Alpha'));
 await source.fill(local);
 await page.locator('.save-status').getByText('未保存').waitFor();
 await update(record.id,1,remote);await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();
 const dialog=page.getByRole('dialog',{name:'三方合并审查'});await dialog.waitFor();
 assert.equal(await dialog.locator('[data-merge-conflict]').count(),2,
  'adjacent independent remote lines must not merge into the conflicted Beta block');
 const first=dialog.locator('[data-merge-conflict]').nth(0);
 const second=dialog.locator('[data-merge-conflict]').nth(1);
 await first.getByRole('button',{name:'手动编辑结果'}).click();
 const custom=first.getByRole('textbox',{name:'冲突 1 的最终内容'});
 await custom.waitFor();
 assert.match(await custom.inputValue(),/Alpha LOCAL/);
 await custom.fill('Alpha COMBINED\n');
 await second.getByRole('button',{name:'采用远端'}).click();
 const expected='# Manual\n\nAlpha COMBINED\n\nMiddle\n\nBeta REMOTE\n\nTail remote\n';
 await dialog.getByText('未发现明显的围栏或容器闭合问题').waitFor();
 await dialog.getByRole('button',{name:'渲染'}).click();
 await dialog.locator('[data-merge-render]').waitFor();
 await dialog.locator('[data-merge-render]').getByText('Alpha COMBINED').waitFor();
 await dialog.locator('[data-merge-render]').getByText('Tail remote').waitFor();
 const geometry=await dialog.evaluate(el=>{
  const rect=el.getBoundingClientRect();
  const custom=el.querySelector('.rk-merge-custom textarea');
  const viewer=el.querySelector('[data-merge-render]');
  return{left:rect.left,right:rect.right,viewport:innerWidth,
   scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
   customWidth:custom?.scrollWidth,customClientWidth:custom?.clientWidth,
   viewerWidth:viewer?.scrollWidth,viewerClientWidth:viewer?.clientWidth};
 });
 assert.ok(geometry.left>=-2&&geometry.right<=geometry.viewport+2,
  'merge dialog must fit viewport: '+JSON.stringify(geometry));
 assert.ok(geometry.scrollWidth<=geometry.clientWidth+2,
  'merge dialog must not overflow horizontally: '+JSON.stringify(geometry));
 assert.ok(geometry.customWidth<=geometry.customClientWidth+2,
  'custom textarea must not introduce horizontal overflow: '+JSON.stringify(geometry));
 assert.ok(geometry.viewerWidth<=geometry.viewerClientWidth+2,
  'RMD rendered preview must scroll within dialog: '+JSON.stringify(geometry));
 if(mobile){
  await page.waitForTimeout(500);
  await page.screenshot({path:'tmp/merge-manual-mobile-'+engine+'.png',fullPage:false});
 }
 console.log('PASS custom edited conflict renders with independent remote content',engine);
 await dialog.getByRole('button',{name:'差异'}).click();
 assert.match(await dialog.locator('.rk-merge-output pre').innerText(),/Alpha COMBINED/);
 await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).click();
 await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.dataset.baseRevision==='2');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Tail remote'));
 assert.match(await source.innerText(),/Alpha COMBINED/);
 const beforeSave=await get(record.id);
 assert.equal(beforeSave.revision,2);
 assert.equal(beforeSave.content,remote);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.locator('.save-status').getByText('已保存').waitFor();
 const afterSave=await get(record.id);
 assert.equal(afterSave.revision,3);
 assert.equal(afterSave.content,expected);
 console.log('PASS manually edited conflict staged safely then saved via R2 CAS',engine);

 const text2='# Unclosed\n\nAlpha\n\nEnd\n';
 const record2=await create(text2);
 await page.goto(base+'/records/'+record2.id+'?mode=source');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Alpha'));
 await source.fill(text2.replace('Alpha','Local'));
 await update(record2.id,1,text2.replace('Alpha','Remote'));await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();await dialog.waitFor();
 await dialog.locator('[data-merge-conflict]').getByRole('button',{name:'手动编辑结果'}).click();
 const custom2=dialog.getByRole('textbox',{name:'冲突 1 的最终内容'});
 await custom2.fill('::: tip 建议\nUnclosed\n');
 await dialog.getByText(/发现可能导致渲染异常的结构问题/).waitFor();
 await dialog.getByText(/缺少关闭围栏/).waitFor();
 assert.equal(await dialog.getByRole('button',{name:'确认合并并保存'}).count(),0);
 await dialog.getByRole('button',{name:'渲染'}).click();
 await dialog.locator('[data-merge-render]').waitFor();
 await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).click();
 await dialog.waitFor({state:'hidden'});
 const check=await get(record2.id);
 assert.equal(check.revision,2);
 assert.equal(check.content,text2.replace('Alpha','Remote'));
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Unclosed'));
 console.log('PASS malformed RMD custom conflict is flagged and never auto-saved',engine);

 const record3=await create('# Delete\n\nRemove me\n\nLast\n');
 await page.goto(base+'/records/'+record3.id+'?mode=source');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Remove me'));
 await source.fill('# Delete\n\nLocal edit\n\nLast\n');
 await update(record3.id,1,'# Delete\n\nRemote edit\n\nLast\n');await refresh();
 await page.getByRole('button',{name:'合并修改'}).click();await dialog.waitFor();
 await dialog.locator('[data-merge-conflict]').getByRole('button',{name:'手动编辑结果'}).click();
 const custom3=dialog.getByRole('textbox',{name:'冲突 1 的最终内容'});
 await custom3.fill('');
 await dialog.getByRole('button',{name:'载入源码审核（不保存）'}).click();
 await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.dataset.baseRevision==='2');
 // Wait until the OLD editor has left its AutoTransition; it still displays
 // "Local edit" during the exit fade even after the new draft is staged.
 await page.waitForFunction(()=>!document.querySelector('.cm-content')?.textContent?.includes('Local edit'));
 const removal=await source.innerText();
 assert.doesNotMatch(removal,/Local edit|Remote edit/);
 assert.equal((await get(record3.id)).revision,2);
 console.log('PASS empty manual conflict result supports explicit deletion without writing server',engine);
 assert.deepEqual(faults,[]);
}finally{
 if(engine==='webkit')await page.unrouteAll({behavior:'ignoreErrors'});
 await context.close();
 await browser.close();
}
