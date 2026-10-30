import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';
const browserBin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const auth=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
assert(browserBin&&auth);
const secret=auth.slice(auth.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({headless:true,executablePath:browserBin});
const origin='http://127.0.0.1:8897';
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await ctx.newPage();
const text=()=>page.locator('.cm-line').allTextContents().then(lines=>lines.join('\n'));
const source=async()=>{if(!(await page.getByRole('button',{name:'Markdown',exact:true}).getAttribute('aria-pressed'))){/* mode may not use aria-pressed */}await page.getByRole('button',{name:'Markdown',exact:true}).click();await page.locator('.cm-content').waitFor();};
const editor=async()=>{await page.locator('.editor-topline').waitFor();};
try{
 await page.goto(origin+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/');
 await page.goto(origin+'/library');
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill('Unsaved draft regression '+Date.now());
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.waitForURL(/\/records\//);
 const recordUrl=page.url();
 const dialog=page.getByRole('dialog',{name:'未保存的编辑内容'});
 await source();
 await page.locator('.cm-content').fill('Draft must survive navigation');
 assert.match(await text(),/Draft must survive navigation/);

 // Quota/storage failures must never silently discard a draft.
 await page.evaluate(()=>{
  const original=Storage.prototype.setItem;
  window.__draftSetItem=original;
  Storage.prototype.setItem=function(key,value){if(key.startsWith('recalloom:draft:'))throw new Error('QuotaExceededError');return original.call(this,key,value);};
 });
 await page.locator('.bottom-nav').getByText('搜索').click();
 await dialog.waitFor();
 await dialog.getByRole('button',{name:'保留草稿并离开'}).click();
 assert.equal(page.url().split('?')[0],recordUrl,'must stay on editor if draft cannot be stashed');
 assert.ok(await page.getByText(/浏览器无法暂存草稿/).count(),'must tell user why navigation was stopped');
 await page.evaluate(()=>{Storage.prototype.setItem=window.__draftSetItem;delete window.__draftSetItem;});
 await page.locator('.bottom-nav').getByText('搜索').click();

 await dialog.waitFor();
 await dialog.getByRole('button',{name:'留在编辑器'}).click();
 assert.equal(page.url().split('?')[0],recordUrl);
 assert.match(await text(),/Draft must survive navigation/);
 await page.locator('.bottom-nav').getByText('搜索').click();
 await dialog.getByRole('button',{name:'保留草稿并离开'}).click();
 await page.waitForURL(/\/search/);
 await page.goto(recordUrl);
 await editor();
 assert.ok(await page.getByText('已恢复本标签页未保存的草稿').count());
 await source();
 assert.match(await text(),/Draft must survive navigation/);
 await page.getByRole('button',{name:'丢弃恢复的草稿'}).click();
 assert.equal((await text()).trim(),'');
 await page.locator('.cm-content').fill('To be discarded');
 await page.locator('.bottom-nav').getByText('搜索').click();
 await dialog.getByRole('button',{name:'丢弃更改并离开'}).click();
 await page.waitForURL(/\/search/);
 await page.goto(recordUrl);
 await editor();
 assert.equal(await page.getByText('已恢复本标签页未保存的草稿').count(),0,'discarded draft should not return');
 await source();
 assert.equal((await text()).trim(),'');
 await page.locator('.cm-content').fill('Draft survives explicit reload');
 page.once('dialog',dialog=>dialog.accept());
 await page.reload();
 await editor();
 assert.ok(await page.getByText('已恢复本标签页未保存的草稿').count(),'reload should recover current-session draft');
 await source();
 assert.match(await text(),/Draft survives explicit reload/);
 await page.getByRole('button',{name:'丢弃恢复的草稿'}).click();
 await page.locator('.cm-content').fill('- One\n- Two\n  - Nested\n\n1. First\n2. Second\n\n- [ ] Check');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await page.locator('.tiptap ul').first().waitFor();
 const layout=await page.evaluate(()=>{
  const tiptap=document.querySelector('.tiptap');
  const unordered=tiptap?.querySelector('ul:not([data-type="taskList"])');
  const ordered=tiptap?.querySelector('ol');
  const task=tiptap?.querySelector('ul[data-type="taskList"]');
  const taskItem=task?.querySelector('li');
  const taskLabel=taskItem?.querySelector('label');
  const taskText=taskItem?.querySelector('div > p');
  const toolbar=document.querySelector('.wysiwyg-toolbar');
  const rect=toolbar?.getBoundingClientRect();
  const controls=[...document.querySelectorAll('.wysiwyg-toolbar button')].map(b=>Math.round(b.getBoundingClientRect().height));
  const main=document.querySelector('.editor-topline button')?.getBoundingClientRect();
  return {list:unordered&&getComputedStyle(unordered).listStyleType,ordered:ordered&&getComputedStyle(ordered).listStyleType,task:task&&getComputedStyle(task).listStyleType,taskItemDisplay:taskItem&&getComputedStyle(taskItem).display,taskDeltaY:taskLabel&&taskText?Math.abs(taskLabel.getBoundingClientRect().top-taskText.getBoundingClientRect().top):999,toolbarHeight:Math.round(rect?.height||0),toolbarWidth:Math.round(rect?.width||0),controlsMin:Math.min(...controls),modeHeight:Math.round(main?.height||0),overflow:document.documentElement.scrollWidth-innerWidth};
 });
 assert.equal(layout.list,'disc','ordinary unordered list needs bullets');
 assert.equal(layout.ordered,'decimal','ordinary ordered list needs numbers');
 assert.equal(layout.task,'none','checkbox list must not get markers');
 assert.equal(layout.taskItemDisplay,'flex','task checkbox and label must use a horizontal row');
 assert.ok(layout.taskDeltaY<=8,'task checkbox and text must align vertically');

 assert.ok(layout.toolbarHeight<=65,'mobile format toolbar should be one row');
 assert.ok(layout.controlsMin>=44&&layout.modeHeight>=44,'mobile buttons should be touch-sized');
 assert.equal(layout.overflow,0,'no horizontal overflow');
 await page.screenshot({path:'tmp/ux-phase-one-mobile.png',fullPage:false});
 // Older-version local drafts must never silently overwrite newer server content.
 await page.evaluate(async()=>{
  const auth=await (await fetch('/api/auth/session')).json();
  const record=await (await fetch('/api'+location.pathname)).json();
  const key='recalloom:draft:'+auth.session.id+':'+record.id;
  sessionStorage.setItem(key,JSON.stringify({recordId:record.id,revision:record.revision-1,content:'STALE_DRAFT_MUST_NOT_OVERWRITE_REMOTE',updatedAt:Date.now()}));
 });
 await page.reload();await editor();
 assert.ok(await page.getByText('发现旧版本的未保存草稿').count(),'older revision must require manual recovery');
 await source();
 assert.ok(!(await text()).includes('STALE_DRAFT_MUST_NOT_OVERWRITE_REMOTE'),'old draft must not overwrite new server content');
 await page.getByRole('button',{name:'丢弃旧草稿'}).click();


 // The same guard must protect unsaved Tiptap edits, not only CodeMirror.
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await page.locator('.tiptap li:not([data-type="taskItem"])').first().click();
 await page.keyboard.type('VISUAL_DRAFT_TEXT');
 assert.ok((await page.locator('.tiptap').innerText()).includes('VISUAL_DRAFT_TEXT'));
 await page.locator('.bottom-nav').getByText('搜索').click();
 await dialog.waitFor();
 await dialog.getByRole('button',{name:'保留草稿并离开'}).click();
 await page.waitForURL(/\/search/);
 await page.goto(recordUrl);await editor();
 assert.ok(await page.getByText('已恢复本标签页未保存的草稿').count());
 await source();
 assert.ok((await text()).replaceAll('\\_','_').includes('VISUAL_DRAFT_TEXT'),'unsaved visual edit is recovered after Markdown escaping');
 await page.getByRole('button',{name:'丢弃恢复的草稿'}).click();


 // Logging out must not leak tab-scoped drafts into another session.
 await source();
 await page.locator('.cm-content').fill('DRAFT_BEFORE_LOGOUT');
 await page.getByRole('button',{name:'打开导航'}).click();
 page.on('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'退出登录'}).click();
 await page.waitForTimeout(1800);
 await page.waitForURL(/\/login/,{timeout:6000});
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('recalloom:draft:')).length),0,'logout must purge all session draft data');

 console.log('PASS draft cancel / keep / discard / reload; lists and mobile controls',JSON.stringify(layout));
}finally{await browser.close();}
