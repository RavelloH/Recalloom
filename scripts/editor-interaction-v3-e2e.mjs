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
page.setDefaultTimeout(14000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source=['# 交互修复回归','','alpha beta gamma','','::: warning 提醒标题','','第一个容器正文。','',':::','','::: tip 第二个提示','','第二个容器正文。','',':::','','::: box','','手写批注示例文字。','',':::'].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Editor v3 '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },source);assert.equal(rec.status,201);
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 const first=page.locator('.tiptap .rk-directive-warning').first();
 await first.waitFor();
 const title=first.getByRole('textbox',{name:'容器标题'});
 const initial=await title.elementHandle();
 await title.click();
 assert.equal(await first.locator('input').count(),0,'Callout title must never use input');
 await title.press('End');
 await page.keyboard.type(' 修订');
 await title.press('Enter');
 assert.equal(await initial.evaluate(el=>el.isConnected),true,'Callout title must retain DOM text node');
 await title.filter({hasText:'修订'}).waitFor();
 const titleLook=await title.evaluate(el=>({tag:el.tagName,editable:el.getAttribute('contenteditable'),padding:getComputedStyle(el).padding,boxShadow:getComputedStyle(el).boxShadow}));
 assert.equal(titleLook.tag,'SPAN');assert.equal(titleLook.editable,'true');
 assert.equal(titleLook.padding,'0px');
 console.log('PASS plain callout title contenteditable',titleLook);

 // Right click on the body of an RMD block must follow cursor and exclude
 // text formatting commands even if a selection exists elsewhere.
 const body=first.locator('.rk-directive-body p').first();
 const at=await body.boundingBox();assert.ok(at);
 const point={x:at.x+Math.min(92,at.width/2),y:at.y+at.height/2};
 await page.mouse.click(point.x,point.y,{button:'right'});
 const menu=page.getByRole('menu',{name:'编辑器右键菜单'});await menu.waitFor();
 // Astryx mounts before its entry animation/position correction settles.
 // Wait for actual viewport coordinates instead of asserting a transient
 // pre-layout rect or sleeping for an arbitrary fixed interval.
 await page.waitForFunction(({x,y})=>{
  const el=document.querySelector('.rk-editor-context-popover[role="menu"]');
  if(!el)return false;
  const rect=el.getBoundingClientRect();
  return Math.abs(rect.left-x)<30&&Math.abs(rect.top-y)<40;
 },point,{timeout:2600});
 const menuRect=await menu.boundingBox();assert.ok(menuRect);
 assert.ok(Math.abs(menuRect.x-point.x)<30,'context menu should open at pointer, not at viewport left: '+JSON.stringify({point,menuRect}));
 assert.ok(Math.abs(menuRect.y-point.y)<40,'context menu vertical anchor should match pointer: '+JSON.stringify({point,menuRect}));
 assert.equal(await menu.getByRole('menuitem',{name:'加粗'}).count(),0,'bare block context must not show text tools');
 assert.ok(await menu.getByRole('group',{name:'块操作'}).count()>0);
 console.log('PASS pointer-anchored block context menu',point,menuRect.x,menuRect.y);
 await page.keyboard.press('Escape');

 const line=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 await line.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await page.getByRole('toolbar',{name:'文本格式'}).waitFor({state:'visible',timeout:2200});
 const toolbar=page.getByRole('toolbar',{name:'文本格式'});
 assert.equal(await toolbar.getByRole('button',{name:'语义 Mark'}).count(),1,'semantic Mark must be visible directly');
 for(const group of ['手绘标记','行内组件','更多行内功能']){
  const button=toolbar.getByRole('button',{name:group});
  assert.equal(await button.count(),1);
  assert.equal(await button.locator('.rk-inline-dropdown-chevron').count(),1,'icon and arrow must be visible in '+group);
 }
 await toolbar.getByRole('button',{name:'手绘标记'}).click();
 const submenu=page.getByRole('menu').last();await submenu.getByRole('menuitem',{name:/圈选/}).first().waitFor();
 await page.keyboard.press('Escape');
 console.log('PASS Mark direct, collapsible icon-plus-chevron categories');

 // Selecting text and right-clicking precisely over those glyphs shows text
 // actions, while right-clicking a different block shows only block actions.
 await line.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const selection=await page.evaluate(()=>{
  const range=getSelection()?.getRangeAt(0);const r=range?.getBoundingClientRect();
  return r?{x:r.x+r.width*.5,y:r.y+r.height*.5}:null;
 });assert.ok(selection);
 await page.mouse.click(selection.x,selection.y,{button:'right'});
 const textMenu=page.getByRole('menu',{name:'编辑器右键菜单'});await textMenu.waitFor();
 await page.waitForFunction(({x,y})=>{
  const el=document.querySelector('.rk-editor-context-popover[role="menu"]');
  if(!el)return false;
  const rect=el.getBoundingClientRect();
  return Math.abs(rect.left-x)<35&&Math.abs(rect.top-y)<35;
 },selection,{timeout:2600});
 const contextDebug=await page.evaluate(()=>({
  selection:getSelection()?.toString(),
  menu:document.querySelector('.rk-editor-context-popover')?.textContent?.slice(0,350),
  groups:[...document.querySelectorAll('.rk-editor-context-popover [role="group"]')].map(el=>el.getAttribute('aria-label'))
 }));
 const textRect=await textMenu.boundingBox();assert.ok(textRect);
 assert.ok(Math.abs(textRect.x-selection.x)<35&&Math.abs(textRect.y-selection.y)<35,
  'selection context must remain at pointer: '+JSON.stringify({selection,textRect}));
 assert.ok(await textMenu.getByRole('group',{name:'常用文字格式'}).count()>0,'context missing text tools: '+JSON.stringify(contextDebug));
 assert.ok(await textMenu.getByRole('menuitem',{name:'语义 Mark'}).count()>0);
 assert.ok(await textMenu.getByRole('menuitem',{name:'更多文字格式'}).count()>0);
 const more=textMenu.getByRole('menuitem',{name:'更多文字格式'});
 await more.hover();
 await page.getByRole('menuitem',{name:'上标'}).last().waitFor({state:'visible',timeout:3200});
 console.log('PASS context formatting only for text under pointer and hover flyout');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 // The document selection may remain active after closing the menu, but a
 // right click on another RMD block must never show text format commands.
 await line.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const other=await first.locator('.rk-directive-body p').first().boundingBox();assert.ok(other);
 await page.mouse.click(other.x+Math.min(85,other.width/2),other.y+other.height/2,{button:'right'});
 const blockMenu=page.getByRole('menu',{name:'编辑器右键菜单'});
 await blockMenu.waitFor();
 assert.equal(await blockMenu.getByRole('group',{name:'常用文字格式'}).count(),0,'right-clicking another block must not inherit selected text actions');
 assert.ok(await blockMenu.getByRole('group',{name:'块操作'}).count()>0);
 await page.keyboard.press('Escape');
 console.log('PASS selected text does not leak formatting actions into a different block');

 // A portaled grip has to survive the empty gutter between block and grip.
 await first.hover();
 const grip=page.getByRole('group',{name:'块把手'});await grip.waitFor();
 const br=await first.boundingBox(),gr=await grip.boundingBox();
 assert.ok(br&&gr);
 const y=Math.max(gr.y+5,Math.min(br.y+Math.min(20,br.height*.5),gr.y+gr.height-5));
 await page.mouse.move(br.x+br.width-6,y);
 await page.mouse.move(gr.x+gr.width*.25,y,{steps:12});
 await grip.waitFor({state:'visible',timeout:1000});
 assert.equal(await grip.count(),1,'grip must not vanish while moving from block to handle');
 console.log('PASS grip hover corridor and portal pointer transition');

 await grip.getByRole('button',{name:'块操作'}).click();
 await page.getByRole('menuitem',{name:'编辑块'}).last().click();
 const panel=page.getByRole('complementary',{name:'块编辑面板'});
 await panel.waitFor();
 await panel.locator('.rk-block-panel-preview-body .markdown-preview').waitFor();
 await panel.locator('.rk-block-panel-preview-body .rk-rmd-callout').waitFor();
 const scoped=await panel.evaluate(el=>{
  const body=el.querySelector('.rk-block-panel-preview-body');
  const callout=body?.querySelector('.rk-rmd-callout');
  const preview=body?.querySelector('.markdown-preview');
  return {scoped:body?.classList.contains('record-main'),font:getComputedStyle(preview).fontSize,
   accent:callout?getComputedStyle(callout).getPropertyValue('--rk-callout-accent').trim():null,
   width:preview?.getBoundingClientRect().width,container:body?.getBoundingClientRect().width};
 });
 assert.equal(scoped.scoped,true);
 assert.ok(scoped.accent?.length,'portaled markdown must inherit callout styles');
 assert.ok(scoped.width&&scoped.container&&scoped.width<=scoped.container+1);
 await panel.getByRole('button',{name:'关闭块编辑'}).click();
 console.log('PASS Drawer live preview restores typography and callout styles',scoped);

 await page.waitForFunction(()=>!!document.querySelector('.rk-sketch-svg[data-sketch-drawing="box"]'));
 const sketch=await page.evaluate(()=>{
  const svg=document.querySelector('.rk-sketch-svg[data-sketch-drawing="box"]');
  const p=document.querySelector('.tiptap .rk-sketch-block .rk-sketch-content p');
  if(!svg||!p)return null;
  const range=document.createRange();range.selectNodeContents(p);
  const ink=range.getBoundingClientRect(),outline=svg.getBoundingClientRect();
  return {above:ink.top-outline.top,below:outline.bottom-ink.bottom,
   centerOffset:(outline.top+outline.bottom-ink.top-ink.bottom)/2,
   inkHeight:ink.height,outlineHeight:outline.height};
 });assert.ok(sketch,'block handwritten box must have a measurable glyph/outline');
 assert.ok(Math.abs(sketch.centerOffset)<=2,'prose outline should be optically centered on its visible text: '+JSON.stringify(sketch));
 console.log('PASS handwriting box optical centering',sketch);

 // Move across the block: stylesheet must only be rewritten when the target
 // insertion index changes, not for each cursor pixel.
 await first.hover();const drag=grip.getByRole('button',{name:'拖动块'});
 const handle=await drag.boundingBox(),dest=await page.locator('.tiptap .rk-directive-tip').first().boundingBox();
 assert.ok(handle&&dest);
 await page.mouse.move(handle.x+handle.width*.5,handle.y+handle.height*.5);
 await page.mouse.down();
 await page.mouse.move(handle.x+handle.width*.5+10,handle.y+handle.height*.5+10,{steps:5});
 await page.mouse.move(dest.x+dest.width*.5,dest.y+dest.height*.8,{steps:18});
 await page.waitForTimeout(220);
 await page.evaluate(()=>{
  const s=document.querySelector('style[data-rk-drag-styles]');
  window.__styleMutationCount=0;
  window.__styleObserver=new MutationObserver(rs=>{window.__styleMutationCount+=rs.length;});
  if(s)window.__styleObserver.observe(s,{childList:true,characterData:true,subtree:true});
 });
 const moved=await page.locator('.rk-block-drop-slot').getAttribute('data-moved');
 assert.equal(moved,'true');
 await page.mouse.move(dest.x+dest.width*.5+18,dest.y+dest.height*.83,{steps:24});
 const samples=await page.evaluate(()=>{
  window.__styleObserver?.disconnect();
  return {mutations:window.__styleMutationCount,
   ghost:getComputedStyle(document.querySelector('.rk-block-drag-floating')).transform,
   moved:document.querySelector('.rk-block-drop-slot')?.dataset.moved};
 });
 assert.equal(samples.mutations,0,'unchanged insertion position must not rewrite expensive stylesheet');
 assert.notEqual(samples.ghost,'none');
 await page.mouse.up();
 await page.waitForFunction(()=>!document.querySelector('[data-rk-drag-styles]'));
 console.log('PASS compositor drag movement with no repeated stylesheet reflows',samples);

 assert.deepEqual(errors,[]);
}finally{await browser.close();}
