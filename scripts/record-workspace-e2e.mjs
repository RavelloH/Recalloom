/** Recalloom document workspace flows against an isolated local Worker. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';

const bin=[process.env.RECALLOOM_BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
const line=existsSync('.dev.vars')?readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x)):undefined;
const secret=process.env.RECALLOOM_TEST_SECRET||line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(bin&&secret,'A local browser and test secret are required');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
const browser=await chromium.launch({headless:true,executablePath:bin});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const faults=[];
page.on('pageerror',e=>faults.push(e.message));
// Local dev has no Workers AI: smart search answers 500 and the UI falls back to keyword results.
const aiUnavailable=r=>r.url().includes('/api/search')&&r.url().includes('mode=auto');
page.on('response',r=>{if(r.status()>=500&&!aiUnavailable(r))faults.push(r.status()+' '+r.url());});
page.on('console',m=>{if(m.type()==='error'&&!/401 \(Unauthorized\)|Failed to load resource/.test(m.text()))faults.push(m.text());});
const json=path=>page.evaluate(async p=>{const r=await fetch('/api'+p);if(!r.ok)throw Error(p+' '+r.status);return r.json();},path);
const until=async(check,message)=>{for(let i=0;i<60;i++){if(await check())return;await page.waitForTimeout(250);}throw Error('Timed out: '+message);};
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:120000});
 // A leading digit keeps the fixture folder within the first page of the root tree.
 const folderName='0 Workspace E2E '+Date.now();
 const folder=await page.evaluate(async name=>{const r=await fetch('/api/folders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});return r.json();},folderName);

 // Newly created records focus the editable document title.
 await page.goto(base+'/library/'+folder.id,{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:folderName,level:1}).waitFor();
 await page.locator('.file-table').getByRole('button',{name:'新建页面'}).click();
 await page.waitForURL(/\/records\//);
 const recordId=page.url().split('/records/')[1].split('?')[0];
 const title=page.getByRole('heading',{level:1});
 await title.waitFor();
 await until(()=>page.evaluate(()=>document.activeElement?.classList.contains('page-title')),'new page focuses its title');
 await page.keyboard.type('Workspace note');
 await page.keyboard.press('Enter');
 await until(async()=>(await json('/records/'+recordId+'?metadataOnly=true')).name==='Workspace note','inline rename persisted');
 await page.locator('.crumb-current').filter({hasText:'Workspace note'}).waitFor();
 await page.locator('.tree-row.is-active').filter({hasText:'Workspace note'}).waitFor();

 // Rename validation keeps the stored name and explains why.
 await title.click();
 await page.keyboard.press('Control+A');
 await page.keyboard.type('bad/name');
 await page.keyboard.press('Enter');
 await page.getByRole('alert').filter({hasText:'不能包含'}).waitFor();
 assert.equal(await title.innerText(),'Workspace note','invalid title reverts');

 // Tags are edited in the unified document inspector, not always visible under the title.
 await page.getByRole('button',{name:'详细信息'}).click();
 const inspector=page.getByRole('dialog',{name:'文档检查器'});
 await inspector.getByRole('button',{name:'添加标签'}).click();
 await inspector.getByRole('textbox',{name:'新标签'}).fill('Alpha');
 await page.keyboard.press('Enter');
 await until(async()=>(await json('/records/'+recordId)).tags.includes('alpha'),'tag added');
 await inspector.locator('.tag-editor').getByText('alpha',{exact:true}).waitFor();
 await inspector.locator('.tag-editor').getByRole('button',{name:/alpha/}).click();
 await until(async()=>!(await json('/records/'+recordId)).tags.includes('alpha'),'tag removed');
 await inspector.getByRole('button',{name:'关闭'}).click();
 await inspector.waitFor({state:'hidden'});

 // Heading shortcuts remain supported; /h2 is no longer a registered slash command.
 await page.locator('.tiptap p').first().click();
 await page.keyboard.press('Control+Alt+2');
 await page.keyboard.type('Section title');
 await page.keyboard.press('Enter');
 await page.keyboard.type('/');
 const menu=page.getByRole('listbox',{name:'插入内容'});
 await menu.waitFor();
 assert.ok(await menu.getByRole('option',{name:/代码块/}).count(),'current slash commands remain discoverable');
 await page.keyboard.press('Escape');
 await menu.waitFor({state:'hidden'});
 await page.keyboard.press('Backspace');
 await page.keyboard.type('plain words');
 await page.keyboard.press('Shift+Home');
 const bold=page.getByRole('toolbar',{name:'文本格式'}).getByRole('button',{name:'粗体'});
 await bold.click();
 assert.equal(await bold.getAttribute('aria-pressed'),'true','bubble menu applies bold');
 await page.keyboard.press('End');
 await page.keyboard.press('Control+s');
 await until(async()=>(await json('/records/'+recordId)).revision>=2,'Ctrl+S saves');
 const saved=(await json('/records/'+recordId)).content;
 assert.match(saved,/^## Section title$/m,'slash heading exported: '+saved);
 assert.ok(saved.includes('**plain words**'),'bubble bold exported: '+saved);
 await page.locator('.editor-topline .save-status').filter({hasText:'已保存'}).waitFor();

 // Quick switcher finds pages by name.
 await page.goto(base+'/',{waitUntil:'networkidle'});
 await page.locator('.recent-page').filter({hasText:'Workspace note'}).first().waitFor();
 await page.keyboard.press('Control+k');
 const palette=page.getByRole('dialog',{name:'快速导航'});
 await palette.waitFor();
 await page.keyboard.type('Workspace note');
 await palette.getByRole('option',{name:/Workspace note/}).first().waitFor();
 await palette.getByRole('option',{name:/Workspace note/}).first().click();
 await page.waitForURL('**/records/'+recordId);

 // Page tree reveals the current page and remembers collapsed folders.
 const toggle=page.locator('.tree-row').filter({hasText:folderName}).getByRole('button',{name:/收起|展开/});
 assert.equal(await toggle.getAttribute('aria-expanded'),'true','visiting a page reveals its folder');
 await toggle.click();
 // AutoResizer animates the collapsed tree; wait until the exiting subtree unmounts.
 await page.locator('.tree-row').filter({hasText:'Workspace note'}).first().waitFor({state:'detached',timeout:12000});
 assert.equal(await page.locator('.tree-row').filter({hasText:'Workspace note'}).count(),0,'collapsed folder hides children');
 await page.goto(base+'/library/'+folder.id,{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:folderName,level:1}).waitFor();
 assert.equal(await toggle.getAttribute('aria-expanded'),'false','collapsed state persists across navigation');

 // Folder titles are editable in place too.
 const renamed=folderName+' renamed';
 await page.getByRole('heading',{name:folderName,level:1}).click();
 await page.keyboard.press('End');
 await page.keyboard.type(' renamed');
 await page.keyboard.press('Enter');
 await until(async()=>(await json('/folders/'+folder.id)).name===renamed,'folder rename persisted');
 await page.locator('.tree-row').filter({hasText:renamed}).waitFor();

 // Sidebar "+" creates inside that folder without a form.
 const row=page.locator('.tree-row').filter({hasText:renamed});
 await row.hover();
 await row.getByRole('button',{name:'在「'+renamed+'」中新建'}).click();
 await page.getByRole('menuitem',{name:'新建任务列表'}).click();
 await page.waitForURL(/\/records\//);
 const listId=page.url().split('/records/')[1].split('?')[0];
 const list=await json('/records/'+listId+'?metadataOnly=true');
 assert.equal(list.kind,'task_list');
 assert.equal(list.folderId,folder.id);
 await page.getByRole('heading',{name:'未命名任务列表',level:1}).waitFor();

 // One column: document title and editable body retain aligned measures.
 await page.goto(base+'/records/'+recordId,{waitUntil:'networkidle'});
 await page.locator('.tiptap').waitFor();
 const edges=await page.evaluate(()=>[...document.querySelectorAll('.workbench-header .page-title, .record-main .tiptap')].map(e=>{const b=e.getBoundingClientRect();return Math.round(b.left)+':'+Math.round(b.width);}));
 assert.equal(new Set(edges).size,1,'shared measure: '+edges);
 // Native bars are hidden outside Apple WebKit; the page scrolls with the JS scrollbar.
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.scrollbarMode),'overlay');
 assert.ok(await page.locator('.main-scroll-host > .os-scrollbar-vertical').count(),'main area uses the overlay scrollbar');
 assert.equal(await page.locator('.topbar').getByRole('button',{name:/主题/}).count(),0,'theme toggle lives only in the sidebar');
 // The palette and the search page are one search: the footer opens the same query as a page.
 await page.keyboard.press('Control+k');
 await palette.waitFor();
 await page.keyboard.type('Workspace note');
 await palette.getByRole('button',{name:'在搜索页查看全部结果'}).click();
 await page.waitForURL(url=>url.pathname==='/search'&&url.searchParams.get('q')==='Workspace note');
 await page.getByRole('heading',{name:'搜索',level:1}).waitFor();
 await page.locator('.search-result').filter({hasText:'Workspace note'}).first().waitFor({timeout:20000});
 assert.equal(await page.getByRole('textbox',{name:'搜索关键字'}).inputValue(),'Workspace note');

 // Phones keep inline actions and the format toolbar without horizontal overflow.
 const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await phone.addCookies(await ctx.cookies());
 const mobile=await phone.newPage();
 await mobile.goto(base+'/records/'+recordId,{waitUntil:'networkidle'});
 await mobile.locator('.wysiwyg-toolbar').waitFor();
 await mobile.locator('.record-main .editor-topline').waitFor();
 const fit=await mobile.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth,crumb:document.querySelector('.topbar .crumb-current')?.textContent}));
 assert.ok(fit.scroll<=fit.viewport,'mobile record fits: '+JSON.stringify(fit));
 assert.equal(fit.crumb,'Workspace note','mobile top bar names the current page');
 // Save is pinned in the top bar on phones, never scrolled out of the action row.
 assert.ok(await mobile.locator('.topbar .page-actions-pinned').getByRole('button',{name:'保存'}).isVisible(),'mobile save stays reachable');
 await phone.close();

 assert.equal(faults.length,0,'browser errors: '+faults.join('\n'));
 console.log('PASS Recalloom workspace: inline titles, inspector tags, slash menus, Ctrl+S, quick switcher, page tree, mobile');
}catch(e){console.error('Workspace E2E failed',e);console.error('page=',page.url());await page.screenshot({path:'tmp/workspace-failed.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();}
