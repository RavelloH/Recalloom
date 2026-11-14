import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8815';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const binary=[process.env.RECALLOOM_BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value=>value&&existsSync(value));
const secret=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(value=>/^\s*MCP_AUTH_SECRET\s*=/.test(value))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(binary&&secret);
const browser=await chromium.launch({headless:true,executablePath:binary});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
const observe=page=>{page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));};
observe(page);
const text='alpha beta gamma';
const create=page=>page.evaluate(async text=>{
 const name='Library format contract '+Date.now();
 const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,kind:'document',content:text+'\n\nAnother paragraph.'})});
 if(!response.ok)throw Error('Fixture creation failed '+response.status);
 return {...await response.json(),name};
},text);
const select=async(page,paragraph,toolbar)=>{
 for(let attempt=0;attempt<4;attempt++){
  await paragraph.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
  try{await toolbar.waitFor({state:'visible',timeout:2000});
   if(await page.evaluate(()=>getSelection()?.toString())===text)return;
  }catch{/* Retry only selection establishment, never the tested action. */}
 }
 throw Error('Could not establish editor text selection');
};
const editorOwnsSelection=async page=>page.evaluate(()=>({focus:document.activeElement?.matches('.tiptap[contenteditable="true"]'),selection:getSelection()?.toString()}));
try{
 await page.goto(base+'/login');await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/');
 const fixture=await create(page);await page.goto(base+'/records/'+fixture.id+'?mode=visual');
 const paragraph=page.locator('.tiptap p').filter({hasText:text}).first();
 const toolbar=page.getByRole('toolbar',{name:'文本格式',exact:true});
 await select(page,paragraph,toolbar);
 assert.ok(await toolbar.evaluate(element=>element.classList.contains('astryx-toolbar')),'Formatting uses Astryx Toolbar');
 const heading=toolbar.getByRole('button',{name:'标题',exact:true});
 await heading.hover();
 const menu=page.getByRole('menu',{name:'标题',exact:true});await menu.waitFor();
 assert.ok(await menu.evaluate(element=>element.classList.contains('astryx-dropdown-menu')),'Formatting uses Astryx DropdownMenu');
 await menu.getByRole('menuitem',{name:'2 级标题',exact:true}).hover();
 await page.locator('.rk-hover-format--heading[data-rk-preview-level="2"]').waitFor();
 assert.deepEqual(await editorOwnsSelection(page),{focus:true,selection:text},'Hover preserves editor focus and the native selection');
 assert.equal(await page.locator('.tiptap h2').count(),0,'Preview does not write a heading');
 assert.equal((await page.evaluate(async id=>(await fetch('/api/records/'+id)).json(),fixture.id)).content,text+'\n\nAnother paragraph.','Hover does not persist content');
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 assert.deepEqual(await editorOwnsSelection(page),{focus:true,selection:text},'Hover Escape keeps editor focus and selection');
 assert.equal(await page.locator('.rk-hover-format').count(),0,'Escape clears preview');
 console.log('PASS library hover focus, selection, preview and Escape');

 // Clicking a category already opened by hover keeps the menu usable.
 await heading.click();await menu.waitFor();
 await menu.getByRole('menuitem',{name:'2 级标题',exact:true}).click();
 await page.locator('.tiptap h2').filter({hasText:text}).waitFor();
 assert.equal(await page.locator('.tiptap h2').innerText(),text);
 assert.ok((await editorOwnsSelection(page)).focus,'Formatting returns focus to the editor');
 await page.keyboard.press('Control+z');await paragraph.waitFor();
 assert.equal(await page.locator('.tiptap h2').count(),0,'One undo reverses one menu action');
 console.log('PASS pointer apply, editor focus and single-step undo');

 await select(page,paragraph,toolbar);
 await heading.focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'粗体','Toolbar roves to the next format button');
 await heading.focus();await page.keyboard.press('ArrowDown');await menu.waitFor();
 await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitem');
 assert.match(await page.evaluate(()=>document.activeElement?.textContent),/1 级标题/);
 await page.keyboard.press('ArrowDown');
 assert.match(await page.evaluate(()=>document.activeElement?.textContent),/2 级标题/);
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 assert.ok(await heading.evaluate(element=>element===document.activeElement),'Keyboard Escape restores the trigger');
 await page.keyboard.press('ArrowDown');await menu.waitFor();
 await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitem');
 await page.keyboard.press('Enter');await page.locator('.tiptap h1').filter({hasText:text}).waitFor();
 await page.waitForFunction(()=>document.activeElement?.matches('.tiptap[contenteditable="true"]'));
 await page.keyboard.press('Control+z');await paragraph.waitFor();
 console.log('PASS Toolbar roving focus and menu keyboard navigation/apply/return');

 // The contenteditable keeps keyboard focus while both completion families
 // use a library-owned layer and expose their active option by stable ID.
 await paragraph.click();await page.keyboard.press('End');await page.keyboard.press('Enter');
 await page.keyboard.type('/');
 const editor=page.getByRole('textbox',{name:'文档正文',exact:true});
 const commands=page.getByRole('listbox',{name:'插入内容',exact:true});await commands.waitFor();
 assert.ok(await commands.evaluate(element=>Boolean(element.closest('[popover]'))),'Slash completion uses the library native layer');
 assert.equal(await editor.getAttribute('aria-controls'),await commands.getAttribute('id'));
 const selectedCommand=commands.getByRole('option',{selected:true});
 const firstActive=await selectedCommand.getAttribute('id');
 assert.ok(firstActive);assert.equal(await editor.getAttribute('aria-activedescendant'),firstActive);
 await page.keyboard.press('ArrowDown');
 const secondActive=await commands.getByRole('option',{selected:true}).getAttribute('id');
 assert.notEqual(secondActive,firstActive);assert.equal(await editor.getAttribute('aria-activedescendant'),secondActive);
 assert.ok((await editorOwnsSelection(page)).focus,'Completion navigation retains editor focus');
 await page.keyboard.press('Escape');await commands.waitFor({state:'hidden'});
 assert.equal(await editor.getAttribute('aria-controls'),null);assert.equal(await editor.getAttribute('aria-activedescendant'),null);
 await page.keyboard.press('Backspace');
 await page.keyboard.type('[['+fixture.name);
 const references=page.getByRole('listbox',{name:'引用文档',exact:true});await references.waitFor();
 const selectedReference=references.getByRole('option',{selected:true});await selectedReference.waitFor();
 assert.ok(await references.evaluate(element=>Boolean(element.closest('[popover]'))),'Wiki completion uses the library native layer');
 assert.equal(await editor.getAttribute('aria-controls'),await references.getAttribute('id'));
 assert.equal(await editor.getAttribute('aria-activedescendant'),await selectedReference.getAttribute('id'));
 assert.ok((await editorOwnsSelection(page)).focus,'Wiki results retain editor focus');
 await page.keyboard.press('Escape');await references.waitFor({state:'hidden'});
 assert.equal(await editor.getAttribute('aria-activedescendant'),null);
 console.log('PASS slash/Wiki library layers and active-descendant accessibility');

 const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,storageState:await page.context().storageState()});
 const touch=await touchContext.newPage();observe(touch);
 await touch.goto(base+'/');
 const touchFixture=await create(touch);await touch.goto(base+'/records/'+touchFixture.id+'?mode=visual');
 const touchParagraph=touch.locator('.tiptap p').filter({hasText:text}).first();
 const touchToolbar=touch.getByRole('toolbar',{name:'格式工具栏',exact:true});
 await select(touch,touchParagraph,touchToolbar);
 await touchToolbar.getByRole('button',{name:'标题',exact:true}).tap();
 const touchMenu=touch.getByRole('menu',{name:'标题',exact:true});await touchMenu.waitFor();
 await touchMenu.getByRole('menuitem',{name:'2 级标题',exact:true}).tap();
 await touch.locator('.tiptap h2').filter({hasText:text}).waitFor();
 await touchToolbar.getByRole('button',{name:'撤销',exact:true}).tap();await touchParagraph.waitFor();
 assert.equal(await touch.locator('.tiptap h2').count(),0);
 await touchToolbar.getByRole('button',{name:'标题',exact:true}).tap();await touchMenu.waitFor();
 await touch.locator('.workbench-header').tap();await touchMenu.waitFor({state:'hidden'});
 await touchContext.close();
 console.log('PASS real touch menu apply, undo and outside dismissal');
 assert.deepEqual(errors,[],'No browser errors');
}finally{await browser.close();}
