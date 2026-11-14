import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8827';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&binary);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source='# Block inspector E2E\n\nFirst paragraph.\n\nSecond paragraph.\n\n::: warning 注意\n\nTest callout.\n\n:::';
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const rec=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Block Inspector '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);assert.equal(rec.status,201);
  await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
  const paragraph=page.locator('.tiptap p').filter({hasText:'First paragraph.'}).first();
  await paragraph.hover();
  assert.equal(await page.getByRole('group',{name:'块把手'}).count(),0,'plain paragraphs should have no grip');
  const callout=page.locator('.tiptap .rk-directive-warning').first();
  await callout.hover(); // This browser context has a fine pointer even at 390px.
  const grip=page.getByRole('group',{name:'块把手'});await grip.waitFor();
  await grip.getByRole('button',{name:'块操作'}).click();
  await page.getByRole('menuitem',{name:'编辑块'}).last().click();
  const panel=page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
  await panel.waitFor();
  const layout=await page.evaluate(()=>{
   const pane=document.querySelector('.rk-block-editor-panel');
   const workspace=document.querySelector('.rk-editor-block-workspace');
   return {position:getComputedStyle(pane).position,
    canvas:workspace.querySelector('.rk-editor-block-canvas').getBoundingClientRect().toJSON(),
    workspace:workspace.getBoundingClientRect().toJSON(),
    panel:pane.getBoundingClientRect().toJSON(),sharedShell:!!pane.closest('.workspace-panel-content')};
  });
  assert.equal(layout.sharedShell,true,'block content uses the shared workspace panel shell');
  if(width===1280)assert.ok(Math.abs(layout.canvas.width-layout.workspace.width)<1,'panel content must not create a second editor column');
  else assert.ok(layout.panel.width<=390&&layout.panel.width>=360,'mobile panel content fits the bottom sheet');
  await panel.getByRole('tab',{name:'源码',exact:true}).click();
  await panel.getByText('效果预览',{exact:true}).click();
  const raw=panel.getByRole('textbox',{name:'块源码',includeHidden:true});
  assert.match(await raw.inputValue(),/::: warning 注意/);
  await raw.fill('::: warning 注意\n\nRewritten callout.\n\n:::');
  await callout.getByText('Rewritten callout.').waitFor();
  await panel.locator('.rk-block-panel-preview').getByText('Rewritten callout.').waitFor();
  await raw.fill('# 试图转换为标题');
  await panel.locator('textarea[aria-invalid="true"]').waitFor();
  assert.equal(await callout.getByText('Rewritten callout.').count(),1,'invalid draft cannot mutate document');
  await raw.fill('::: warning 注意\n\nFinal callout.\n\n:::');
  await callout.getByText('Final callout.').waitFor();
  if(width===1280){
   const editable=callout.locator('.rk-directive-body p').first();
   await editable.click();await page.keyboard.press('End');await page.keyboard.type('!');
   await page.waitForFunction(()=>[...document.querySelectorAll('.rk-block-editor-panel textarea')].some(el=>el.value.includes('Final callout.!')));
   assert.equal(await panel.count(),1,'Drawer remains during direct editing');
  }
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  console.log('PASS fixed external block Drawer and live inspector',width,JSON.stringify(layout));
  if(width===1280){
   await callout.hover();
   await page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'块操作'}).click();
   await page.getByRole('menuitem',{name:'上移块'}).last().click();
   await page.getByRole('button',{name:'源码'}).click();
   await page.context().grantPermissions(['clipboard-read','clipboard-write']);
   await page.locator('.cm-content').first().click();
   await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
   const code=await page.evaluate(()=>navigator.clipboard.readText());
   assert.ok(code.indexOf('Final callout.')<code.indexOf('Second paragraph.'),'move up should reorder RMD block');
   console.log('PASS block move up and source order');
  }
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
