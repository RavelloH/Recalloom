import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source='# Block inspector E2E\n\nFirst paragraph.\n\nSecond paragraph.\n\n::: warning 注意\n\nTest callout.\n\n:::';
const create=async()=>page.evaluate(async content=>{
 const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Block Inspector '+Date.now()+'.md',kind:'document',content})});
 return {status:r.status,data:await r.json()};
},source);
fs.mkdirSync('tmp/editor-interaction-screens',{recursive:true});
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const rec=await create();assert.equal(rec.status,201);
  await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
  const paragraph=page.locator('.tiptap p').filter({hasText:'First paragraph.'}).first();
  await paragraph.waitFor();
  if(width===1280)await paragraph.hover();
  else await paragraph.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});
  const grip=page.getByRole('group',{name:'块把手'});
  await grip.waitFor();
  const before=await grip.evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),viewport:innerWidth}));
  assert.ok(before.rect.x>200,'grip should be at the right of the block');
  await grip.getByRole('button',{name:'块操作'}).click();
  await page.getByRole('menuitem',{name:'编辑块'}).last().click();
  const panel=page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
  await panel.waitFor();
  if(width!==1280)await page.waitForFunction(()=>Math.abs(document.querySelector('.rk-block-editor-panel')?.getBoundingClientRect().top??100)<1);
  const layout=await page.locator('.rk-editor-block-workspace').evaluate(el=>{
   const canvas=el.querySelector('.rk-editor-block-canvas').getBoundingClientRect();
   const pane=document.querySelector('.rk-block-editor-panel').getBoundingClientRect();
   return {canvas:{x:canvas.x,y:canvas.y,right:canvas.right,w:canvas.width},panel:{x:pane.x,y:pane.y,right:pane.right,w:pane.width},position:getComputedStyle(document.querySelector('.rk-block-editor-panel')).position,grid:getComputedStyle(el).gridTemplateColumns};
  });
  if(width===1280){
   assert.ok(layout.panel.x>=layout.canvas.right-1,'panel should be beside not over canvas: '+JSON.stringify(layout));
   assert.ok(layout.panel.w>=280,'panel width');
  }else assert.equal(layout.position,'fixed','mobile drawer is full screen');
  const raw=panel.getByRole('textbox',{name:'块源码'});
  assert.equal((await raw.inputValue()).trim(),'First paragraph.');
  await raw.fill('Rewritten paragraph.');
  await page.locator('.tiptap p').filter({hasText:'Rewritten paragraph.'}).first().waitFor();
  await panel.getByLabel('当前块预览').getByText('Rewritten paragraph.').waitFor();
  await raw.fill('# 试图转换为标题');
  await panel.getByRole('alert').waitFor();
  assert.equal(await page.locator('.tiptap p').filter({hasText:'Rewritten paragraph.'}).count(),1,'invalid draft should not mutate document');
  await raw.fill('Final paragraph.');
  await page.locator('.tiptap p').filter({hasText:'Final paragraph.'}).first().waitFor();
  if(width===1280){
   // Direct in-canvas typing must keep the inspector anchored and refresh the
   // raw source without mistaking an external edit for a replaced node.
   const editable=page.locator('.tiptap p').filter({hasText:'Final paragraph.'}).first();
   await editable.click();await page.keyboard.press('End');await page.keyboard.type('!');
   await page.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(el=>el.value.includes('Final paragraph.!')));
   assert.equal(await panel.count(),1,'panel remains open during direct edits to its own block');
   console.log('PASS live inspector stays in sync with inline typing');
  }
  await panel.getByRole('button',{name:'关闭块编辑'}).click();
  await page.screenshot({path:'tmp/editor-interaction-screens/block-'+width+'.png',fullPage:true});
  console.log('PASS live block inspector',width,JSON.stringify(layout));
  if(width===1280){
   const p=page.locator('.tiptap p').filter({hasText:'Final paragraph.'}).first();
   await p.hover();
   await page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'块操作'}).click();
   await page.getByRole('menuitem',{name:'下移块'}).last().click();
   await page.getByRole('button',{name:'源码'}).click();
   await page.context().grantPermissions(['clipboard-read','clipboard-write']);
   await page.locator('.cm-content').first().click();
   await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
   const code=await page.evaluate(()=>navigator.clipboard.readText());
   assert.ok(code.indexOf('Second paragraph.')<code.indexOf('Final paragraph.'),'move down changes source order');
   console.log('PASS move block down and source order',width);
  }
 }
 assert.deepEqual(errors,[],'browser errors');
}finally{await browser.close();}
