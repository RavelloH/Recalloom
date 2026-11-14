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
page.setDefaultTimeout(13000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const source=[
 '# Nested editor',
 '',
 ':::: chat Conversation',
 '',
 '::: message Alice | sender=user',
 '',
 'First message.',
 '',
 ':::',
 '',
 '::: message Bot | sender=assistant',
 '',
 'Second message.',
 '',
 ':::',
 '',
 '::::',
 '',
 ':::: tabs Items',
 '',
 '::: tab First',
 '',
 'First tab.',
 '',
 ':::',
 '',
 '::: tab Second',
 '',
 'Second tab.',
 '',
 ':::',
 '',
 '::::',
 '',
 ':::: glossary',
 '',
 '::: definition Voltage',
 '',
 'Electrical potential.',
 '',
 ':::',
 '',
 '::: definition Current',
 '',
 'Electric flow.',
 '',
 ':::',
 '',
 '::::',
 '',
 ':::: flashcard',
 '',
 '::: front',
 '',
 'Original question.',
 '',
 ':::',
 '',
 '::: back',
 '',
 'Original answer.',
 '',
 ':::',
 '',
 '::::'
].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 const open=async(kind,width,index=0)=>{
  const target=page.locator('.tiptap .rk-directive-'+kind).nth(index);
  await target.waitFor();
  if(width===1280)await target.hover();
  else await target.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});
  const grip=page.getByRole('group',{name:'块把手'});await grip.waitFor();
  await grip.getByRole('button',{name:'块操作'}).click();
  await page.getByRole('menuitem',{name:'编辑块'}).last().click();
  const panel=page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
  await panel.waitFor();
  await panel.getByText('编辑子块').waitFor();
  return panel;
 };
 const menu=async(kind,width,index=0)=>{
  const target=page.locator('.tiptap .rk-directive-'+kind).nth(index);
  await target.waitFor();
  if(width===1280)await target.hover();
  else await target.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});
  const grip=page.getByRole('group',{name:'块把手'});await grip.waitFor();
  await grip.getByRole('button',{name:'块操作'}).click();
 };
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const created=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Nested interactions '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);assert.equal(created.status,201);
  await page.goto(base+'/records/'+created.data.id+'?mode=visual');
  let panel=await open('message',width,0);
  const raw=panel.getByRole('textbox',{name:'块源码',includeHidden:true});
  assert.match(await raw.inputValue(),/First message/);
  assert.doesNotMatch(await raw.inputValue(),/Second message/,'must inspect child not entire chat');
  const role=panel.getByRole('combobox',{name:'消息身份'});
  await role.click();await page.getByRole('option',{name:'Agent / 助手'}).last().click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-block-editor-panel textarea')].some(el=>el.value.includes('sender=assistant')));
  await panel.getByRole('tab',{name:'源码',exact:true}).click();
  await raw.fill('::: message Updated | sender=assistant\n\nRewritten child.\n\n:::');
  await page.locator('.rk-directive-message').first().getByText('Rewritten child.').waitFor();
  assert.match(await panel.getByRole('textbox',{name:'块源码',includeHidden:true}).inputValue(),/Updated/);
  await raw.fill('::: message Updated | sender=assistant\n\nRewritten child.\n\n:::\n\n::: message Illegal extra\n\nShould not insert sibling.\n\n:::');
  await panel.getByRole('alert').waitFor();
  assert.equal(await page.locator('.tiptap .rk-directive-chat .rk-directive-message').count(),2,'a child source edit cannot inject a second sibling');
  await raw.fill('::: message Updated | sender=assistant\n\nRewritten child.\n\n:::');
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  if(width===1280){
   const child=page.locator('.tiptap .rk-directive-message').first();
   await child.locator('.rk-directive-body p').first().click({button:'right'});
   await page.getByRole('menuitem',{name:'编辑块'}).last().click();
   const contextual=page.getByRole('complementary',{name:'块编辑面板'});
   await contextual.getByText('编辑子块').waitFor();
   assert.match(await contextual.getByRole('textbox',{name:'块源码',includeHidden:true}).inputValue(),/Rewritten child/);
   await contextual.getByRole('button',{name:'关闭',exact:true}).click();
   console.log('PASS desktop context menu resolves nested child rather than parent');
  }
  await menu('message',width,0);
  await page.getByRole('menuitem',{name:'下移块'}).last().click();
  const names=await page.locator('.tiptap .rk-directive-chat .rk-directive-message').allTextContents();
  assert.ok(names[0].includes('Second message.')&&names[1].includes('Rewritten child.'),'reorder two messages within chat: '+names);
  await menu('message',width,1);
  await page.getByRole('menuitem',{name:'复制块',exact:true}).last().click();
  assert.equal(await page.locator('.tiptap .rk-directive-chat .rk-directive-message').count(),3);
  await menu('message',width,2);
  await page.getByRole('menuitem',{name:'删除块'}).last().click();
  assert.equal(await page.locator('.tiptap .rk-directive-chat .rk-directive-message').count(),2);
  panel=await open('tab',width,0);
  assert.match(await panel.getByRole('textbox',{name:'块源码',includeHidden:true}).inputValue(),/First tab/);
  const title=panel.getByRole('textbox',{name:'块标题'});
  await title.fill('Primary');
  await page.locator('.tiptap .rk-directive-tab').first().getByText('Primary').waitFor();
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  panel=await open('definition',width,0);
  assert.equal(await panel.getByRole('textbox',{name:'术语名称'}).inputValue(),'Voltage');
  await panel.getByRole('textbox',{name:'术语名称'}).fill('Potential');
  await panel.getByRole('tab',{name:'源码',exact:true}).click();
  await panel.getByRole('textbox',{name:'块源码',includeHidden:true}).fill('::: definition Potential\n\nUpdated definition.\n\n:::');
  await page.locator('.tiptap .rk-directive-definition').first().getByText('Updated definition.').waitFor();
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  await menu('front',width,0);
  const forbidden=page.getByRole('menuitem',{name:'复制块',exact:true}).last();
  assert.equal(await forbidden.getAttribute('aria-disabled'),'true','front cannot be duplicated');
  await page.getByRole('menuitem',{name:'编辑块'}).last().click();
  panel=page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
  await panel.getByText('编辑子块').waitFor();
  assert.match(await panel.getByRole('textbox',{name:'块源码',includeHidden:true}).inputValue(),/Original question/);
  await panel.getByRole('tab',{name:'源码',exact:true}).click();
  await panel.getByRole('textbox',{name:'块源码',includeHidden:true}).fill('::: front\n\nRevised question.\n\n:::');
  await page.locator('.tiptap .rk-directive-front').first().getByText('Revised question.').waitFor();
  await panel.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'源码'}).click();
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const serialized=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(serialized,/Rewritten child/);
  assert.match(serialized,/::: tab Primary/);
  assert.match(serialized,/Updated definition/);
  assert.match(serialized,/Revised question/);
  assert.match(serialized,/Original answer/,'editing front did not damage back');
  const persisted=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,created.data.id);
  assert.equal(persisted,source,'draft editing must not auto-write D1');
  console.log('PASS nested block handle, live inspector, scoped move/duplicate/delete and flashcard guard',width);
 }
 assert.deepEqual(errors,[],'unexpected browser errors');
}finally{await browser.close();}
