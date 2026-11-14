import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8827';
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&executablePath);
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(16000);
const input=['RMD 容器 ID 唯一性验收：以下标题保留在正文，以验证与容器锚点冲突。','','# Stable container anchors @ attrs shared-anchor @','',
'::: warning Caution','','Original warning.','',':::','',
'::: highlight','','Important highlight.','',':::','',
':::: chat Discussion | id=conversation-one','','::: message Alice | sender=user','','A message.','',':::','','::: message Agent | sender=assistant','','An answer.','',':::','','::::','',
':::: tabs Options | id=tabs-one','','::: tab First','','First tab content.','',':::','','::: tab Second','','Second tab content.','',':::','','::::'].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const rec=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Container anchor '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },input);assert.equal(rec.status,201);
  await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
  const open=async(kind)=>{
   const block=page.locator('.tiptap .rk-directive-'+kind).first();await block.waitFor();
   if(width===1280)await block.hover();else await block.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});
   await page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'块操作'}).click();
   await page.getByRole('menuitem',{name:'编辑块'}).last().click();
   const panel=page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
   await panel.waitFor();return panel;
  };
  let panel=await open('warning');
  const stableId=panel.getByRole('textbox',{name:'容器锚点 ID（可选）'});
  await stableId.fill('9invalid');
  await panel.getByRole('alert').waitFor();
  assert.equal(await page.locator('#user-content-9invalid').count(),0);
  await stableId.fill('SHARED-ANCHOR');
  const duplicateFieldError=panel.getByRole('alert').filter({hasText:'标题'});
  await duplicateFieldError.waitFor();
  assert.equal(await page.locator('#user-content-shared-anchor').count(),1,'the existing heading anchor must remain unique; the container must not duplicate it');
  await stableId.fill('Block-Caution');
  await page.waitForFunction(()=>!!document.querySelector('.tiptap #user-content-block-caution'));
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-block-editor-panel textarea')].some(el=>el.value.includes('id=block-caution')));
  const rawSource=panel.getByRole('textbox',{name:'块源码',includeHidden:true});
  const duplicateRaw=(await rawSource.inputValue()).replace('id=block-caution','id=shared-anchor');
  await panel.getByRole('tab',{name:'源码',exact:true}).click();
  await rawSource.fill(duplicateRaw);
  await panel.getByRole('alert').filter({hasText:'标题'}).waitFor();
  assert.equal(await page.locator('.rk-editor-block-canvas #user-content-block-caution').count(),1,'invalid raw source must leave the editable canvas anchor unchanged');
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  panel=await open('highlight');
  await panel.getByRole('textbox',{name:'容器锚点 ID（可选）'}).fill('marker-one');
  await page.waitForFunction(()=>!!document.querySelector('.tiptap #user-content-marker-one'));
  assert.match(await panel.getByRole('textbox',{name:'块源码',includeHidden:true}).inputValue(),/id=marker-one/);
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  if(width===1280){
   const block=page.locator('.tiptap .rk-directive-warning').first();await block.hover();
   await page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'块操作'}).click();
   await page.getByRole('menuitem',{name:'复制块',exact:true}).last().click();
   assert.equal(await page.locator('.tiptap #user-content-block-caution').count(),1,'duplicate must clear stable identity');
  }
  assert.equal(await page.locator('.tiptap #user-content-conversation-one .rk-chat-row').count(),2,'Chat anchored wrapper keeps both Astryx message rows');
  assert.equal(await page.locator('.tiptap #user-content-tabs-one .rk-tab-edit').count(),2,'Tabs anchored wrapper keeps inner children');
  await page.getByRole('button',{name:'源码'}).click();
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const source=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(source,/id=block-caution/);
  assert.match(source,/id=marker-one/);
  assert.match(source,/id=conversation-one/);
  assert.match(source,/id=tabs-one/);
  const persisted=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,rec.data.id);
  assert.equal(persisted,input,'local edits never auto-write D1');
  await page.getByRole('button',{name:'预览'}).click();
  await page.locator('#user-content-block-caution').first().waitFor();
  await page.locator('#user-content-marker-one').first().waitFor();
  await page.locator('#user-content-conversation-one').first().waitFor();
  await page.locator('#user-content-tabs-one').first().waitFor();
  assert.equal(await page.locator('#user-content-conversation-one .rk-chat-row').count(),2,'preview Chat wrapper preserves Astryx rows');
  const overflow=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth}));
  assert.ok(overflow.body<=overflow.viewport+1,'anchored rich container must not widen document: '+JSON.stringify(overflow));
  assert.equal(await page.locator('#user-content-block-caution').count(),width===1280?1:1);
  console.log('PASS stable RMD container id validate, visual/source/preview and safe duplication',width);
 }
}finally{await browser.close()}
