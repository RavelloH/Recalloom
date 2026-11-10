import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
assert.ok(secret);
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(binary);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const create=async(content,name)=>page.evaluate(async({content,name})=>{
 const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,kind:'document',content})});
 return {status:r.status,data:await r.json()};
},{content,name:name+Date.now()+'.md'});
const selectMenu=async query=>{
 const edit=page.locator('.tiptap[contenteditable="true"]');
 await edit.waitFor();
 await edit.locator('p').last().click();
 await page.keyboard.press('Control+End');
 await page.keyboard.press('Enter');
 await page.keyboard.type('/'+query);
 const list=page.getByRole('listbox',{name:'插入内容'});await list.waitFor();
 return list;
};
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const created=await create('# Block command gallery\n\nStart.','Slash RMD blocks');
  assert.equal(created.status,201,JSON.stringify(created).slice(0,300));
  await page.goto(base+'/records/'+created.data.id+'?mode=visual');
  const gallery=await selectMenu('');
  const categories=await gallery.locator('.slash-category-heading').allTextContents();
  assert.deepEqual(categories,['基础','布局','提示','手绘','学习','引用','媒体','格式','行内'],'all syntax families must be discoverable');
  const first=gallery;
  await first.getByRole('option',{name:/危险 Callout/}).click();
  await page.locator('.tiptap .rk-directive-danger').first().waitFor();
  const sketchMenu=await selectMenu('块级手绘');
  const kinds=await sketchMenu.getByRole('option').allTextContents();
  assert.ok(kinds.some(s=>s.includes('方框')));
  assert.ok(kinds.some(s=>s.includes('双下划线')));
  await sketchMenu.getByRole('option',{name:/块级手绘 方框/}).click();
  await page.locator('.tiptap .rk-directive-box .rk-sketch-block').first().waitFor();
  await page.getByRole('button',{name:'源码'}).click();
  const code=await page.locator('.cm-content').first().innerText();
  assert.match(code,/::: danger 危险\n/,'callout serializes');
  assert.match(code,/::: box\n/,'sketch block serializes');
  assert.ok(!code.includes('/危险')&&!code.includes('/块级手绘'),'slash marker consumed');
  console.log('PASS 8 Callout and 6 sketch slash discovery + block source',width);
  const target=await create('# Wiki target\n\nThis is linked content.','Wiki menu target');
  assert.equal(target.status,201);
  const pageRecord=await create('# Wiki embed menu\n\nInsert below.','Wiki menu source');
  assert.equal(pageRecord.status,201);
  await page.goto(base+'/records/'+pageRecord.data.id+'?mode=visual');
  const menu=await selectMenu('嵌入');
  await menu.getByRole('option',{name:/嵌入 Wiki 文档/}).click();
  const picker=page.getByRole('listbox',{name:'引用文档'});
  await picker.waitFor();
  assert.match((await picker.innerText()),/嵌入文档/);
  await page.keyboard.type('Wiki menu target');
  await picker.getByRole('option',{name:/Wiki menu target/}).first().waitFor({timeout:15000});
  await picker.getByRole('option',{name:/Wiki menu target/}).first().click();
  await page.locator('.tiptap .wiki-editor-embed').first().waitFor();
  await page.getByRole('button',{name:'源码'}).click();
  const after=await page.locator('.cm-content').first().innerText();
  assert.match(after,new RegExp('::: embed id:'+target.data.id+' :::'));
  console.log('PASS Wiki Embed slash -> target picker -> stable UUID source',width);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close()}
