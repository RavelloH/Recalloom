import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,mkdirSync} from 'node:fs';
const url=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
const secret=process.env.RECALLOOM_TEST_SECRET||'recalloom-local-web-test-secret-32-bytes-only';
const browserPath=[process.env.RECALLOOM_BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
if(!browserPath)throw Error('Install Edge/Chrome or set RECALLOOM_BROWSER_PATH for browser E2E tests.');
async function chooseOption(page,label,value){
 await page.getByRole('combobox',{name:label}).click();
 await page.getByRole('option',{name:value,exact:true}).click();
}
const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-first-run','--disable-extensions']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();const faults=[];
page.on('pageerror',e=>faults.push('pageerror:'+e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401 (Unauthorized)'))faults.push('console:'+m.text());});
try{
 await page.goto(url+'/library',{waitUntil:'networkidle'});
 await page.waitForURL('**/login',{timeout:15000});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(url+'/',{timeout:120000});
 await page.getByRole('heading',{name:'概览'}).waitFor({timeout:18000});
 const entryMotion=await page.locator('.route-stage').evaluate(el=>({
   name:getComputedStyle(el).animationName,
   duration:getComputedStyle(el).animationDuration
 }));
 assert.ok(entryMotion.name.includes('rk-page-enter'),'route entrance uses short motion: '+JSON.stringify(entryMotion));
 assert.ok(parseFloat(entryMotion.duration)>0&&parseFloat(entryMotion.duration)<.5,'entry motion under half a second');
 assert.equal(await page.locator('.overview-link').count(),3,'quiet quick links replace oversized cards');
 assert.equal(await page.locator('.stat-card').count(),0,'no large nested navigation cards');
 assert.equal(await page.locator('.route-stage').evaluate(el=>getComputedStyle(el).transform),'none','no page slide transform');
 await page.keyboard.press('Control+k');
 await page.getByRole('dialog',{name:'快速导航'}).waitFor();
 await page.getByRole('dialog',{name:'快速导航'}).getByRole('button',{name:'搜索'}).click();
 await page.getByRole('heading',{name:'搜索',level:1}).waitFor();
 await page.goto(url+'/');
 await page.getByRole('heading',{name:'概览'}).waitFor();
 // Mobile grids must not widen to min-content when activity names or tasks are long.
 for(const width of [320,390,414,430]){
   const probe=await browser.newContext({viewport:{width,height:844},isMobile:true,deviceScaleFactor:2,hasTouch:true});
   await probe.addCookies(await context.cookies());
   const screen=await probe.newPage();
   await screen.goto(url+'/',{waitUntil:'networkidle'});
   await screen.getByRole('heading',{name:'概览'}).waitFor();
   if(width===390){
     await screen.getByRole('button',{name:'打开导航'}).click();
     await screen.waitForFunction(()=>document.querySelector('.mobile-scrim')?.classList.contains('is-visible'));
     const visible=await screen.locator('.mobile-scrim').evaluate(el=>({
       opacity:getComputedStyle(el).opacity,
       transition:getComputedStyle(el).transitionDuration,
       pointer:getComputedStyle(el).pointerEvents
     }));
     assert.equal(visible.pointer,'auto','scrim intercepts touch when navigation is open');
     assert.ok(parseFloat(visible.transition)>0,'mobile scrim fades in');
     await screen.getByRole('button',{name:'关闭导航'}).click();
     await screen.waitForFunction(()=>!document.querySelector('.mobile-scrim')?.classList.contains('is-visible'));
     assert.equal(await screen.locator('.mobile-scrim').getAttribute('aria-hidden'),'true','hidden scrim is not a keyboard target');
   }
   const result=await screen.evaluate(()=>{
     const longName='LongUnbrokenFileName'.repeat(30);
     const activity=document.querySelector('.recent-entry .activity-resource');
     const task=document.querySelector('.compact-row a');
     if(activity)activity.textContent=longName;
     if(task)task.textContent=longName;
     const panel=document.querySelector('.dashboard-grid>.home-card');
     if(!panel)throw Error('dashboard panel missing');
     const box=panel.getBoundingClientRect();
     return {left:box.left,right:innerWidth-box.right,viewport:innerWidth,scroll:document.documentElement.scrollWidth};
   });
   assert.ok(Math.abs(result.left-result.right)<=1,'symmetric dashboard gutters: '+JSON.stringify(result));
   assert.ok(result.left>=14,'mobile gutters: '+JSON.stringify(result));
   assert.ok(result.scroll<=result.viewport,'no horizontal overflow: '+JSON.stringify(result));
   for(const path of ['/search','/library','/settings/appearance']){
     await screen.goto(url+path,{waitUntil:'networkidle'});
     const fit=await screen.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
     assert.ok(fit.scroll<=fit.viewport,'no horizontal overflow '+path+'@'+width+': '+JSON.stringify(fit));
   }
   await probe.close();
 }
 // OS accessibility preference must disable all custom entry and navigation motion.
 const quiet=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await quiet.addCookies(await context.cookies());
 const quietPage=await quiet.newPage();
 await quietPage.goto(url+'/library',{waitUntil:'networkidle'});
 await quietPage.getByRole('heading',{name:'知识库'}).waitFor();
 const quietStyles=await quietPage.evaluate(()=>({
  route:getComputedStyle(document.querySelector('.route-stage')).animationName,
  sidebar:getComputedStyle(document.querySelector('.sidebar')).transitionDuration,
  row:getComputedStyle(document.querySelector('.file-row')||document.querySelector('.file-table')).transitionDuration
 }));
 assert.equal(quietStyles.route,'none','reduced motion disables route entrance');
 assert.equal(quietStyles.sidebar.split(',')[0].trim(),'0s','reduced motion disables sidebar transitions');
 await quiet.close();
 assert.equal((await context.cookies()).some(c=>c.name==='__Host-recalloom_session'),true,'session should use secure cookie');
 await page.goto(url+'/library');
 await page.getByRole('heading',{name:'知识库'}).waitFor();
 const folderName='UI test '+Date.now();
 await page.getByRole('button',{name:'新建文件夹'}).click();
 const field=page.getByRole('textbox',{name:'名称'});
 const inputStyle=await field.evaluate(el=>({border:getComputedStyle(el).borderStyle,padding:getComputedStyle(el).padding}));
 assert.equal(inputStyle.border,'none','Astryx TextInput must not receive a duplicate native border');
 await page.getByRole('textbox',{name:'名称'}).fill(folderName);
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByText(folderName,{exact:true}).waitFor();
 await page.getByText(folderName,{exact:true}).click();
 await page.getByRole('heading',{name:folderName,level:1}).waitFor();
 const folderUrl=page.url();
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill('First note');
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByRole('heading',{name:'First note'}).waitFor();
 await page.getByRole('button',{name:'Markdown'}).click();
 await page.locator('.cm-content').fill('# UI e2e\n\nDocument updated from source editor.');
 await page.getByRole('button',{name:'保存'}).click();
 await page.getByText('R2').waitFor({timeout:15000});
 await page.getByRole('button',{name:'详情'}).click();
 await page.locator('.outline-item').first().waitFor();
 assert.ok((await page.locator('.outline-item').first().innerText()).includes('UI e2e'),'outline has Markdown heading');
 await page.locator('.outline-item').first().click();
 await page.locator('.cm-content').waitFor();
 await page.getByRole('button',{name:'详情'}).click();
 await page.getByRole('button',{name:'历史'}).click();
 await page.getByText('Revision 2').first().waitFor();
 await page.getByRole('button',{name:'历史',exact:true}).click();
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap').waitFor({timeout:14000});
 await page.locator('.tiptap').click();
 await page.keyboard.press('End');
 await page.keyboard.type(' Additional visual edit.');
 const boldButton=page.getByRole('button',{name:'粗体'});
 await boldButton.click();
 assert.equal(await boldButton.getAttribute('aria-pressed'),'true','Astryx ToggleButton reflects formatting state');
 await boldButton.click();
 assert.equal(await boldButton.getAttribute('aria-pressed'),'false','formatting can be toggled off');
 await page.getByRole('button',{name:'保存'}).click();
 await page.getByText('R3').waitFor({timeout:15000});
 await page.getByRole('button',{name:'Markdown'}).click();
 const extended=['# UI e2e','','- [x] Completed','- [ ] Pending','','| Item | Value |','| --- | --- |','| Test | 42 |','','$$x^2+y^2=z^2$$','','~~removed~~ **bold** and `inline`'].join(String.fromCharCode(10));
 await page.locator('.cm-content').fill(extended);
 await page.getByRole('button',{name:'保存'}).click();
 await page.getByText('R4').waitFor({timeout:15000});
 await page.getByRole('button',{name:'预览'}).click();
 await page.locator('.markdown-preview table').waitFor({timeout:15000});
 await page.locator('.markdown-preview .katex').first().waitFor({timeout:15000});
 assert.ok(await page.locator('.markdown-preview input[type=checkbox]').count()>=2,'GFM task lists render');
 await page.getByRole('button',{name:'Markdown'}).click();
 assert.ok((await page.locator('.cm-content').innerText()).includes('x^2+y^2=z^2'),'source retains math syntax');
 const recUrl=page.url();
 await page.goto(url+'/settings/appearance');
 await page.getByRole('heading',{name:'外观',level:1}).waitFor();
 await chooseOption(page,'主题','深色');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await chooseOption(page,'主题','浅色');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 for(const [path,title] of [['/tasks','任务'],['/search','搜索'],['/activity','活动'],['/settings/sessions','登录会话'],['/settings/indexing','索引状态']]){
  await page.goto(url+path);
  await page.getByRole('heading',{name:title,level:1}).waitFor({timeout:16000});
 }
 await page.goto(url+'/');
 await page.getByRole('heading',{name:'概览'}).waitFor();
 await page.locator('.recent-entry').first().waitFor();
 assert.ok((await page.locator('.recent-entry').first().innerText()).includes('本人（Web）'),'activity displays owner');
 await page.goto(url+'/search');
 await page.getByRole('textbox',{name:'搜索关键字'}).fill('UI e2e');
 await chooseOption(page,'搜索模式','精确文本');
 await page.getByRole('button',{name:'搜索',exact:true}).click();
 await page.locator('.search-highlight').first().waitFor({timeout:15000});
 await page.goto(recUrl);
 await page.getByRole('heading',{name:'First note'}).waitFor();
 console.log('DESKTOP_SHELL',await page.locator('.shell').evaluate(el=>({className:el.className,sidebarWidth:el.querySelector('.sidebar')?.getBoundingClientRect().width,shellWidth:el.getBoundingClientRect().width,viewportWidth:innerWidth})));
 await page.screenshot({path:'tmp/recalloom-desktop.png',fullPage:true});
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:2,hasTouch:true});
 const mobilePage=await mobile.newPage();
 // Reuse the session cookie for an authenticated mobile render in the same isolated test environment.
 await mobile.addCookies(await context.cookies());
 await mobilePage.goto(recUrl,{waitUntil:'networkidle'});
 await mobilePage.getByRole('heading',{name:'First note'}).waitFor();
 await mobilePage.getByRole('button',{name:'打开导航'}).tap();
 await mobilePage.locator('.sidebar.mobile-open').waitFor();
 await mobilePage.getByRole('link',{name:'活动',exact:true}).first().tap();
 await mobilePage.getByRole('heading',{name:'活动',level:1}).waitFor();
 await mobilePage.getByRole('link',{name:'设置',exact:true}).last().tap();
 await mobilePage.getByRole('link',{name:'外观'}).tap();
 await chooseOption(mobilePage,'主题','深色');
 assert.equal(await mobilePage.locator('html').getAttribute('data-effective-theme'),'dark');
 assert.equal(await mobilePage.locator('meta[name="theme-color"]').getAttribute('content'),'#111113');
 await chooseOption(mobilePage,'主题','浅色');
 assert.equal(await mobilePage.locator('meta[name="theme-color"]').getAttribute('content'),'#ffffff');
 await mobilePage.goto(recUrl);
 await mobilePage.getByRole('heading',{name:'First note'}).waitFor();
 await mobilePage.screenshot({path:'tmp/recalloom-mobile.png',fullPage:true});
 assert.ok(await mobilePage.getByRole('link',{name:'任务'}).first().isVisible());
 await mobile.close();
 // A checkpoint is now an ordinary document template carrying regular tags.
 await page.goto(folderUrl);
 await page.getByRole('button',{name:'新建记录'}).click();
 await chooseOption(page,'类型','阶段总结（文档模板）');
 await page.getByRole('textbox',{name:'名称'}).fill('Phase summary');
 await page.getByRole('textbox',{name:'标签'}).fill('planning, retrospective');
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.locator('.page-header').getByRole('heading',{name:'Phase summary'}).waitFor();
 await page.getByRole('button',{name:'详情'}).click();
 await page.locator('.record-inspector dd').filter({hasText:'checkpoint'}).waitFor();
 await page.locator('.outline-item').first().waitFor();
 await page.locator('.outline-item').nth(1).click();
 await page.locator('.cm-content').waitFor();
 assert.ok(page.url().includes('mode=source'),'outline navigation switches to source editor');
 assert.equal(faults.length,0,'browser errors: '+faults.join('\n'));
 console.log('PASS browser UI: Cap PoW login, SPA routing, folder/document CRUD, Markdown editor, revision history, desktop+mobile rendering');
}catch(e){console.error('Browser UI E2E failed',e);console.error('page=',page.url());console.error('errors=',faults.slice(0,12));await page.screenshot({path:'tmp/recalloom-failed.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();}
