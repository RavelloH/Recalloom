import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8815';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&binary);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',err=>errors.push(err.message));
const source='# Inline extras\n\nalpha beta gamma\n\nanother paragraph';
async function create(content=source){
 const result=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Inline extras '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },content);
 assert.equal(result.status,201);
 await page.goto(base+'/records/'+result.data.id+'?mode=visual');
 await page.locator('.tiptap p').first().waitFor();
 return result.data.id;
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
   await page.getByRole('toolbar',{name:'文本格式'}).getByRole('button',{name:'更多'}).waitFor({state:'visible',timeout:1400});
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
  const toolbar=()=>page.getByRole('toolbar',{name:'文本格式'}).first();
  await create();
  await select(width);
  await toolbar().getByRole('button',{name:'更多'}).click();
  const menu=page.getByRole('menu').last();
  for(const label of ['注释','上标','下标','徽标 Badge','提示 Tooltip','缩写 Abbr','键帽 Kbd','挖空 Cloze'])
   assert.equal(await menu.getByRole('menuitem',{name:label}).count(),1,label);
  await menu.getByRole('menuitem',{name:'注释'}).click();
  assert.match(await sourceText(),/%%alpha beta gamma%%/);
  console.log('PASS inline comment source via shared menu',width);

  await create();await select(width);
  await toolbar().getByRole('button',{name:'插入或编辑链接'}).click();
  const dialog=page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox',{name:'链接文字'}).inputValue(),'alpha beta gamma');
  await dialog.getByRole('textbox',{name:'链接地址'}).fill('https://example.com/docs');
  await dialog.getByRole('button',{name:'插入',exact:true}).click();
  assert.match(await sourceText(),/\[alpha beta gamma\]\(https:\/\/example\.com\/docs\)/);
  console.log('PASS selection-preserving link dialog via shared menu',width);
  const reviewId=await create('# Review controls\n\n{++新增建议++}\n\n{--删除建议--}\n\n{>>审阅说明<<}');
  const accept=page.getByRole('button',{name:'接受建议新增',exact:true});
  const reject=page.getByRole('button',{name:'拒绝建议删除',exact:true});
  const resolve=page.getByRole('button',{name:'解决审阅批注',exact:true});
  await accept.waitFor();
  assert.equal(await page.locator('.rk-critic-actions button:not(.astryx-button)').count(),0,'review actions use library controls');
  await accept.hover();await resolve.focus();
  await page.waitForTimeout(350);
  assert.match(await page.locator('.save-status').innerText(),/已保存/,'control mount/focus cannot edit the document');
  await accept.click();await reject.click();await resolve.click();
  assert.equal(await page.locator('.tiptap .rk-critic').count(),0,'explicit decisions resolve all three suggestions');
  await page.locator('.save-status').getByText('未保存',{exact:true}).waitFor();
  const savedResponse=page.waitForResponse(response=>response.url().endsWith('/api/records/'+reviewId+'/content')&&response.request().method()==='PATCH');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await savedResponse).status(),200);
  await page.locator('.save-status').getByText('已保存').waitFor();
  const persisted=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,reviewId);
  assert.match(persisted,/新增建议/);assert.match(persisted,/删除建议/);assert.doesNotMatch(persisted,/审阅说明|\{\+\+|\{--|\{>>/);
  console.log('PASS library review controls preserve draft until explicit decisions',width);
  if(width===390){
   await create();
   const line=page.locator('.tiptap p').filter({hasText:'another paragraph'}).first();
   await line.click();await page.keyboard.press('End');
   await page.keyboard.type(' /脚注');
   await page.getByRole('listbox',{name:'插入内容'}).getByRole('option',{name:/脚注引用/}).first().click();
   assert.match(await sourceText(),/\[\^note\]/);
   console.log('PASS inline footnote at caret on mobile');
  }
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
