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
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source=['# Block interaction v2','','Plain paragraph without a block handle.','','::: warning First','','First callout.','',':::','','::: tip Second','','Second callout.','',':::','','::: info Third','','Third callout.','',':::'].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Block v2 '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },source);
 assert.equal(rec.status,201);
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 const paragraph=page.locator('.tiptap p').filter({hasText:'Plain paragraph without'}).first();
 await paragraph.hover();
 assert.equal(await page.getByRole('group',{name:'块把手'}).count(),0,'ordinary paragraphs must never expose grips');
 const first=page.locator('.tiptap .rk-directive-warning').first();
 await first.hover();
 const grip=page.getByRole('group',{name:'块把手'});
 await grip.waitFor();
 const geometry=await page.evaluate(()=>{
  const b=document.querySelector('.rk-directive-warning').getBoundingClientRect();
  const g=document.querySelector('.rk-block-grip').getBoundingClientRect();
  return {block:{x:b.x,y:b.y,right:b.right,bottom:b.bottom},grip:{x:g.x,y:g.y,right:g.right,bottom:g.bottom}};
 });
 assert.ok(geometry.grip.x>=geometry.block.right||geometry.grip.right<=geometry.block.x||geometry.grip.bottom<=geometry.block.y,
  'handle must be wholly outside block: '+JSON.stringify(geometry));
 await grip.getByRole('button',{name:'块操作'}).click();
 await page.getByRole('menuitem',{name:'编辑块'}).last().click();
 const panel=page.getByRole('complementary',{name:'块编辑面板'});
 await panel.waitFor();
 await page.waitForTimeout(270); // measure the fixed right edge after slide-in
 const drawer=await page.evaluate(()=>{
  const panel=document.querySelector('.rk-block-editor-panel');
  const workspace=document.querySelector('.rk-editor-block-workspace');
  return {position:getComputedStyle(panel).position,
   bodyParent:panel.parentElement===document.body,
   columns:getComputedStyle(workspace).gridTemplateColumns,
   panelRight:panel.getBoundingClientRect().right,
   canvasWidth:workspace.querySelector('.rk-editor-block-canvas').getBoundingClientRect().width,
   workspaceWidth:workspace.getBoundingClientRect().width};
 });
 assert.equal(drawer.position,'fixed');assert.equal(drawer.bodyParent,true);
 assert.equal(drawer.canvasWidth,drawer.workspaceWidth,'Drawer must not consume a document column');
 assert.ok(Math.abs(drawer.panelRight-1280)<2,'Drawer should be pinned to viewport right');
 await panel.getByRole('button',{name:'关闭块编辑'}).click();
 console.log('PASS true fixed Drawer and external ::: block grip',geometry,drawer);
 const editable=first.locator('.rk-directive-body p').first();
 for(let attempt=0;attempt<4;attempt++){
  await editable.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
  try{await page.getByRole('toolbar',{name:'文本格式'}).waitFor({state:'visible',timeout:1200});break;}
  catch{if(attempt===3)throw Error('Selected text lacks a floating formatting toolbar');}
 }
 const toolbarStats=await page.getByRole('toolbar',{name:'文本格式'}).evaluate(el=>{
  const buttons=[...el.querySelectorAll('button')];
  return {count:buttons.length,buttonText:buttons.map(b=>b.textContent?.trim()??''),
   geometry:buttons.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,
    icon:b.querySelector('svg')!==null}))};
 });
 assert.ok(toolbarStats.count>=8&&toolbarStats.count<=12,'compact toolbar should have few icon actions');
 assert.ok(toolbarStats.buttonText.every(t=>t===''),'floating toolbar must be icon-only: '+JSON.stringify(toolbarStats));
 assert.ok(toolbarStats.geometry.every(g=>g.width<=34&&g.height<=34&&g.icon),'icon geometry must be uniform: '+JSON.stringify(toolbarStats));
 console.log('PASS compact icon-only aligned text selection toolbar',toolbarStats);

 await first.click({button:'right'});
 const menu=page.getByRole('menu').last();await menu.waitFor();
 const menuSize=await menu.boundingBox();
 assert.ok(menuSize?.width>170&&menuSize.width<=275,'context menu must not become full viewport width: '+JSON.stringify(menuSize));
 assert.ok(await menu.locator('[role="menuitem"] svg').count()>=3,'actions need leading icons');
 assert.ok(await menu.getByRole('group',{name:'块操作'}).count()>=1,'organized context menu group');
 assert.equal(await first.evaluate(el=>el.classList.contains('rk-block-selected')),true,'right-clicked block should be outlined');
 await page.keyboard.press('Escape');
 console.log('PASS compact context menu with icons, groups and selection outline',menuSize?.width);

 await first.hover();
 const g=await grip.getByRole('button',{name:'拖动块'}).boundingBox();
 const target=page.locator('.tiptap .rk-directive-info').first();
 const t=await target.boundingBox();
 assert.ok(g&&t);
 await page.mouse.move(g.x+g.width/2,g.y+g.height/2);
 await page.mouse.down();
 await page.mouse.move(g.x+g.width/2+10,g.y+g.height/2+10,{steps:5});
 await page.mouse.move(t.x+t.width/2,t.y+t.height*.8,{steps:16});
 await page.waitForTimeout(280);
 const physics=await page.evaluate(()=>({
  ghost:!!document.querySelector('.rk-block-drag-floating'),
  slot:document.querySelector('.rk-block-drop-slot')?.getBoundingClientRect().toJSON(),
  moved:document.querySelector('.rk-block-drop-slot')?.getAttribute('data-moved'),
  shifted:[...document.querySelectorAll('.tiptap > *')].filter(n=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(n).transform).m42)>10).length,
  original:Number(parseFloat(getComputedStyle(document.querySelector('.rk-directive-warning')?.closest('.react-renderer')).opacity)<.2),
  externalStyles:!!document.querySelector('style[data-rk-drag-styles]')
 }));
 assert.ok(physics.ghost,'live held block must follow cursor');
 assert.equal(physics.moved,'true','dragging should preview the destination slot');
 assert.ok(physics.shifted>=1,'neighboring blocks should shift before drop');
 assert.equal(physics.original,1,'source must retain document-space placeholder');
 await page.mouse.up();
 await page.waitForFunction(()=>!document.querySelector('.rk-block-drop-slot'));
 assert.equal(await page.locator('style[data-rk-drag-styles]').count(),0,'drag styles must be cleaned after drop');
 const order=await page.locator('.tiptap .rk-directive[data-rk-kind]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-rk-kind')));
 assert.deepEqual(order.slice(-3),['tip','info','warning'],'drop should commit the visual preview order');
 console.log('PASS physical drag preview, floating ghost, reserved gap, animated siblings',physics);

 await page.setViewportSize({width:390,height:844});
 const mobile=page.locator('.tiptap .rk-directive-warning').first();
 await mobile.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});
 const touchGrip=page.getByRole('group',{name:'块把手'});
 await touchGrip.waitFor();
 const touchBounds=await touchGrip.boundingBox();
 assert.ok(touchBounds&&touchBounds.x>=0&&touchBounds.y>=0&&touchBounds.x+touchBounds.width<=391&&touchBounds.y+touchBounds.height<=845);
 await touchGrip.getByRole('button',{name:'块操作'}).click();
 await page.getByRole('menuitem',{name:'编辑块'}).last().click();
 const mobilePanel=page.getByRole('dialog',{name:'块编辑面板'});await mobilePanel.waitFor();
 const mobileGeom=await mobilePanel.boundingBox();
 assert.ok(mobileGeom&&Math.abs(mobileGeom.width-390)<1&&Math.abs(mobileGeom.height-844)<2);
 assert.deepEqual(errors,[]);
 console.log('PASS reachable touch grip and bottom-fullscreen Drawer');
}finally{await browser.close();}
