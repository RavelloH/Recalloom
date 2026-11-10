import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8815';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(binary);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
assert.ok(secret);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
fs.mkdirSync('tmp/editor-interaction-screens',{recursive:true});
const selectFixtureLine=async locator=>{
 await locator.waitFor({state:'visible'});
 await page.locator('.tiptap[contenteditable="true"]').waitFor();
 for(let attempt=0;attempt<4;attempt++){
  await locator.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  const selected=await page.evaluate(()=>window.getSelection()?.toString().trim()??'');
  if(selected==='alpha beta gamma'){
   // Source text selection can race the debounced desktop BubbleMenu when
   // switching RMD documents. Require the real action to be visible, not
   // merely a non-empty browser selection.
   const name=page.viewportSize()?.width>720?'文本格式':'格式工具栏';
   try{
    await page.getByRole('toolbar',{name}).first()
     .getByRole('button',{name:'行内组件'}).waitFor({state:'visible',timeout:1700});
    return;
   }catch{/* A missed toolbar update should trigger one fresh selection. */}
  }
  await page.waitForTimeout(125);
 }
 const evidence=await page.evaluate(()=>({selection:window.getSelection()?.toString(),active:document.activeElement?.outerHTML.slice(0,220),editorText:document.querySelector('.tiptap')?.textContent?.slice(0,150)}));
 throw new Error('Failed to select fixture line: '+JSON.stringify(evidence));
};
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const size of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]){
  await page.setViewportSize({width:size.width,height:size.height});
  const source='# Inline command regression\n\nalpha beta gamma\n\nanother paragraph';
  const result=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'RMD Inline UI '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);
  assert.equal(result.status,201,JSON.stringify(result).slice(0,250));
  await page.goto(base+'/records/'+result.data.id+'?mode=visual');
  await page.locator('.tiptap p').first().waitFor();
  const paragraph=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
  await selectFixtureLine(paragraph);
  const toolbar=page.getByRole('toolbar',{name:size.name==='desktop'?'文本格式':'格式工具栏'}).first();
  await toolbar.getByRole('button',{name:'手绘标记'}).waitFor().catch(async error=>{
   const diagnostic=await page.evaluate(()=>({selected:window.getSelection()?.toString(),active:document.activeElement?.outerHTML.slice(0,180),toolbars:[...document.querySelectorAll('[role="toolbar"]')].map(x=>({name:x.getAttribute('aria-label'),text:x.textContent?.slice(0,100),display:getComputedStyle(x).display})),text:document.querySelector('.tiptap')?.textContent?.slice(0,160),viewport:innerWidth}));
   console.error('SELECTION_TOOLBAR_MISSING',JSON.stringify(diagnostic));
   await page.screenshot({path:'tmp/editor-interaction-screens/selection-failed.png',fullPage:true});
   throw error;
  });
  await toolbar.getByRole('button',{name:'手绘标记'}).click();
  const menu=page.getByRole('menu').last();
  assert.equal(await menu.getByRole('menuitem').count(),9,'all nine hand-drawn variants visible');
  await menu.getByRole('menuitem',{name:/手绘圈选/}).click();
  const mark=page.locator('.tiptap .rk-sketch-inline[data-rk-sketch-kind="circle"]').first();
  await mark.waitFor();
  assert.equal(await mark.innerText(),'alpha beta gamma','selected text must be preserved');
  await page.screenshot({path:'tmp/editor-interaction-screens/inline-'+size.name+'.png',fullPage:true});
  await page.getByRole('button',{name:'源码'}).click();
  await page.waitForTimeout(200);
  const code=await page.locator('.cm-content').first().innerText();
  assert.match(code,/:: circle alpha beta gamma ::/,'source must serialize handdrawn circle '+size.name);
  console.log('PASS handdrawn command',size.name,'source:',code.split('\n').filter(x=>x.includes('circle')).join('').slice(0,140));
  // The second category contains all five remaining editable inline RMD nodes.
  const created=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'RMD inline node UI '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);
  assert.equal(created.status,201);
  await page.goto(base+'/records/'+created.data.id+'?mode=visual');
  const second=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
  await selectFixtureLine(second);
  const nodeToolbar=page.getByRole('toolbar',{name:size.name==='desktop'?'文本格式':'格式工具栏'}).first();
  await nodeToolbar.getByRole('button',{name:'行内组件'}).click();
  const nodeMenu=page.getByRole('menu').last();
  assert.equal(await nodeMenu.getByRole('menuitem').count(),5,'all five inline RMD nodes available');
  await nodeMenu.getByRole('menuitem',{name:/徽标 Badge/}).click();
  const badge=page.locator('.tiptap .rk-inline-badge').first();await badge.waitFor();
  assert.match(await badge.innerText(),/alpha beta gamma/);
  await page.getByRole('button',{name:'源码'}).click();
  const codeBadge=await page.locator('.cm-content').first().innerText();
  assert.match(codeBadge,/:: badge alpha beta gamma/,'inline node must serialize back to RMD');
  console.log('PASS inline RMD node command',size.name);
  // Semantic Mark remains a separate edit action (never writes Highlight).
  const semantic=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'RMD semantic Mark UI '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);
  assert.equal(semantic.status,201);
  await page.goto(base+'/records/'+semantic.data.id+'?mode=visual');
  const third=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
  await selectFixtureLine(third);
  const markToolbar=page.getByRole('toolbar',{name:size.name==='desktop'?'文本格式':'格式工具栏'}).first();
  await markToolbar.getByRole('button',{name:'语义 Mark'}).click();
  await page.locator('.tiptap mark:not([data-rk-color])').first().waitFor();
  await page.getByRole('button',{name:'源码'}).click();
  const codeMark=await page.locator('.cm-content').first().innerText();
  assert.match(codeMark,/:: mark alpha beta gamma ::/);
  assert.doesNotMatch(codeMark,/:: highlight/);
  console.log('PASS semantic Mark command',size.name);
  // Capture the browser selection at pointer-down so the menu may take focus
  // without racing ProseMirror's asynchronous selection observer.
  const quick=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Quick inline selection '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);
  assert.equal(quick.status,201);
  await page.goto(base+'/records/'+quick.data.id+'?mode=visual');
  const quickLine=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
  await quickLine.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
  const quickToolbar=page.getByRole('toolbar',{name:size.name==='desktop'?'文本格式':'格式工具栏'}).first();
  await quickToolbar.getByRole('button',{name:'手绘标记'}).click();
  await page.getByRole('menu').last().getByRole('menuitem',{name:/手绘圈选/}).click();
  const quickMark=page.locator('.tiptap .rk-sketch-inline[data-rk-sketch-kind="circle"]').last();
  await quickMark.waitFor();
  assert.equal(await quickMark.innerText(),'alpha beta gamma','selection survives immediate dropdown focus transfer '+size.name);
  console.log('PASS immediate selection snapshot and hand-drawn menu command',size.name);
  if(size.name==='mobile'){
   const fresh=await page.evaluate(async content=>{
    const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Mobile inline code '+Date.now()+'.md',kind:'document',content})});
    return {status:r.status,data:await r.json()};
   },source);
   assert.equal(fresh.status,201);
   await page.goto(base+'/records/'+fresh.data.id+'?mode=visual');
   const line=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
   await selectFixtureLine(line);
   await page.getByRole('toolbar',{name:'格式工具栏'}).getByRole('button',{name:'行内代码'}).click();
   await page.locator('.tiptap p code').filter({hasText:'alpha beta gamma'}).first().waitFor();
   await page.getByRole('button',{name:'源码'}).click();
   const code=await page.locator('.cm-content').first().innerText();
   assert.ok(code.includes('`alpha beta gamma`'),'mobile inline code must preserve selected text and serialize to Markdown');
   console.log('PASS mobile inline-code button, selection and Markdown source');
  }
 }
 assert.deepEqual(errors,[],'no browser errors');
}finally{await browser.close();}
