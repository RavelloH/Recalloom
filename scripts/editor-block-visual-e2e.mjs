import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,webkit} from 'playwright-core';
// Every record belongs to the isolated temporary D1 created by run-editor-e2e.mjs.
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
assert.ok(secret&&(engine==='webkit'||executablePath));
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath}:{})});
let page=await browser.newPage();
const errors=[];
async function configurePage(){
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 // Windows WebKit rejects secure __Host cookies over loopback HTTP. Keep the
 // normal login flow, forwarding only this page's resulting session to its API.
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
}
await configurePage();
const artifactDir='output/playwright/block-visual/'+engine;
fs.mkdirSync(artifactDir,{recursive:true});
const fixture=[
 '正文 **粗体保持** 与 [链接保持](https://example.com/preserved)。 @ attrs visual-body @','',
 ':::: flashcard','','::: front','','正面 **强调**。','',':::','','::: back','','背面不可变。','',':::','','::::','',
 '| 表头一 | 表头二 |','| --- | --- |','| 单元一 | 单元二 |','@ attrs tbl-visual @','',
 '~~~typescript','const value = 1;','~~~','@ attrs code-visual | file=before.ts @','',
 '![原替代文字](/examples/device.svg "原图片标题") @ attrs fig-visual | width=420 | caption=原图注 @','',
 '$$','x^2','$$','@ attrs eq-visual @','','末尾插入位置。'
].join('\n');
const raw=panel=>panel.getByRole('textbox',{name:'块源码',includeHidden:true});
const mode=(panel,name)=>panel.getByRole('tablist',{name:'块编辑模式'}).getByRole('tab',{name:name==='源码'?/^源码/:name,exact:name!=='源码'}).click();
const panelAt=width=>page.getByRole(width===1280?'complementary':'dialog',{name:'块编辑面板'});
const close=async panel=>{await panel.getByRole('button',{name:'关闭',exact:true}).click();await panel.waitFor({state:'hidden'});};
async function badge(kind,width){
 await page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="'+kind+'"]').first().click();
 const panel=panelAt(width);await panel.waitFor();return panel;
}
async function block(target,width){
 await target.hover({position:{x:4,y:4}});
 const grip=page.getByRole('group',{name:'块把手'});await grip.waitFor();
 await grip.getByRole('button',{name:'块操作'}).click();
 await page.getByRole('menuitem',{name:'编辑块'}).last().click();
 const panel=panelAt(width);await panel.waitFor();return panel;
}
async function create(content=fixture){
 const record=await page.evaluate(async content=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Visual blocks '+Date.now()+'.md',kind:'document',content})});
  return {status:response.status,data:await response.json()};
 },content);
 assert.equal(record.status,201);
 await page.waitForLoadState('networkidle');
 await page.goto(base+'/records/'+record.data.id+'?mode=visual');
 await page.locator('.tiptap').waitFor();return record.data.id;
}
async function insert(query){
 await page.locator('.tiptap p').last().click();
 await page.keyboard.press('Control+End');await page.keyboard.press('Enter');
 await page.keyboard.type('/'+query);
 const list=page.getByRole('listbox',{name:'插入内容'});await list.waitFor();
 await list.getByRole('option').first().click();
}
async function screenshot(name){await page.waitForTimeout(500);await page.screenshot({path:artifactDir+'/'+name+'.png'});}
async function choose(panel,label,option){
 const control=panel.getByRole('combobox',{name:label,exact:true});
 assert.equal(await control.evaluate(el=>el.tagName),'BUTTON','selector is an Astryx custom control');
 await control.click();await page.getByRole('option',{name:option,exact:true}).last().click();
}
async function configurationOnly(panel){
 assert.equal(await panel.locator('[contenteditable]').count(),0,'sidebar never creates a second rich text body editor');
 assert.equal(await panel.locator('select').count(),0,'all selectors use library controls');
 const customButtons=await panel.locator('.rk-block-editor-panel button').evaluateAll(elements=>elements.filter(el=>!el.matches('.astryx-button,.astryx-tab,.astryx-tab-scroll-button,.astryx-collapsible-trigger')&&!el.closest('.astryx-selector')).map(el=>el.outerHTML));
 assert.deepEqual(customButtons,[],'configuration action buttons come from Astryx');
 for(const input of await panel.locator('input:not([type=\"checkbox\"])').all())assert.equal(await input.evaluate(el=>Boolean(el.closest('.astryx-text-input'))),true,'text inputs come from Astryx');
 for(const area of await panel.locator('textarea').all())assert.ok((await area.getAttribute('class')??'').includes('astryx-text-area-control'),'text areas come from Astryx');
}
async function waitValue(field,expected){for(let attempt=0;attempt<40;attempt++){if(await field.inputValue()===expected)return;await page.waitForTimeout(50);}assert.equal(await field.inputValue(),expected);}
async function history(key){const target=page.locator('.tiptap p').first();if(key==='Control+Z'||key==='Control+Shift+Z'){await target.click({button:'right',position:{x:4,y:4}});await page.getByRole('menuitem',{name:key==='Control+Z'?'撤销':'重做',exact:true}).last().click();}else{await target.click({position:{x:4,y:4}});await page.keyboard.press(key);}}
async function savedContent(id){return page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,id);}
async function saveReopen(id,expected){
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.save-status').getByText('已保存').waitFor();
 const persisted=await savedContent(id);for(const token of expected)assert.ok(persisted.includes(token),'saved '+token);
 await page.waitForLoadState('networkidle');await page.goto(base+'/records/'+id+'?mode=visual');await page.locator('.tiptap').waitFor();
 return persisted;
}
try{
 await page.goto(base+'/login');await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:engine==='webkit'?1100:width===320?700:900});
  const id=await create();let panel=await badge('paragraph',width);await configurationOnly(panel);
  assert.equal(await raw(panel).isVisible(),false,'source remains an advanced opt-in');
  assert.equal(await panel.getByRole('textbox',{name:'可视化编辑块正文'}).count(),0);
  assert.equal(await panel.locator('textarea:visible').count(),0,'ordinary paragraph settings contain attributes only');
  const anchor=panel.getByRole('textbox',{name:'稳定 ID（可选）'});await anchor.fill('body-config-'+width);
  assert.match(await raw(panel).inputValue(),new RegExp('body-config-'+width));
  if(width===1280){await history('Control+Z');await waitValue(anchor,'visual-body');await history('Control+Shift+Z');await waitValue(anchor,'body-config-'+width);}
  await mode(panel,'源码');const canonical=await raw(panel).inputValue();
  await raw(panel).fill('# 非法的块类型');await panel.locator('textarea[aria-invalid="true"]').waitFor();await mode(panel,'设置');
  assert.equal(await anchor.inputValue(),'body-config-'+width);await mode(panel,'源码');
  assert.equal(await raw(panel).inputValue(),'# 非法的块类型','mode roundtrip preserves invalid source');
  await raw(panel).fill(canonical);await mode(panel,'设置');
  assert.equal(await page.locator('.tiptap strong').filter({hasText:'粗体保持'}).count(),1);
  assert.equal(await page.locator('.tiptap a[href="https://example.com/preserved"]').count(),1);
  await screenshot('paragraph-settings-'+width);await close(panel);
  panel=await badge('codeBlock',width);await configurationOnly(panel);
  await panel.getByRole('textbox',{name:'代码语言',exact:true}).fill('javascript');
  await panel.getByRole('textbox',{name:'代码正文',exact:true}).fill('const configured = '+width+';');
  for(const token of ['code-visual','file=before.ts','const configured'])assert.ok((await raw(panel).inputValue()).includes(token));await close(panel);
  assert.equal(await page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="table"]').count(),1,'editing following code retains table boundary control');
  panel=await badge('image',width);await configurationOnly(panel);
  const address=panel.getByRole('textbox',{name:'图片地址',exact:true});
  if(width===1280){
   await address.fill('javascript:invalid-image');await page.waitForFunction(()=>document.querySelector('.rk-block-settings-fields input[aria-invalid="true"]'));
   await panel.getByRole('textbox',{name:'替代文字',exact:true}).fill('临时替代文字');
   assert.equal(await address.getAttribute('aria-invalid'),'true','invalid URL survives another valid field');
   const element=await address.elementHandle();await history('End');await page.keyboard.type(' BEFORE_IMAGE');
   assert.equal(await address.inputValue(),'javascript:invalid-image');
   assert.equal(await address.evaluate((el,original)=>el===original,element),true,'earlier canvas edit retains invalid field instance');
   const imageSource=await raw(panel).inputValue();await mode(panel,'源码');await raw(panel).fill('# 非法图片源码');
   const sourceElement=await raw(panel).elementHandle();await history('End');await page.keyboard.type(' BEFORE_IMAGE_AGAIN');
   assert.equal(await raw(panel).inputValue(),'# 非法图片源码');
   assert.equal(await raw(panel).evaluate((el,original)=>el===original,sourceElement),true);
   await raw(panel).fill(imageSource);await mode(panel,'设置');
  }
  await address.fill('/examples/device.svg?config='+width);await panel.getByRole('textbox',{name:'替代文字',exact:true}).fill('配置替代文字');
  await panel.getByRole('textbox',{name:'图片标题',exact:true}).fill('配置图片标题');
  for(const token of ['fig-visual','width=420','caption=原图注'])assert.ok((await raw(panel).inputValue()).includes(token));await close(panel);
  await page.locator('.tiptap p').first().click({position:{x:4,y:4}});
  await page.locator('.tiptap [data-rk-equation-id="eq-visual"]').first().click();panel=panelAt(width);await panel.waitFor();await configurationOnly(panel);
  await panel.getByRole('textbox',{name:'LaTeX 公式',exact:true}).fill('y^3+'+width);assert.match(await raw(panel).inputValue(),/eq-visual/);await close(panel);
  await page.locator('.tiptap table td').first().click();await page.getByRole('button',{name:'编辑表格图注与 ID',exact:true}).click();panel=panelAt(width);await panel.waitFor();await configurationOnly(panel);
  assert.equal(await panel.getByRole('button',{name:'添加行',exact:true}).count(),0,'table configuration has no duplicated table editor');
  assert.equal(await panel.locator('table').count(),0);
  const tableId=panel.getByRole('textbox',{name:'稳定 ID（可选）'});await tableId.fill('tbl-config-'+width);
  assert.match(await raw(panel).inputValue(),new RegExp('tbl-config-'+width));
  const geometry=await panel.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
  await screenshot('table-settings-'+width);await close(panel);
  assert.equal(await savedContent(id),fixture,'configuration remains local until Save');
  if(width===1280){
   await saveReopen(id,['**粗体保持**','https://example.com/preserved','body-config-1280','const configured = 1280','配置替代文字','配置图片标题','eq-visual','tbl-config-1280','背面不可变']);
   assert.equal(await page.locator('.tiptap a[href="https://example.com/preserved"]').count(),1);
   assert.match(await page.locator('.tiptap pre').innerText(),/const configured = 1280/);
   assert.equal(await page.locator('.tiptap img[alt="配置替代文字"]').count(),1);
  }
  console.log('PASS typed paragraph/table settings, native object fields, history, source drafts and local persistence',width);
 }
 const structures=[['tabs','tab','标签页'],['chat','message','消息'],['glossary','definition','术语']];
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:engine==='webkit'?1100:900});
  for(const [kind,child,label] of structures){
   const content=['前置正文。','',':::: '+kind,'','::: '+child+' Alpha'+(child==='message'?' | sender=user':''),'','Alpha **bold** body.','',':::','','::: '+child+' Beta'+(child==='message'?' | sender=assistant':''),'','Beta sibling body.','',':::','','::::'].join('\n');
   const id=await create(content);const panel=await block(page.locator('.tiptap .rk-directive-'+kind).first(),width);await configurationOnly(panel);
   const children=()=>page.locator('.tiptap .rk-directive-'+kind+' .rk-directive-'+child);
   await panel.getByRole('button',{name:'添加'+label,exact:true}).click();assert.equal(await children().count(),3);
   if(width===1280){await history('Control+Z');assert.equal(await children().count(),2);await history('Control+Shift+Z');assert.equal(await children().count(),3);}
   await panel.getByRole('textbox',{name:label+' 3 '+(kind==='chat'?'发言人名称':kind==='glossary'?'术语名称':'标题'),exact:true}).fill('Gamma');
   await panel.getByRole('textbox',{name:label+' 3 内容（Markdown）',exact:true}).fill('Gamma **formatted** content.');
   await panel.getByRole('textbox',{name:label+' 1 内容（Markdown）',exact:true}).fill('Alpha **bold** edited body.');
   if(kind==='chat'&&width===1280){
    const typed=panel.getByRole('textbox',{name:'消息 3 内容（Markdown）',exact:true});
    await typed.fill('');await page.waitForTimeout(550);await typed.pressSequentially('**typed**');
    assert.equal(await typed.inputValue(),'**typed**','typing Markdown keeps the exact user draft');
    await children().nth(2).locator('strong').filter({hasText:'typed'}).waitFor();
    await history('Control+Z');assert.notEqual(await typed.inputValue(),'**typed**','parent Undo updates the configuration field');
    await history('Control+Shift+Z');await waitValue(typed,'**typed**');
    await panel.getByRole('textbox',{name:'消息 2 发言人名称',exact:true}).fill('Beta before draft');
    assert.equal(await typed.inputValue(),'**typed**','sibling rename retains exact valid Markdown draft');
    await panel.getByRole('button',{name:'消息 3 上移',exact:true}).click();
    assert.equal(await panel.getByRole('textbox',{name:'消息 2 内容（Markdown）',exact:true}).inputValue(),'**typed**','valid draft follows card reorder');
    await panel.getByRole('button',{name:'消息 2 下移',exact:true}).click();
   }
   if(kind==='chat'){
    await choose(panel,'消息 1 身份','系统');
    const invalid='::: tab 孤立\n\n正文\n\n:::';
    const body=panel.getByRole('textbox',{name:'消息 1 内容（Markdown）',exact:true});await body.fill(invalid);
    assert.equal(await body.getAttribute('aria-invalid'),'true');
    await panel.getByRole('textbox',{name:'消息 2 发言人名称',exact:true}).fill('Beta renamed');
    assert.equal(await body.inputValue(),invalid,'invalid content draft survives sibling name change');
    await panel.getByRole('button',{name:'消息 1 下移',exact:true}).click();
    const movedBody=panel.getByRole('textbox',{name:'消息 2 内容（Markdown）',exact:true});assert.equal(await movedBody.inputValue(),invalid,'invalid draft follows card reorder');
    await movedBody.fill('Alpha **bold** edited body.');
    await panel.getByRole('button',{name:'消息 2 上移',exact:true}).click();
   }
   await panel.getByRole('button',{name:label+' 1 下移',exact:true}).click();
   assert.match(await children().nth(0).innerText(),/Beta sibling body/);assert.match(await children().nth(1).innerText(),/Alpha/);
   await panel.getByRole('button',{name:label+' 3 删除',exact:true}).click();assert.equal(await children().count(),2);
   assert.match(await raw(panel).inputValue(),/Alpha \*\*bold\*\* edited body/);assert.match(await raw(panel).inputValue(),/Beta sibling body/);
   if(kind==='chat')assert.match(await raw(panel).inputValue(),/sender=system/);
   await screenshot(kind+'-settings-'+width);await close(panel);
   assert.equal(await savedContent(id),content);
   if(width===1280){await saveReopen(id,['Alpha **bold** edited body','Beta sibling body',...(kind==='chat'?['sender=system']:[])]);assert.equal(await children().count(),2);}
   console.log('PASS typed child names, roles, content, add, reorder, removal, history and save',kind,width);
  }
  const id=await create();const panel=await block(page.locator('.tiptap .rk-directive-flashcard').first(),width);await configurationOnly(panel);
  await panel.getByRole('textbox',{name:'闪卡正面 内容（Markdown）',exact:true}).fill('正面 **强调** 配置 '+width+'。');
  assert.match(await page.locator('.tiptap .rk-directive-front').innerText(),new RegExp('配置 '+width));
  assert.match(await page.locator('.tiptap .rk-directive-back').innerText(),/背面不可变/);
  await panel.getByRole('textbox',{name:'闪卡背面 内容（Markdown）',exact:true}).fill('背面配置 '+width+'。');
  assert.equal(await page.locator('.tiptap .rk-directive-front strong').innerText(),'强调');await close(panel);
  if(width===1280)await saveReopen(id,['正面 **强调** 配置 1280','背面配置 1280']);
  console.log('PASS paired flashcard typed content preserves the other side',width);
 }
 await page.setViewportSize({width:1280,height:engine==='webkit'?1100:900});await create();
 await page.locator('.tiptap a[href="https://example.com/preserved"]').click({button:'right'});await page.getByRole('menuitem',{name:'编辑链接',exact:true}).click();
 let panel=panelAt(1280);await panel.waitFor();await configurationOnly(panel);await panel.getByRole('textbox',{name:'链接地址'}).fill('https://example.com/cancelled');
 assert.equal(await page.locator('.tiptap a[href="https://example.com/preserved"]').count(),1);await panel.getByRole('button',{name:'取消',exact:true}).click();await panel.waitFor({state:'hidden'});
 assert.equal(await page.locator('.tiptap a[href="https://example.com/cancelled"]').count(),0);
 for(const query of ['图片','块级公式']){
  await insert(query);panel=panelAt(1280);await panel.waitFor();await configurationOnly(panel);
  if(query==='图片'){await panel.getByRole('textbox',{name:'图片地址',exact:true}).fill('/examples/device.svg?inserted');await panel.getByRole('textbox',{name:'替代文本（Alt）'}).fill('插入的图片');}
  else await panel.getByRole('textbox',{name:'LaTeX 公式'}).fill('z^4');
  await panel.getByRole('button',{name:'插入',exact:true}).click();await panel.waitFor({state:'hidden'});
 }
 assert.equal(await page.locator('.tiptap img[src="/examples/device.svg?inserted"]').count(),1);assert.equal(await page.locator('.tiptap [data-type="block-math"][data-latex="z^4"]').count(),1);
 const nestedFixture=['前置正文。','','::: warning Nested','','| H1 | H2 |','| --- | --- |','| A | B |','','~~~js','const nested = 1;','~~~','','![Nested image](/examples/device.svg)','','Nested formula $n+1$.','',':::'].join('\n');await create(nestedFixture);
 for(const [selector,kind] of [['table td','table'],['pre code','codeBlock'],['img','image']]){
  await page.locator('.tiptap .rk-directive-warning '+selector).first().click({button:'right'});await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();panel=panelAt(1280);await panel.waitFor();await configurationOnly(panel);
  assert.equal(await panel.locator('.rk-block-editor-panel').getAttribute('data-block-kind'),kind);
  if(kind==='codeBlock')await panel.getByRole('textbox',{name:'代码正文'}).fill('const nested = 2;');
  if(kind==='image')await panel.getByRole('textbox',{name:'替代文字'}).fill('Nested edited');await close(panel);
 }
 await page.locator('.tiptap p').first().click({position:{x:4,y:4}});
 await page.locator('.tiptap .rk-directive-warning [data-type="inline-math"] .katex-html').click();panel=panelAt(1280);await panel.waitFor();
 await panel.getByRole('textbox',{name:'LaTeX 公式'}).fill('n+2');const inlineSource=await raw(panel).inputValue();
 await mode(panel,'源码');await raw(panel).fill('$unclosed');await panel.locator('textarea[aria-invalid="true"]').waitFor();await mode(panel,'设置');
 const type=panel.getByRole('combobox',{name:'公式类型',exact:true});if(!await type.isDisabled())await choose(panel,'公式类型','块级公式 $$…$$');
 assert.equal(await page.locator('.tiptap .rk-directive-warning [data-type="inline-math"]').count(),1);
 await mode(panel,'源码');assert.equal(await raw(panel).inputValue(),'$unclosed');await raw(panel).fill(inlineSource);await mode(panel,'设置');
 await choose(panel,'公式类型','块级公式 $$…$$');await page.locator('.tiptap .rk-directive-warning [data-type="block-math"][data-latex="n+2"]').waitFor();await close(panel);
 await history('Control+Z');await page.locator('.tiptap .rk-directive-warning [data-type="inline-math"][data-latex="n+2"]').waitFor();
 await history('Control+Shift+Z');await page.locator('.tiptap .rk-directive-warning [data-type="block-math"][data-latex="n+2"]').waitFor();
 await page.locator('.tiptap .rk-directive-warning [data-type="block-math"]').click();await panelAt(1280).getByRole('button',{name:'删除数学公式',exact:true}).click();
 assert.equal(await page.locator('.tiptap .rk-directive-warning [data-type="block-math"]').count(),0);await history('Control+Z');await page.locator('.tiptap .rk-directive-warning [data-type="block-math"]').waitFor();
 await page.locator('.tiptap .rk-directive-warning img').click({button:'right'});await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();await panelAt(1280).getByRole('button',{name:'删除图片',exact:true}).click();
 assert.equal(await page.locator('.tiptap .rk-directive-warning img').count(),0);assert.equal(await page.locator('.tiptap .rk-directive-warning table').count(),1);assert.match(await page.locator('.tiptap .rk-directive-warning pre').innerText(),/const nested = 2/);
 await history('Control+Z');await page.locator('.tiptap .rk-directive-warning img').waitFor();console.log('PASS staged library insert forms and exact nested object conversion/deletion with history');
 await create('Intro.\n\n## Editable heading @ attrs heading-config @\n\n3. **Alpha** list item\n4. Beta list item');
 await page.locator('.tiptap h2').click({button:'right'});await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();panel=panelAt(1280);await configurationOnly(panel);
 await choose(panel,'标题级别','3 级标题');await page.locator('.tiptap h3').waitFor();assert.match(await raw(panel).inputValue(),/heading-config/);await close(panel);
 await page.locator('.tiptap ol li p').first().click({button:'right'});await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();panel=panelAt(1280);await configurationOnly(panel);
 await panel.getByRole('textbox',{name:'起始编号',exact:true}).fill('7');assert.equal(await page.locator('.tiptap ol').getAttribute('start'),'7');assert.equal(await page.locator('.tiptap ol strong').innerText(),'Alpha');await close(panel);
 console.log('PASS heading selector and ordered-list parameters preserve formatted canvas content');
 await page.unrouteAll({behavior:'wait'});await page.close();page=await browser.newPage({viewport:{width:390,height:engine==='webkit'?1100:900},isMobile:true,hasTouch:true});await configurePage();
 await page.goto(base+'/login');await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [390,320]){
  await page.emulateMedia({colorScheme:width===320?'dark':'light'});await page.setViewportSize({width,height:engine==='webkit'?1100:900});await create();await page.locator('.tiptap p').first().tap();await page.getByRole('button',{name:'编辑当前块',exact:true}).click();
  const touchPanel=panelAt(width);await touchPanel.waitFor();await configurationOnly(touchPanel);await touchPanel.getByRole('textbox',{name:'稳定 ID（可选）'}).fill('touch-config-'+width);assert.match(await raw(touchPanel).inputValue(),new RegExp('touch-config-'+width));
  await screenshot('touch-settings-'+width);await close(touchPanel);console.log('PASS real touch attribute-only sidebar',width);
 }
 assert.deepEqual(errors,[]);console.log('PASS configuration-only sidebar has no contenteditable or native selectors');
}catch(error){
 console.error('Browser errors:',errors);if(await page.getByRole('button',{name:'Show Error',exact:true}).count()){await page.getByRole('button',{name:'Show Error',exact:true}).click();console.error('App boundary:',await page.locator('body').innerText());}
 await page.screenshot({path:artifactDir+'/failure.png',fullPage:true}).catch(()=>{});console.error('Canonical configuration state:',await page.locator('.rk-block-editor-panel textarea').evaluateAll(elements=>elements.map(el=>({label:el.getAttribute('aria-label'),value:el.value}))).catch(()=>[]));console.error('Block configuration failure state:',await page.locator('#block-editor').innerText().catch(()=>'(panel closed)'));throw error;
}finally{await page.unrouteAll({behavior:'wait'}).catch(()=>{});await browser.close();}
