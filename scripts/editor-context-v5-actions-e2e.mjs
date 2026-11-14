import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8815';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&executablePath);
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(15000);
const fixture=[
 '# 右键行为测试','','[目标链接](https://example.com/start)','',
 '| 第一列 | 第二列 |','| --- | --- |','| 单元 A | 单元 B |','',
 '~~~js','console.log("editor_v5");','~~~','',
 '![示例图片](/examples/device.svg)','','末尾空白段落。'
].join('\n');
const create=async()=>{
 const r=await page.evaluate(async content=>{
  const response=await fetch('/api/records',{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Context V5 '+Date.now()+'.md',kind:'document',content})});
  return {status:response.status,data:await response.json()};
 },fixture);
 assert.equal(r.status,201);
 await page.goto(base+'/records/'+r.data.id+'?mode=visual');
 await page.locator('.tiptap').waitFor();
 // The mounted Tiptap DOM precedes the headless browser's portaled context
 // menu positioning/transition readiness after a full document navigation.
 await page.waitForTimeout(700);
};
const menu=()=>page.getByRole('menu',{name:'编辑器右键菜单'});
const source=async()=>{
 await page.getByRole('button',{name:'源码'}).click();
 const cm=page.locator('.cm-content').first();await cm.waitFor();
 return cm.innerText();
};
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});

 await create();
 await page.locator('.tiptap a[href*="example.com/start"]').first().click({button:'right'});
 await menu().getByRole('menuitem',{name:'移除链接'}).click();
 assert.equal(await page.locator('.tiptap a[href*="example.com/start"]').count(),0);
 assert.ok(await page.locator('.tiptap').getByText('目标链接',{exact:false}).count()>0);
 console.log('PASS unlink preserves text');

 await create();
 await page.locator('.tiptap a[href*="example.com/start"]').first().click({button:'right'});
 await menu().getByRole('menuitem',{name:'编辑链接'}).click();
 const dialog=page.getByRole('complementary',{name:'块编辑面板'});await dialog.waitFor();
 assert.equal(await dialog.getByRole('textbox',{name:'链接地址'}).inputValue(),'https://example.com/start');
 await dialog.getByRole('textbox',{name:'链接地址'}).fill('https://example.org/updated');
 await dialog.getByRole('button',{name:'更新',exact:true}).click();
 await page.locator('.tiptap a[href="https://example.org/updated"]').first().waitFor();
 console.log('PASS edit link prepopulates and updates href');

 await create();
 const table=page.locator('.tiptap table').first();
 const rowCount=await table.locator('tr').count();
 await table.locator('td').first().click({button:'right'});
 await menu().getByRole('menuitem',{name:'在下方插入行'}).click();
 assert.equal(await table.locator('tr').count(),rowCount+1);
 const colCount=await table.locator('tr').first().locator('th,td').count();
 await table.locator('td').first().click({button:'right'});
 await menu().getByRole('menuitem',{name:'在右侧插入列'}).click();
 assert.equal(await table.locator('tr').first().locator('th,td').count(),colCount+1);
 const insertedRows=await table.locator('tr').count();
 await table.locator('td').first().click({button:'right'});
 await menu().getByRole('menuitem',{name:'删除行'}).click();
 assert.equal(await table.locator('tr').count(),insertedRows-1,'delete row should mutate the document');
 const insertedCols=await table.locator('tr').first().locator('th,td').count();
 await table.locator('td').first().click({button:'right'});
 await menu().getByRole('menuitem',{name:'删除列'}).click();
 assert.equal(await table.locator('tr').first().locator('th,td').count(),insertedCols-1,'delete column should mutate the document');
 console.log('PASS context table inserts and deletes actual rows and columns');

 await create();
 await page.locator('.tiptap pre code').first().click({button:'right'});
 await menu().getByRole('menuitem',{name:'切换语言'}).hover();
 await page.getByRole('menuitem',{name:'python',exact:true}).last().click();
 const markdown=await source();
 assert.ok(markdown.includes('~~~python')||markdown.includes(String.fromCharCode(96).repeat(3)+'python'),
  'code language not updated: '+markdown.slice(0,160));
 console.log('PASS code language mutation');

 await create();
 const img=page.locator('.tiptap img[src*="/examples/device.svg"]').first();
 await img.waitFor({state:'visible'});
 await img.click({button:'right'});
 await menu().waitFor();
 assert.equal(await menu().getByRole('menuitem',{name:'加粗'}).count(),0,'image context must not leak text formatting actions');
 assert.ok(await menu().getByRole('menuitem',{name:'下载图片'}).count()>0);
 assert.ok(await menu().getByRole('menuitem',{name:'复制图片'}).count()>0);
 console.log('PASS image copy/download actions available');
 await page.keyboard.press('Escape');

 const paragraph=page.locator('.tiptap p').filter({hasText:'末尾空白段落'}).first();
 await paragraph.click();
 try{
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.evaluate(()=>navigator.clipboard.writeText('QA_V5_PASTE_OK'));
 }catch{/* Clipboard permission is intentionally browser dependent. */}
 await paragraph.click({button:'right'});
 await menu().getByRole('menuitem',{name:'粘贴'}).click();
 await page.waitForTimeout(450);
 const result=await page.evaluate(()=>({
  text:document.querySelector('.tiptap')?.textContent??'',
  feedback:document.querySelector('.rk-editor-context-feedback')?.textContent??''
 }));
 assert.ok(result.text.includes('QA_V5_PASTE_OK')||/Ctrl\+V|权限|剪贴板/.test(result.feedback),
  'paste must write or explain fallback: '+JSON.stringify(result));
 console.log('PASS paste insertion or explicit fallback',{inserted:result.text.includes('QA_V5_PASTE_OK'),feedback:result.feedback});

 await page.keyboard.down('Shift');
 await paragraph.click({button:'right'});await page.keyboard.up('Shift');
 assert.equal(await menu().isVisible(),false,'Shift+right-click must bypass custom context');
 console.log('PASS native Shift+right-click escape hatch');
}finally{await browser.close();}
