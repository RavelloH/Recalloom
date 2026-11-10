import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function rightClickSelectedGlyphs(line){
 for(let attempt=0;attempt<4;attempt++){
  const pt=await page.evaluate(()=>{
   const selected=getSelection();
   if(!selected||selected.isCollapsed||!selected.rangeCount)return null;
   const r=selected.getRangeAt(0).getBoundingClientRect();
   return r.width>0?{x:r.left+r.width*.5,y:r.top+r.height*.5}:null;
  });
  if(pt){await page.mouse.click(pt.x,pt.y,{button:'right'});return;}
  // The reactive BubbleMenu can take focus while mounting. Restore the
  // intended glyph selection rather than mistaking a transient race for a
  // semantic edit or right-click failure.
  await line.click();await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(80);
 }
 throw Error('right-click needs a stable glyph selection after four retries');
}
const input='# Editor context actions\n\nFirst line.\n\nSecond line.\n\n::: warning 右键块\n\n可选择的块内容。\n\n:::';
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Editor context '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },input);assert.equal(rec.status,201);
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 const first=page.locator('.tiptap p').filter({hasText:'First line.'}).first();
 await first.waitFor();
 await first.click();
 await page.keyboard.press('End');
 await page.keyboard.press('Shift+Home');
 assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'First line.','desktop ContextMenu wrapper must preserve text selection');
 const selCss=await page.locator('.tiptap').evaluate(el=>getComputedStyle(el).userSelect);
 assert.notEqual(selCss,'none','text selection cannot be disabled');
 await rightClickSelectedGlyphs(first);
 const context=page.getByRole('menu',{name:'编辑器右键菜单'});await context.waitFor();
 const popupWidth=await context.evaluate(el=>el.getBoundingClientRect().width);
 assert.ok(popupWidth>=170&&popupWidth<=275,'right-click popup must be narrow, not fullscreen: '+popupWidth);
 assert.ok(await context.locator('[role="menuitem"] svg').count()>=3,'menu actions need leading icons');
 assert.ok(await context.getByRole('group',{name:'常用文字格式'}).count()>=1,'selected glyph context should show organized text commands');
 assert.equal(await context.getByRole('group',{name:'块操作'}).count(),0,'selected glyph context must not show block commands');
 console.log('PASS compact text-only context menu',popupWidth);
 await page.keyboard.press('Escape');
 await first.click(); // clear text selection before invoking a paragraph-block context
 await first.click({button:'right'});
 const blockContext=page.getByRole('menu',{name:'编辑器右键菜单'});await blockContext.waitFor();
 assert.equal(await blockContext.getByRole('group',{name:'常用文字格式'}).count(),0,'paragraph context must not inherit unrelated text commands');
 await blockContext.getByRole('menuitem',{name:'复制块',exact:true}).click();
 await page.waitForTimeout(120);
 assert.equal(await page.locator('.tiptap p').filter({hasText:'First line.'}).count(),2,'right-click duplicates only selected block');
 await first.click({button:'right'});
 await page.getByRole('menu').last().getByRole('menuitem',{name:'撤销',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.tiptap p')].filter(p=>p.textContent?.includes('First line.')).length===1);
 await first.click({button:'right'});
 await page.getByRole('menu').last().getByRole('menuitem',{name:'重做',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.tiptap p')].filter(p=>p.textContent?.includes('First line.')).length===2);
 console.log('PASS context menu undo/redo of block operations');
 const another=page.locator('.tiptap p').filter({hasText:'Second line.'}).first();
 await another.click();
 await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'Second line.');
 await rightClickSelectedGlyphs(another);
 const selectionMenu=page.getByRole('menu',{name:'编辑器右键菜单'});await selectionMenu.waitFor();
 await selectionMenu.getByRole('menuitem',{name:'荧光笔与手绘标记'}).click();
 await page.getByRole('menuitem',{name:'手绘圈选'}).last().click();
 await page.locator('.tiptap .rk-sketch-inline[data-rk-sketch-kind="circle"]').first().waitFor();
 console.log('PASS desktop context menu: select, duplicate, handdrawn mark');
 await another.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await rightClickSelectedGlyphs(another);
 const formatMenu=page.getByRole('menu',{name:'编辑器右键菜单'});await formatMenu.waitFor();
 await formatMenu.getByRole('menuitem',{name:'普通下划线'}).click();
 await page.locator('.tiptap u').filter({hasText:'Second line.'}).first().waitFor();
 console.log('PASS context menu restores selection for standard Markdown formatting');
 const callout=page.locator('.tiptap .rk-directive-warning').first();
 await callout.click({button:'right'});
 await page.getByRole('menu').last().waitFor();
 assert.equal(await callout.evaluate(el=>el.classList.contains('rk-block-selected')),true,'right click should outline the chosen ::: block');
 await page.keyboard.press('Escape');
 console.log('PASS selected explicit block outline');
 await another.click();
 await page.keyboard.press('End');
 await page.keyboard.press('Shift+F10');
 const keyMenu=page.getByRole('menu').last();
 await keyMenu.waitFor();
 await keyMenu.getByRole('menuitem',{name:'编辑块'}).click();
 await page.getByRole('complementary',{name:'块编辑面板'}).waitFor();
 console.log('PASS keyboard Shift+F10 context menu and edit panel');
 await page.getByRole('button',{name:'关闭块编辑'}).click();
 await page.setViewportSize({width:390,height:844});
 // Width is no longer an input-device proxy. A 390px fine-pointer
 // viewport retains desktop context commands; the separate V5 suite tests
 // actual coarse-pointer phone/iPad emulation.
 assert.equal(await page.evaluate(()=>matchMedia('(hover: hover) and (pointer: fine)').matches),true);
 assert.equal(await page.locator('.rk-editor-context-area').count(),1,
  'narrow fine-pointer windows retain the desktop context menu');
 await page.locator('.tiptap p').filter({hasText:'Second line.'}).first().click();
 await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'Second line.','mobile editing selection remains native');
 console.log('PASS narrow fine-pointer viewport retains editable selection and desktop context support');
 assert.deepEqual(errors,[]);
}finally{await browser.close()}
