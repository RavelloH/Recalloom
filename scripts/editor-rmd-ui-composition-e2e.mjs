import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,webkit} from 'playwright-core';

// Run only with run-editor-e2e.mjs: all records belong to its temporary D1.
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&(engine==='webkit'||executablePath));
const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath}:{})});
const artifactDir='output/playwright/rmd-ui-composition/'+engine;
fs.mkdirSync(artifactDir,{recursive:true});
const errors=[];
const fixture=[
 '菜单与撤销测试位置。','',
 '::: details 附加说明','','折叠内容保持 **完整**。','',':::','',
 ':::: flashcard 学习卡','','::: front','','问题 **保持**。','',':::','','::: back','','答案保持。','',':::','','::::','',
 '解释 :: abbr CPU | description="Central Processing Unit" :: 与 :: tooltip DO | description="Durable Objects" ::。','',
 '挖空 :: cloze [链接答案](#cloze-target) | hint="显示答案" ::。','',
 '结束位置。'
].join('\n');
let page;
async function configure(width,touch){
 page=await browser.newPage({viewport:{width,height:900},hasTouch:touch});
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 // A denied browser capability exercises real menu failure feedback.
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
   read:async()=>{throw new DOMException('Permission denied','NotAllowedError');},
   writeText:async()=>{throw new DOMException('Permission denied','NotAllowedError');}
  }});
 });
 // Windows WebKit rejects the secure __Host cookie on loopback HTTP. Forward
 // only this page's normal login result, without exposing it in artifacts.
 let sessionCookie='';
 if(engine==='webkit')await page.route('**/api/**',async route=>{
  const request=route.request();
  if(new URL(request.url()).pathname==='/api/auth/login'){
   const response=await route.fetch();sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
   await route.fulfill({response});return;
  }
  if(sessionCookie){await route.fulfill({response:await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}})});return;}
  await route.continue();
 });
 await page.goto(base+'/login');await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/',{timeout:30000});
 const record=await page.evaluate(async content=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'RMD UI '+Date.now()+'.md',kind:'document',content})});
  return {status:response.status,data:await response.json()};
 },fixture);
 assert.equal(record.status,201);
 await page.goto(base+'/records/'+record.data.id+'?mode=visual');await page.locator('.tiptap').waitFor();
 return record.data.id;
}
async function stored(id){return page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,id);}
async function shot(name){await page.screenshot({path:artifactDir+'/'+name+'.png'});}
async function titleEquals(title,text){
 await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent===text,{selector:'.rk-directive-details .rk-directive-title-hit',text});
 assert.equal(await title.innerText(),text);
}
try{
 for(const [width,touch] of [[1280,false],[390,true],[320,true]]){
  const id=await configure(width,touch);
  const details=page.locator('.tiptap .rk-directive-details');
  const title=details.getByRole('textbox',{name:'容器标题'});
  const body=details.locator('.rk-details-content');
  assert.equal(await details.locator('button [contenteditable]').count(),0,'editable title never nests inside a button');
  await title.fill('编辑后的说明');await title.press('Enter');await titleEquals(title,'编辑后的说明');
  assert.equal(await body.isVisible(),true,'editing the title does not toggle Details');
  await details.getByRole('button',{name:'收起 编辑后的说明',exact:true}).click();
  assert.equal(await body.isVisible(),false);
  assert.equal(await body.locator('[data-node-view-content]').count(),1,'collapsed contentDOM stays mounted');
  assert.equal(await body.locator('strong').innerText(),'完整');
  await details.getByRole('button',{name:'展开 编辑后的说明',exact:true}).click();
  assert.equal(await body.isVisible(),true);
  const card=page.locator('.tiptap .rk-directive-flashcard');
  for(const side of ['front','back']){
   const panel=card.locator('.rk-directive-'+side);
   assert.equal(await panel.getByRole('textbox',{name:'容器标题'}).count(),0,'flashcard role has no editable title');
   assert.equal(await panel.locator('.rk-flashcard-panel-title').innerText(),side==='front'?'问题':'答案');
  }
  await card.getByRole('button',{name:'显示答案',exact:true}).click();
  assert.equal(await card.locator('.rk-flashcard-back').isVisible(),true);
  // Editor hints remain inert document marks rather than library portal roots.
  const editorTip=page.locator('.tiptap .rk-inline-abbr .rk-tooltip-inline');
  assert.equal(await editorTip.getAttribute('data-rk-tooltip'),'Central Processing Unit');
  assert.equal(await page.locator('.tiptap [role="tooltip"]').count(),0,'editor marks never mount library Tooltip UI inside document DOM');
  const editorCloze=page.locator('.tiptap .rk-inline-cloze');
  const editorAnswer=editorCloze.locator('.rk-cloze-editor-answer');
  assert.equal(await editorCloze.locator('button .rk-cloze-editor-answer').count(),0);
  assert.equal(await editorAnswer.count(),1);
  await editorCloze.getByRole('button',{name:'显示挖空答案',exact:true}).click();await editorAnswer.waitFor({state:'visible'});
  await editorCloze.getByRole('button',{name:'隐藏挖空答案',exact:true}).click();await editorAnswer.waitFor({state:'hidden'});
  assert.equal(await editorAnswer.count(),1,'cloze answer contentDOM remains mounted');
  await shot('details-flashcard-'+width);
  if(!touch){
   // Use ProseMirror's real history command rather than native title history.
   const paragraph=page.locator('.tiptap > p').first();
   await paragraph.click({button:'right',position:{x:10,y:8}});
   await page.getByRole('menuitem',{name:'撤销',exact:true}).last().click();await titleEquals(title,'附加说明');
   await paragraph.click({button:'right',position:{x:10,y:8}});
   await page.getByRole('menuitem',{name:'重做',exact:true}).last().click();await titleEquals(title,'编辑后的说明');
   const rect=await paragraph.boundingBox();assert.ok(rect);
   await paragraph.click({button:'right',position:{x:10,y:8}});
   await page.getByRole('menuitem',{name:'粘贴',exact:true}).last().click();
   const toast=page.locator('.astryx-toast').filter({has:page.locator('.rk-editor-context-toast')});await toast.waitFor();
   assert.match(await toast.innerText(),/浏览器无法读取剪贴板/);
   assert.equal(await toast.getAttribute('role'),'status','library Toast retains its live status semantics');
   assert.equal(await page.locator('.rk-editor-context-feedback').count(),0);
   const bounds=await toast.boundingBox();assert.ok(bounds);
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'Toast stays inside viewport');
   assert.ok(Math.abs(bounds.y-(rect.y+26))<60,'Toast stays near its context invocation');
   await shot('context-toast-'+width);
   await toast.getByRole('button',{name:'关闭编辑器提示'}).click();await toast.waitFor({state:'hidden'});
  }
  await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.save-status').getByText('已保存').waitFor();
  const saved=await stored(id);assert.match(saved,/::: details 编辑后的说明/);assert.match(saved,/\*\*完整\*\*/);
  assert.match(saved,/结束位置。$/,'transient trigger tooltips never append text to document content');
  assert.match(saved,/\[链接答案\]\(#cloze-target\)/,'visual save preserves the cloze answer link');
  assert.doesNotMatch(saved,/::: (?:front|back) [^\n]/,'fixed role labels never leak into Markdown titles');
  // Also verify read-only controls against independently stored canonical
  // source, so their interactions cannot hide an authoring roundtrip change.
  const previewContent=fixture;
  const previewRecord=await page.evaluate(async content=>{
   const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Readonly UI '+Date.now()+'.md',kind:'document',content})});
   return {status:response.status,data:await response.json()};
  },previewContent);assert.equal(previewRecord.status,201);
  await page.goto(base+'/records/'+previewRecord.data.id+'?mode=preview');
  const readCloze=page.locator('.markdown-preview .rk-cloze-read');
  await readCloze.getByRole('button',{name:'显示挖空答案：显示答案',exact:true}).click();
  const answerLink=readCloze.getByRole('link',{name:'链接答案'});await answerLink.waitFor();
  assert.equal(await readCloze.locator('button a').count(),0,'read-only cloze links are siblings of the trigger');
  await answerLink.click();assert.equal(await answerLink.isVisible(),true,'following an answer link does not toggle the reveal');
  await readCloze.getByRole('button',{name:'隐藏挖空答案',exact:true}).click();await answerLink.waitFor({state:'hidden'});
  const anchor=page.locator('.markdown-preview .rk-inline-abbr');await anchor.waitFor();
  assert.equal(await anchor.innerText(),'CPU');assert.equal(await anchor.getAttribute('aria-label'),null);
  assert.equal(await anchor.evaluate(el=>getComputedStyle(el,'::after').content),'none','read-only hints use the library layer');
  if(touch)await anchor.tap();else await anchor.hover();
  const tooltip=page.getByRole('tooltip').filter({hasText:'Central Processing Unit'});await tooltip.waitFor();
  assert.equal(await tooltip.getAttribute('id'),await anchor.getAttribute('aria-describedby'));
  const tipBounds=await tooltip.boundingBox();assert.ok(tipBounds);
  assert.ok(tipBounds.x>=-1&&tipBounds.x+tipBounds.width<=width+1,'library Tooltip avoids viewport edges');
  await shot('readonly-tooltip-'+width);
  await page.keyboard.press('Escape');await tooltip.waitFor({state:'hidden'});
  if(!touch){
   await page.mouse.move(0,0);await anchor.focus();await tooltip.waitFor();
   await page.keyboard.press('Escape');await tooltip.waitFor({state:'hidden'});
  }
  assert.equal(await stored(id),saved,'read-only hover/focus/tap never changes stored document');
  assert.equal(await stored(previewRecord.data.id),previewContent,'read-only cloze links and tooltips preserve canonical Markdown');
  await page.goto(base+'/records/'+id+'?mode=visual');await page.locator('.tiptap').waitFor();
  assert.equal(await page.locator('.rk-directive-details .rk-directive-title-hit').innerText(),'编辑后的说明');
  assert.equal(await page.locator('.rk-directive-details strong').innerText(),'完整');
  await page.close();console.log('RMD UI composition passed:',engine,width,touch?'touch':'desktop');
 }
 assert.deepEqual(errors,[]);console.log('RMD UI composition: Details, flashcard, Tooltip and Toast passed.');
}catch(error){
 if(page&&!page.isClosed())await page.screenshot({path:artifactDir+'/failure.png',fullPage:true}).catch(()=>{});
 if(page&&!page.isClosed())console.error('Cloze DOM:',await page.locator('.rk-inline-cloze').evaluateAll(elements=>elements.map(el=>el.outerHTML)));
 console.error('Browser errors:',errors);throw error;
}finally{await browser.close();}
