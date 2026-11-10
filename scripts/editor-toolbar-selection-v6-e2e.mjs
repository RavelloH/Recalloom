import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const executablePath=[
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(fs.existsSync);
assert.ok(secret&&executablePath);
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const expected=['标题','粗体','斜体','列表','引用','插入或编辑链接',
 '下划线','高亮','删除线','对齐方式','行内代码','插入行内公式','荧光笔与手绘标记','更多'];
const sample=[
 '# 光标与工具栏验收','','普通文字拖动测试，用于观察文本选区和插入光标。','',
 '下方段落用于放置拖动内容。','','::: warning 块移动提示','','这是可拖动的 Callout。','',':::',
 '','最后一段文字。'
].join('\n');
const log=[];
async function login(page){
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
}
async function create(page){
 const response=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Toolbar DnD V6 '+Date.now()+'.md',kind:'document',content})
  });
  return {status:r.status,data:await r.json()};
 },sample);
 assert.equal(response.status,201);
 return response.data.id;
}
async function toolbarNames(toolbar){
 return toolbar.locator('button').evaluateAll(buttons=>
  buttons.map(button=>button.getAttribute('aria-label')||button.getAttribute('title')||''));
}
const desktop=await browser.newContext({viewport:{width:1280,height:900}});
const page=await desktop.newPage();
page.setDefaultTimeout(13000);
try{
 await login(page);
 const id=await create(page);
 await page.goto(base+'/records/'+id+'?mode=visual');
 const first=page.locator('.tiptap p').filter({hasText:'普通文字拖动测试'}).first();
 await first.waitFor();
 await first.click();
 await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const toolbar=page.getByRole('toolbar',{name:'文本格式'});
 await toolbar.waitFor();
 assert.deepEqual(await toolbarNames(toolbar),expected,'desktop formatting actions must share mobile DOM order');
 log.push('PASS desktop toolbar uses one ordered action row');

 // Test actual ::selection computed style, not just an unused theme variable.
 const selected=await first.evaluate(el=>({
  color:getComputedStyle(el,'::selection').backgroundColor,
  normal:getComputedStyle(el).backgroundColor,
  native:getSelection()?.toString()??''
 }));
 assert.ok(selected.native.length>4);
 assert.ok(selected.color&&selected.color!=='transparent'&&selected.color!=='rgba(0, 0, 0, 0)',
  'text selection should be styled: '+JSON.stringify(selected));
 const styles=await page.evaluate(()=>{
  const html=document.documentElement;
  const theme=html.getAttribute('data-effective-theme');
  html.setAttribute('data-effective-theme','light');
  const light=getComputedStyle(document.querySelector('.tiptap p'),'::selection').backgroundColor;
  html.setAttribute('data-effective-theme','dark');
  const dark=getComputedStyle(document.querySelector('.tiptap p'),'::selection').backgroundColor;
  if(theme===null)html.removeAttribute('data-effective-theme');
  else html.setAttribute('data-effective-theme',theme);
  return {light,dark};
 });
 assert.notEqual(styles.light,styles.dark,'selection color should adapt to dark and light themes');
 log.push('PASS selected glyphs use distinct readable light/dark accent');

 // Use the editor's REAL ProseMirror dragover hook (not a fake cursor div).
 await first.scrollIntoViewIfNeeded();
 const caret=await page.evaluate(()=>{
  const p=[...document.querySelectorAll('.tiptap p')].find(el=>el.textContent?.startsWith('普通文字拖动测试'));
  if(!p)throw Error('missing text');
  const text=p.firstChild;
  if(!text||text.nodeType!==Node.TEXT_NODE)throw Error('not a text node');
  const range=document.createRange();
  range.setStart(text,Math.min(6,text.textContent.length));
  range.setEnd(text,Math.min(8,text.textContent.length));
  const r=range.getBoundingClientRect();
  const event=new DragEvent('dragover',{
   bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,
   dataTransfer:new DataTransfer()
  });
  p.dispatchEvent(event);
  const drop=document.querySelector('.rk-editor-dropcursor');
  return {exists:!!drop,className:drop?.className,background:drop?getComputedStyle(drop).backgroundColor:null,
   before:drop?getComputedStyle(drop,'::before').content:null,
   size:drop?{width:getComputedStyle(drop).width,height:getComputedStyle(drop).height}:null};
 });
 assert.equal(caret.exists,true,'native text dragover must render configured ProseMirror cursor: '+JSON.stringify(caret));
 assert.ok(caret.className?.includes('prosemirror-dropcursor-'));
 assert.notEqual(caret.background,'rgba(0, 0, 0, 0)');
 assert.notEqual(caret.background,'rgb(255, 255, 255)');
 assert.notEqual(caret.before,'none','text drop caret uses themed endpoint adornment');
 log.push('PASS native ProseMirror text drag creates themed cursor '+JSON.stringify(caret));

 // A real block-pointer drag should hide that same native cursor and keep
 // only the custom slot+floating preview. Test while the mouse is down.
 const callout=page.locator('.tiptap .rk-directive-warning').first();
 const destination=page.locator('.tiptap p').filter({hasText:'最后一段文字'}).first();
 await callout.hover();
 const grip=page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'拖动块'});
 await grip.waitFor();
 const handle=await grip.boundingBox(),target=await destination.boundingBox();
 assert.ok(handle&&target);
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
 await page.mouse.down();
 await page.mouse.move(handle.x+handle.width/2+14,handle.y+handle.height/2+12,{steps:5});
 await page.mouse.move(target.x+25,target.y+Math.min(target.height-3,12),{steps:12});
 const preview=await page.evaluate(()=>{
  const drop=document.querySelector('.rk-editor-dropcursor');
  return {dragging:document.body.classList.contains('rk-block-drag-active'),
   customSlot:!!document.querySelector('.rk-block-drop-slot'),
   floating:!!document.querySelector('.rk-block-drag-floating'),
   nativeDisplay:drop?getComputedStyle(drop).display:'absent'};
 });
 assert.ok(preview.dragging&&preview.customSlot&&preview.floating,'must preserve custom RMD preview '+JSON.stringify(preview));
 assert.ok(preview.nativeDisplay==='none'||preview.nativeDisplay==='absent',
  'native white insertion marker must never overlay custom block preview: '+JSON.stringify(preview));
 await page.mouse.up();
 assert.equal(await page.locator('.rk-block-drop-slot').count(),0,'drop cleans its preview');
 log.push('PASS block drag hides native insertion cursor and keeps custom ghost/slot');

 for(const [kind,width,height] of [['pad',1024,768],['phone',390,844]]){
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true});
  const touch=await ctx.newPage();touch.setDefaultTimeout(13000);
  try{
   await login(touch);
   await touch.goto(base+'/records/'+id+'?mode=visual');
   const top=touch.getByRole('toolbar',{name:'格式工具栏'});
   await top.waitFor();
   const primary=top.locator('.wysiwyg-tools-primary');
   assert.deepEqual(await toolbarNames(primary),expected,kind+' must reuse exact desktop format order');
   assert.deepEqual(await toolbarNames(top.locator('.wysiwyg-tools-leading')),['插入内容']);
   const viewport=await top.evaluate(el=>{
    el.scrollLeft=el.scrollWidth;
    const bar=el.getBoundingClientRect(),lead=el.querySelector('.wysiwyg-tools-leading').getBoundingClientRect();
    return {scrollLeft:el.scrollLeft,barLeft:bar.left,leadLeft:lead.left,
     sticky:getComputedStyle(el.querySelector('.wysiwyg-tools-leading')).position};
   });
   assert.equal(viewport.sticky,'sticky');
   assert.ok(Math.abs(viewport.leadLeft-viewport.barLeft)<15,
    kind+' insertion button must remain in view while scrolling: '+JSON.stringify(viewport));
   await touch.locator('.tiptap .rk-directive-warning').first().tap();
   assert.deepEqual(await toolbarNames(top.locator('.wysiwyg-tools-leading')),
    ['插入内容','编辑当前块','更多块操作']);
   assert.deepEqual(await toolbarNames(primary),expected);
   log.push('PASS '+kind+' same order; pinned insertion; nearby contextual block actions');
  }finally{await ctx.close();}
 }
 console.log(log.join('\n'));
}finally{await browser.close();}
