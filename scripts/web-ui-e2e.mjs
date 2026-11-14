import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
const url=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
const secretLine=existsSync('.dev.vars')?readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line)):undefined;
const localSecret=secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')??'';
const secret=process.env.RECALLOOM_TEST_SECRET||localSecret;
if(!secret)throw Error('Set RECALLOOM_TEST_SECRET or provide MCP_AUTH_SECRET in local .dev.vars');
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
 // Routing is immediate; only the new page receives a short enter animation.
 // Observe route phases *before* Playwright click(): the click action can
 // resolve after the short enter animation has already finished.
 await page.evaluate(()=>{
  const phases=[document.querySelector('.page-transition')?.getAttribute('data-phase')];
  const watch=new MutationObserver(records=>{
   for(const item of records)if(item.type==='attributes'&&item.attributeName==='data-phase'){
    phases.push(item.target.getAttribute('data-phase'));
   }
  });
  watch.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-phase']});
  window.__routePhaseProbe={phases,watch};
 });
 await page.locator('.sidebar .nav-link',{hasText:'任务'}).click();
 const phases=new Set(await page.evaluate(()=>{
  const probe=window.__routePhaseProbe;
  probe?.watch.disconnect();
  delete window.__routePhaseProbe;
  return probe?.phases??[];
 }));
 assert.ok(phases.has('enter')&&!phases.has('exit'),'route must enter without exit animation: '+[...phases]);
 await page.getByRole('heading',{name:'任务',level:1}).waitFor();
 await page.locator('.sidebar .nav-link',{hasText:'概览'}).click();
 await page.getByRole('heading',{name:'概览'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.page-transition')?.dataset.phase==='idle');
 assert.equal(await page.locator('.home-section .section-heading').count(),1,'home leads with recently visited pages');
 assert.equal(await page.locator('.stat-card').count(),0,'no large nested navigation cards');
 assert.equal(await page.locator('.page-transition').evaluate(el=>getComputedStyle(el).transform),'none','settled page has no transform');
 await page.keyboard.press('Control+k');
 await page.getByRole('dialog',{name:'快速导航'}).waitFor();
 await page.getByRole('dialog',{name:'快速导航'}).getByRole('option',{name:'搜索',exact:true}).click();
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
   // A fixed off-canvas sidebar must never consume layout width when closed.
   // Scroll width alone cannot catch a 290px sidebar occupying flex space.
   const shellLayout=await screen.evaluate(()=>{
     const sidebar=document.querySelector('.sidebar');
     const workspace=document.querySelector('.workspace');
     const main=document.querySelector('.main-content');
     const box=workspace?.getBoundingClientRect();
     return {sidePosition:sidebar&&getComputedStyle(sidebar).position,
       left:box?.left,width:box?.width,mainWidth:main?.getBoundingClientRect().width,viewport:innerWidth};
   });
   assert.equal(shellLayout.sidePosition,'fixed','mobile sidebar must be out of normal layout');
   assert.ok(Math.abs(shellLayout.left??99)<=1,'mobile workspace starts at left edge: '+JSON.stringify(shellLayout));
   assert.ok(Math.abs((shellLayout.width??0)-width)<=1,'mobile workspace occupies whole viewport: '+JSON.stringify(shellLayout));
   assert.ok((shellLayout.mainWidth??0)>=width-1,'main content remains readable: '+JSON.stringify(shellLayout));
   if(width===390){
     await screen.getByRole('button',{name:'打开导航'}).click();
     await screen.waitForFunction(()=>document.querySelector('.mobile-scrim')?.classList.contains('is-visible'));
     assert.ok(await screen.locator('.workspace').evaluate(el=>Math.abs(el.getBoundingClientRect().left)<2),'opening navigation must not shift main workspace');
     const visible=await screen.locator('.mobile-scrim').evaluate(el=>({
       opacity:getComputedStyle(el).opacity,
       transition:getComputedStyle(el).transitionDuration,
       pointer:getComputedStyle(el).pointerEvents
     }));
     assert.equal(visible.pointer,'auto','scrim intercepts touch when navigation is open');
     assert.ok(parseFloat(visible.transition)>0,'mobile scrim fades in');
     await screen.locator('.mobile-scrim').click({position:{x:width-8,y:200}});
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
   for(const path of ['/search','/library','/settings','/settings/oauth']){
     await screen.goto(url+path,{waitUntil:'networkidle'});
     const fit=await screen.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
     assert.ok(fit.scroll<=fit.viewport,'no horizontal overflow '+path+'@'+width+': '+JSON.stringify(fit));
   }
   await probe.close();
 }
 // Create a real file row fixture so skeleton geometry tests work on empty D1.
 await page.evaluate(async()=>{
  const res=await fetch('/api/records',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({name:'UI file skeleton fixture '+Date.now(),kind:'document'})});
  if(!res.ok)throw new Error('File layout fixture failed: '+res.status+' '+(await res.text()));
 });
 // Skeletons must use the same geometry as the actual document list.
 const skeletonContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await skeletonContext.addCookies(await context.cookies());
 const skeletonPage=await skeletonContext.newPage();
 // A cold page's JS and route loader warm-up may take longer than 800ms.
 // Hold the response long enough to deterministically inspect the transient skeleton.
 await skeletonPage.route('**/api/folders*',async route=>{await new Promise(resolve=>setTimeout(resolve,3000));await route.continue();});
 await skeletonPage.goto(url+'/library',{waitUntil:'domcontentloaded'});
 await skeletonPage.locator('.skeleton-files .file-row').first().waitFor({timeout:15000});
 const skeletonBox=await skeletonPage.locator('.skeleton-files .file-row').first().boundingBox();
 assert.ok(skeletonBox,'file skeleton is rendered');
 await skeletonPage.locator('a.file-row').first().waitFor({timeout:15000});
 const fileBox=await skeletonPage.locator('a.file-row').first().boundingBox();
 assert.ok(fileBox,'real file row is rendered');
 assert.ok(Math.abs(skeletonBox.width-fileBox.width)<=1,'skeleton and file row widths match');
 assert.ok(Math.abs(skeletonBox.x-fileBox.x)<=1,'skeleton and real content left edges match');
  // A deterministic fixture avoids dependence on leftovers in local D1.
  await skeletonPage.evaluate(async()=>{
    const post=async(path,body)=>{
      const response=await fetch('/api'+path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error('Fixture '+path+': '+response.status+' '+(await response.text()));
      return response.json();
    };
    const list=await post('/records',{name:'UI layout task fixture '+Date.now(),kind:'task_list'});
    await post('/tasks/mutate',{recordId:list.id,action:'add',expectedRevision:1,changes:{title:'UI layout task',details:'Check long task text for mobile geometry.',status:'todo',priority:0}});
  });
 await skeletonPage.goto(url+'/tasks',{waitUntil:'networkidle'});
 await skeletonPage.locator('.task-list > .task-item').first().waitFor();
 await skeletonPage.evaluate(()=>{const task=document.querySelector('.task-list > .task-item');if(task&&!task.querySelector('.task-details')){const details=document.createElement('p');details.className='task-details muted';details.textContent='Long task detail '.repeat(20);task.querySelector('.task-heading')?.after(details);}});
 const taskGeometry=await skeletonPage.locator('.task-list > .task-item').first().evaluate(el=>{
   const a=el.getBoundingClientRect(),b=el.querySelector('.task-details').getBoundingClientRect(),footer=el.querySelector('.task-footer').getBoundingClientRect();
   return {itemWidth:a.width,detailsWidth:b.width,footerWidth:footer.width,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
 });
 assert.ok(taskGeometry.detailsWidth>taskGeometry.itemWidth*.70,'task description uses available width: '+JSON.stringify(taskGeometry));
 assert.ok(taskGeometry.footerWidth>taskGeometry.itemWidth*.70,'task controls row stretches to available width');
 assert.ok(taskGeometry.scrollWidth<=taskGeometry.viewport,'task layout does not overflow mobile viewport');
 await skeletonContext.close();
 // OS accessibility preference must disable all custom entry and navigation motion.
 const quiet=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await quiet.addCookies(await context.cookies());
 const quietPage=await quiet.newPage();
 await quietPage.goto(url+'/library',{waitUntil:'networkidle'});
 await quietPage.getByRole('heading',{name:'知识库'}).waitFor();
 const quietStyles=await quietPage.evaluate(()=>({
  route:getComputedStyle(document.querySelector('.page-transition')).animationName,
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
 await page.locator('.file-row').getByText(folderName,{exact:true}).first().waitFor();
 await page.locator('.file-row').getByText(folderName,{exact:true}).first().click();
 await page.getByRole('heading',{name:folderName,level:1}).waitFor();
 const folderUrl=page.url();
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill('First note');
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByRole('heading',{name:'First note'}).waitFor();
 await page.getByRole('button',{name:'源码'}).click();
 await page.locator('.cm-content').fill('# UI e2e\n\nDocument updated from source editor.');
 await page.getByRole('button',{name:'保存'}).click();
 await page.locator('.workbench-header .workbench-revision').getByText('R2',{exact:true}).waitFor({timeout:15000});
 await page.getByRole('button',{name:'目录',exact:true}).click();
 await page.locator('#document-panel').waitFor();
 await page.locator('.outline-item').first().waitFor();
 assert.ok((await page.locator('.outline-item').first().innerText()).includes('UI e2e'),'outline has Markdown heading');
 await page.locator('.outline-item').first().click();
 await page.locator('.cm-content').waitFor();
 await page.locator('#document-panel').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'历史'}).click();
 await page.getByText('Revision 2').first().waitFor();
 await page.locator('#document-panel').getByRole('button',{name:'关闭'}).click();
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap').waitFor({timeout:14000});
 await page.locator('.tiptap').click();
 await page.keyboard.press('End');
 await page.keyboard.type(' Additional visual edit.');
 // Desktop formatting uses a contextual text toolbar shared with touch mode.
 await page.keyboard.press('Shift+Home');
 const boldButton=page.getByRole('toolbar',{name:'文本格式'}).getByRole('button',{name:'粗体'});
 await boldButton.waitFor();
 await boldButton.click();
 assert.equal(await boldButton.getAttribute('aria-pressed'),'true','Astryx ToggleButton reflects formatting state');
 await boldButton.click();
 assert.equal(await boldButton.getAttribute('aria-pressed'),'false','formatting can be toggled off');
 await page.getByRole('button',{name:'保存'}).click();
 await page.getByText('R3').waitFor({timeout:15000});
 await page.getByRole('button',{name:'源码'}).click();
 const extended=['# UI e2e','','- [x] Completed','- [ ] Pending','','| Item | Value |','| --- | --- |','| Test | 42 |','','$$x^2+y^2=z^2$$','','~~removed~~ **bold** and `inline`'].join(String.fromCharCode(10));
 await page.locator('.cm-content').fill(extended);
 await page.getByRole('button',{name:'保存'}).click();
 await page.getByText('R4').waitFor({timeout:15000});
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap table').waitFor({timeout:15000});
 await page.locator('.tiptap .katex').first().waitFor({timeout:15000});
 assert.ok(await page.locator('.tiptap input[type=checkbox]').count()>=2,'GFM task lists render');
 await page.getByRole('button',{name:'源码'}).click();
 assert.ok((await page.locator('.cm-content').innerText()).includes('x^2+y^2=z^2'),'source retains math syntax');
 const recUrl=page.url();
 await page.goto(url+'/settings');
 await page.getByRole('heading',{name:'设置',level:1}).waitFor();
 const switchTheme=page.locator('.sidebar-footer').getByRole('button',{name:/主题：/});
 // Each press cycles system -> light -> dark -> system without a theme settings page.
 for(let i=0;i<3;i++)await switchTheme.click();
 assert.ok(['light','dark'].includes(String(await page.locator('html').getAttribute('data-effective-theme'))));
 await page.getByRole('link',{name:'Agent 授权'}).click();
 await page.getByRole('heading',{name:'Agent 授权',level:1}).waitFor();
 await page.getByText('已授权的 Agent').waitFor();
 for(const [path,title] of [['/tasks','任务'],['/search','搜索'],['/activity','活动'],['/settings/sessions','登录会话'],['/settings/oauth','Agent 授权'],['/settings/indexing','索引状态']]){
  await page.goto(url+path);
  await page.getByRole('heading',{name:title,level:1}).waitFor({timeout:16000});
 }
 await page.goto(url+'/');
 await page.getByRole('heading',{name:'概览'}).waitFor();
 await page.locator('.recent-entry[data-activity-seq]').first().waitFor();
 assert.ok((await page.locator('.recent-entry[data-activity-seq]').first().innerText()).includes('本人（Web）'),'activity displays owner');
 await page.goto(url+'/search');
 await page.getByRole('textbox',{name:'搜索关键字'}).fill('UI e2e');
 await page.getByRole('group',{name:'搜索方式'}).getByRole('button',{name:'关键词'}).click();
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
 // One theme control, in the navigation drawer (no duplicate in the top bar).
 assert.equal(await mobilePage.locator('.topbar').getByRole('button',{name:/主题/}).count(),0,'top bar has no duplicate theme toggle');
 await mobilePage.getByRole('button',{name:'打开导航'}).tap();
 await mobilePage.locator('.sidebar.mobile-open').waitFor();
 await mobilePage.locator('.sidebar-footer').getByRole('button',{name:/主题：/}).tap();
 assert.ok(['dark','light'].includes(String(await mobilePage.locator('html').getAttribute('data-effective-theme'))));
 await mobilePage.goto(url+'/settings/oauth');
 await mobilePage.getByRole('heading',{name:'Agent 授权',level:1}).waitFor();
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
 await page.locator('.doc-header').getByRole('heading',{name:'Phase summary'}).waitFor();
 await page.getByRole('button',{name:'信息',exact:true}).click();
 const workbench=page.locator('#document-panel');
 await workbench.locator('.page-properties .tag-editor').getByText('checkpoint',{exact:true}).waitFor();
 await workbench.getByRole('button',{name:'关闭'}).click();
 await page.getByRole('button',{name:'目录',exact:true}).click();
 await page.locator('.outline-item').first().waitFor();
 await page.locator('.outline-item').nth(1).click();
 await page.locator('.cm-content').waitFor();
 assert.ok(page.url().includes('mode=source'),'outline navigation preserves the current source mode');
 assert.equal(faults.length,0,'browser errors: '+faults.join('\n'));
 console.log('PASS browser UI: Cap PoW login, SPA routing, folder/document CRUD, Markdown editor, revision history, desktop+mobile rendering');
}catch(e){console.error('Browser UI E2E failed',e);console.error('page=',page.url());console.error('errors=',faults.slice(0,12));await page.screenshot({path:'tmp/recalloom-failed.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();}
