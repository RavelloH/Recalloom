import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(binary&&secret);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(18000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const sourceText=[
 '# 回归：原位编辑与行内工具','','::: warning','','这是没有显式标题的警告。','',':::','',
 '::: box','','手写方框只应围绕正文，不需要额外块选框。','',':::','',
 'alpha beta gamma','','another paragraph'].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const result=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Editor v4 '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },sourceText);
 assert.equal(result.status,201);
 await page.goto(base+'/records/'+result.data.id+'?mode=visual');

 const callout=page.locator('.tiptap .rk-directive-warning').first();await callout.waitFor();
 const title=callout.getByRole('textbox',{name:'容器标题'});
 const initial=await title.innerText();
 assert.ok(initial.trim().length>0,'default title should be visible');
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true);
 const node=await title.elementHandle();
 await title.click();
 assert.equal(await title.innerText(),initial,'click must NOT erase the rendered title');
 assert.equal(await node.evaluate(el=>el.isConnected),true,'focus must preserve the original title node');
 assert.equal(await callout.locator('input').count(),0,'callout editing must never use a separate input');
 await title.press('Escape');
 assert.equal(await title.innerText(),initial,'escape restores original text');
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true,'focus+escape must not dirty');
 await title.click();
 await title.press('End');
 await page.keyboard.type('修订');
 await title.press('Enter');
 await title.filter({hasText:initial+'修订'}).waitFor();
 assert.equal(await node.evaluate(el=>el.isConnected),true,'typing must preserve the rendered title element');
 console.log('PASS Callout default title retains text and original DOM when clicked and edited',initial);

 const sketch=page.locator('.tiptap .rk-directive-sketch').first();await sketch.waitFor();
 await sketch.hover();
 const hoverStyle=await sketch.evaluate(el=>({active:el.classList.contains('rk-block-hovered'),
  outline:getComputedStyle(el).outlineStyle}));
 assert.equal(hoverStyle.outline,'none','handdrawn text blocks should have no structural hover frame');
 await sketch.locator('p').first().click({button:'right'});
 const context=page.getByRole('menu',{name:'编辑器右键菜单'});await context.waitFor();
 const chosenStyle=await sketch.evaluate(el=>({active:el.classList.contains('rk-block-selected'),outline:getComputedStyle(el).outlineStyle}));
 assert.equal(chosenStyle.outline,'none','handdrawn text blocks should have no selected frame');
 await page.keyboard.press('Escape');
 await callout.locator('.rk-directive-body p').first().click({button:'right'});
 await page.getByRole('menu',{name:'编辑器右键菜单'}).waitFor();
 assert.notEqual(await callout.evaluate(el=>getComputedStyle(el).outlineStyle),'none','structural callout should keep outline');
 await page.keyboard.press('Escape');
 console.log('PASS text-style handwriting no block frame, structural Callout retains outline',hoverStyle,chosenStyle);

 const line=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 await line.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const toolbar=page.getByRole('toolbar',{name:'文本格式'});await toolbar.waitFor();
 const mark=toolbar.getByRole('button',{name:'高亮'});
 assert.equal(await mark.count(),1);
 const yellow=await mark.locator('.toolbar-highlight').first().evaluate(el=>({
  text:el.textContent,background:getComputedStyle(el).backgroundColor}));
 assert.equal(yellow.text,'H');
 assert.equal(yellow.background,'rgb(247, 220, 111)');
 assert.equal(await toolbar.getByRole('button',{name:'插入行内公式'}).count(),1,'V5 requires direct inline math in formatting toolbar');
 for(const button of await toolbar.getByRole('button').all()){
  const label=await button.getAttribute('aria-label');
  assert.ok(label,'toolbar icon must have an accessible label');
 }
 await mark.hover();await page.waitForTimeout(800);
 const tooltip=page.getByRole('tooltip');
 assert.ok(await tooltip.count()>0,'hovering highlighter must show an actual tooltip');
 console.log('PASS yellow H and tooltips and inline-only BubbleMenu',yellow);

 const category=toolbar.getByRole('button',{name:'荧光笔与手绘标记'});
 await category.hover();
 const menu=page.getByRole('menu',{name:'荧光笔与手绘标记'});await menu.waitFor({state:'visible'});
 assert.equal(await menu.getByRole('menuitem').count(),9);
 await menu.getByRole('menuitem',{name:/手绘圈选/}).hover();
 await menu.waitFor({state:'visible'});
 await menu.getByRole('menuitem',{name:/手绘圈选/}).click();
 await page.locator('.tiptap .rk-sketch-inline[data-rk-sketch-kind="circle"]').first().waitFor();
 console.log('PASS hover-open portal dropdown survives pointer traversal and applies inline syntax');

 assert.deepEqual(errors,[]);
}finally{await browser.close();}
