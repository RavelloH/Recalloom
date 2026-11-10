import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&binary);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',err=>errors.push(err.message));
const source='# Inline extras\n\nalpha beta gamma\n\nanother paragraph';
async function create(){
 const result=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Inline extras '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },source);
 assert.equal(result.status,201);
 await page.goto(base+'/records/'+result.data.id+'?mode=visual');
 await page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first().waitFor();
}
async function select(width){
 const line=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 for(let attempt=0;attempt<4;attempt++){
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  const selected=await page.evaluate(()=>window.getSelection()?.toString().trim()??'');
  if(selected!=='alpha beta gamma'){await page.waitForTimeout(120);continue;}
  if(width===390){await page.waitForTimeout(250);return;}
  try{
   await page.getByRole('toolbar',{name:'文本格式'}).getByRole('button',{name:'更多行内功能'}).waitFor({state:'visible',timeout:1400});
   return;
  }catch{/* BubbleMenu is debounced and may have missed a focus transition; reselect. */}
 }
 throw Error('Selected RMD text cannot open its inline toolbar: '+JSON.stringify(
  await page.evaluate(()=>({
   selection:window.getSelection()?.toString(),
   focus:document.activeElement?.outerHTML.slice(0,200),
   bubble:document.querySelectorAll('.bubble-menu').length
  }))));
}
async function sourceText(){
 await page.getByRole('button',{name:'源码'}).click();
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.locator('.cm-content').first().click();
 await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
 return page.evaluate(()=>navigator.clipboard.readText());
}
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const toolbar=()=>page.getByRole('toolbar',{name:width===1280?'文本格式':'格式工具栏'}).first();
  await create();
  await select(width);
  await toolbar().getByRole('button',{name:'更多行内功能'}).click();
  const menu=page.getByRole('menu').last();
  for(const label of ['链接','行内公式','Wiki 引用','脚注引用','弱化注释'])
   assert.equal(await menu.getByRole('menuitem',{name:label}).count(),1,label);
  await menu.getByRole('menuitem',{name:'弱化注释'}).click();
  assert.match(await sourceText(),/%%alpha beta gamma%%/);
  console.log('PASS inline comment source via shared menu',width);

  await create();await select(width);
  await toolbar().getByRole('button',{name:'更多行内功能'}).click();
  await page.getByRole('menu').last().getByRole('menuitem',{name:'链接'}).click();
  const dialog=page.getByRole('dialog',{name:/链接/});
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox',{name:'链接文字'}).inputValue(),'alpha beta gamma');
  await dialog.getByRole('textbox',{name:'链接地址'}).fill('https://example.com/docs');
  await dialog.getByRole('button',{name:'插入',exact:true}).click();
  assert.match(await sourceText(),/\[alpha beta gamma\]\(https:\/\/example\.com\/docs\)/);
  console.log('PASS selection-preserving link dialog via shared menu',width);
  if(width===390){
   await create();
   const line=page.locator('.tiptap p').filter({hasText:'another paragraph'}).first();
   await line.click();await page.keyboard.press('End');
   await toolbar().getByRole('button',{name:'更多行内功能'}).click();
   await page.getByRole('menu').last().getByRole('menuitem',{name:'脚注引用'}).click();
   assert.match(await sourceText(),/\[\^note\]/);
   console.log('PASS inline footnote at caret on mobile');
  }
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
