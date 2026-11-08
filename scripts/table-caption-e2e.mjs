import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const origin=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8789';
const path=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(path&&secretLine);
const secret=secretLine.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const source=['# Captioned GFM table test','',
'| 参数 | 数值 |','| :--- | ---: |','| 电压 | 220 V |','| 电流 | 5 A |','',
': 系统参数 {#tbl-params}','',
'如上表所示。'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:path,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
page.setDefaultTimeout(17500);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const read=async id=>page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()),id);
try{
 await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/',{timeout:22000});
 const create=await page.evaluate(async source=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'document',name:'Table caption '+Date.now()+'.md',content:source})});
  return {status:r.status,data:await r.json()};
 },source);
 assert.equal(create.status,201,JSON.stringify(create));
 const id=create.data.id;
 await page.goto(origin+'/records/'+id,{waitUntil:'domcontentloaded'});
 const root=page.locator('.tiptap');await root.waitFor();
 const wrapper=root.locator('.rk-hscroll[data-rk-table-id="tbl-params"]');
 await wrapper.waitFor();
 assert.equal(await wrapper.locator('table').count(),1);
 assert.equal(await wrapper.locator('.rk-table-caption').textContent(),'系统参数');
 assert.equal(await wrapper.getAttribute('id'),'user-content-tbl-params');
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'opening does not dirty');
 await root.locator('td').first().click();
 const trigger=page.getByRole('button',{name:'编辑表格图注与 ID'});
 await trigger.waitFor({state:'visible'});
 await trigger.click();
 const edit=page.getByRole('group',{name:'编辑表格图注与 ID'});
 await edit.waitFor();
 await edit.getByRole('textbox',{name:'表格图注'}).fill('更新后的系统参数');
 await edit.getByRole('button',{name:'保存表注'}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  // Editor save is explicit; no PATCH until user presses global Save.
  return r.ok;
 },id);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isEnabled(),'table change must mark draft dirty');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  if(!r.ok)return false;
  return (await r.json()).content.includes(': 更新后的系统参数 {#tbl-params}');
 },id,{timeout:20000,polling:200});
 const stored=await read(id);
 assert.ok(stored.content.includes(': 更新后的系统参数 {#tbl-params}'),stored.content);
 assert.ok(stored.content.includes('| 电流 | 5 A |'),stored.content);
 await page.reload({waitUntil:'domcontentloaded'});
 await wrapper.waitFor();
 assert.equal(await wrapper.locator('.rk-table-caption').textContent(),'更新后的系统参数');
 await page.setViewportSize({width:320,height:740});
 const bounds=await root.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,caption:el.querySelector('.rk-table-caption')?.getBoundingClientRect().width}));
 assert.ok(bounds.scroll<=bounds.width+2,'mobile editor must not overflow horizontally: '+JSON.stringify(bounds));
 // The same Markdown must supply a safe read-only table caption in a Wiki embed.
 const host=await page.evaluate(async({id})=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({kind:'document',name:'Table caption embed '+Date.now()+'.md',
   content:'# Embedded table\n\n{{embed:id:'+id+'}}'})});
  return {status:r.status,data:await r.json()};
 },{id});
 assert.equal(host.status,201,JSON.stringify(host));
 await page.goto(origin+'/records/'+host.data.id,{waitUntil:'domcontentloaded'});
 const preview=page.locator('.markdown-preview .rk-table-caption-read');
 await preview.waitFor({timeout:25000});
 assert.equal(await preview.textContent(),'更新后的系统参数');
 assert.equal(await preview.getAttribute('id'),'user-content-tbl-params');
 assert.equal(await preview.getAttribute('data-rk-table-id'),'tbl-params');
 assert.equal(await page.locator('.markdown-preview table').count(),1);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'Wiki render cannot dirty source');
 assert.deepEqual(errors,[]);
 console.log('PASS captioned GFM table source roundtrip, explicit edit/save/reopen, stable ID, Wiki projection, 390/320px layout, no phantom edits');
}finally{await browser.close().catch(()=>{});}
