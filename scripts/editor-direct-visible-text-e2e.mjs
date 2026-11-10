import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Application/chrome.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
assert.ok(binary&&secret);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const source=[
 '# 文字直接编辑回归',
 '',
 '::: link-card https://example.com/docs | title=Old Card :::',
 '',
 '![图](/examples/device.svg) @ attrs fig-direct | caption=Old Figure @',
 '',
 '| Item | Value |',
 '| --- | --- |',
 '| A | 1 |',
 '@ attrs tbl-direct | caption=Old Table @'
].join('\n');

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const created=await page.evaluate(async content=>{
   const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Direct editable labels '+Date.now()+'.md',kind:'document',content})});
   return {status:response.status,data:await response.json()};
  },source);
  assert.equal(created.status,201);
  await page.goto(base+'/records/'+created.data.id+'?mode=visual');

  const card=page.locator('.tiptap .rk-rich-link-card').first();
  await card.getByRole('button',{name:'直接编辑链接卡片标题'}).click();
  const cardInput=card.getByRole('textbox',{name:'直接编辑链接卡片标题'});
  await cardInput.fill('New Card');
  await cardInput.press('Enter');
  await card.getByRole('button',{name:'直接编辑链接卡片标题'}).getByText('New Card').waitFor();

  const figure=page.locator('.tiptap .rk-rich-figure').first();
  await figure.getByRole('button',{name:'直接编辑图片图注'}).click();
  const figureInput=figure.getByRole('textbox',{name:'直接编辑图片图注'});
  await figureInput.fill('New Figure');
  await figureInput.press('Enter');
  await figure.getByRole('button',{name:'直接编辑图片图注'}).getByText('New Figure').waitFor();

  await figure.getByRole('button',{name:'直接编辑图片图注'}).click();
  await figure.getByRole('textbox',{name:'直接编辑图片图注'}).fill('Cancel Figure');
  await figure.getByRole('textbox',{name:'直接编辑图片图注'}).press('Escape');
  await figure.getByRole('button',{name:'直接编辑图片图注'}).getByText('New Figure').waitFor();

  const table=page.locator('.tiptap .tableWrapper[data-rk-table-id="tbl-direct"]').first();
  const tableCaption=table.getByRole('button',{name:'直接编辑表格图注'});
  await tableCaption.waitFor();
  await tableCaption.click();
  const tableInput=table.getByRole('textbox',{name:'直接编辑表格图注'});
  await tableInput.fill('New Table');
  await tableInput.press('Enter');
  await table.getByRole('button',{name:'直接编辑表格图注'}).getByText('New Table').waitFor();

  await tableCaption.click();
  await table.getByRole('textbox',{name:'直接编辑表格图注'}).fill('Cancel Table');
  await table.getByRole('textbox',{name:'直接编辑表格图注'}).press('Escape');
  await table.getByRole('button',{name:'直接编辑表格图注'}).getByText('New Table').waitFor();

  const persisted=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,created.data.id);
  assert.equal(persisted,source,'direct inline editing must not auto-save');
  await page.getByRole('button',{name:'源码'}).click();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const markdown=await page.evaluate(()=>navigator.clipboard.readText());
  for(const label of ['title=New Card','caption=New Figure','caption=New Table']){
   assert.ok(markdown.includes(label),'missing canonical RMD '+label+'\n'+markdown.slice(0,1400));
  }
  console.log('PASS direct LinkCard/Figure/Table text editing, Escape and source',width);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
