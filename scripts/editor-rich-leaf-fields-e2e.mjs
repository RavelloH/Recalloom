import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8826';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&executablePath);
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source=['# Link-card and Wiki Embed editor',
'',
'::: link-card https://github.com/RavelloH/Recalloom | title=Repository :::',
'',
'::: embed id:550e8400-e29b-41d4-a716-446655440000 :::'].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const rec=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Leaf attrs '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);
  assert.equal(rec.status,201);
  await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
  const card=page.locator('.tiptap .rk-rich-link-card').first();
  await card.waitFor();
  assert.equal(await page.getByRole('button',{name:'编辑链接地址'}).count(),0,'old pencil removed');
  await card.getByRole('button',{name:'编辑链接卡片'}).click();
  const panel=page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
  await panel.waitFor();
  assert.equal(await panel.getByRole('region',{name:'链接卡片属性'}).count(),1);
  const url=panel.getByRole('textbox',{name:'页面 URL'});
  assert.match(await url.inputValue(),/github.com/);
  await url.fill('javascript:alert(1)');
  assert.match(await panel.getByRole('alert').innerText(),/HTTP/);
  assert.match(await panel.getByRole('textbox',{name:'块源码'}).inputValue(),/github.com/);
  await url.fill('https://example.com/docs');
  await panel.getByRole('textbox',{name:'卡片标题'}).fill('Updated Card');
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-block-editor-panel textarea')].some(el=>el.value.includes('https://example.com/docs')&&el.value.includes('Updated Card')));
  const cardTitle=page.locator('.tiptap .rk-rich-link-card .rk-link-card-title');
  await cardTitle.getByText('Updated Card').waitFor();
  await panel.getByRole('button',{name:'关闭块编辑'}).click();
  // The Wiki embed uses the same existing grip to reach its structured fields.
  const wiki=page.locator('.tiptap .wiki-editor-embed').first();
  await wiki.waitFor();
  if(width===1280)await wiki.hover();
  else await wiki.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});
  const grip=page.getByRole('group',{name:'块把手'});
  await grip.waitFor();
  await grip.getByRole('button',{name:'块操作'}).click();
  await page.getByRole('menuitem',{name:'编辑块'}).last().click();
  await panel.waitFor();
  assert.equal(await panel.getByRole('region',{name:'引用文档属性'}).count(),1);
  const target=panel.getByRole('textbox',{name:'引用目标（UUID 或绝对路径）'});
  assert.equal(await target.inputValue(),'id:550e8400-e29b-41d4-a716-446655440000');
  await target.fill('My document');
  assert.match(await panel.getByRole('alert').innerText(),/UUID/);
  await target.fill('/Projects/Recalloom/README.md#quickstart');
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-block-editor-panel textarea')].some(el=>el.value.includes('/Projects/Recalloom/README.md#quickstart')));
  await panel.getByRole('button',{name:'关闭块编辑'}).click();
  const persisted=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,rec.data.id);
  assert.equal(persisted,source,'client-side changes never persist without explicit save');
  await page.getByRole('button',{name:'源码'}).click();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const result=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(result,/::: link-card https:\/\/example\.com\/docs \| title=Updated Card :::/);
  assert.match(result,/::: embed \/Projects\/Recalloom\/README.md#quickstart :::/);
  console.log('PASS LinkCard and Wiki Embed shared Drawer',width);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
