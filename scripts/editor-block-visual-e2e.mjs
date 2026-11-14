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
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:engine==='webkit'?1100:width===320?700:900});
  const id=await create();
  let panel=await badge('paragraph',width);
  const body=panel.getByRole('textbox',{name:'可视化编辑块正文'});
  await body.waitFor();
  assert.equal(await raw(panel).isVisible(),false,'source is an advanced opt-in');
  await body.click();await page.keyboard.press('Control+End');await page.keyboard.type(' VISUAL_'+width);
  await page.locator('.tiptap').getByText('VISUAL_'+width,{exact:false}).waitFor();
  assert.equal(await page.locator('.tiptap strong').filter({hasText:'粗体保持'}).count(),1);
  assert.equal(await page.locator('.tiptap a[href="https://example.com/preserved"]').count(),1);
  assert.equal(await panel.getByRole('textbox',{name:'稳定 ID（可选）'}).inputValue(),'visual-body');
  await body.press('Control+Z');
  await page.waitForFunction(()=>!document.querySelector('.tiptap')?.textContent.includes('VISUAL_'));
  assert.doesNotMatch(await body.innerText(),/VISUAL_/);
  await body.press('Control+Shift+Z');
  await page.locator('.tiptap').getByText('VISUAL_'+width,{exact:false}).waitFor();
  await mode(panel,'源码');
  const canonical=await raw(panel).inputValue();
  assert.match(canonical,/\*\*粗体保持\*\*/);assert.match(canonical,/visual-body/);
  await raw(panel).fill('# 非法的块类型');await panel.getByRole('alert').waitFor();
  await mode(panel,'可视化');
  assert.match(await body.innerText(),new RegExp('VISUAL_'+width));
  await mode(panel,'源码');
  assert.equal(await raw(panel).inputValue(),'# 非法的块类型','mode roundtrip retains invalid source draft');
  await raw(panel).fill(canonical);await mode(panel,'可视化');
  const overflow=await panel.evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth}));
  assert.ok(overflow.scroll<=overflow.width+1,'panel has no horizontal overflow '+JSON.stringify(overflow));
  await page.screenshot({path:artifactDir+'/body-'+width+'.png',fullPage:false});
  await close(panel);
  panel=await block(page.locator('.tiptap .rk-directive-front').first(),width);
  const front=panel.getByRole('textbox',{name:'可视化编辑块正文'});
  await front.click();await front.press('Control+End');await page.keyboard.type(' FRONT_'+width);
  await page.locator('.tiptap .rk-directive-front').getByText('FRONT_'+width,{exact:false}).waitFor();
  assert.match(await page.locator('.tiptap .rk-directive-back').innerText(),/背面不可变。/);
  assert.equal(await page.locator('.tiptap .rk-directive-front strong').innerText(),'强调');
  await close(panel);
  panel=await badge('codeBlock',width);
  await panel.getByRole('textbox',{name:'代码语言'}).fill('javascript');
  await panel.getByRole('textbox',{name:'代码正文'}).fill('const updated = '+width+';');
  assert.match(await raw(panel).inputValue(),/const updated/);
  assert.match(await raw(panel).inputValue(),/code-visual/);assert.match(await raw(panel).inputValue(),/file=before.ts/);
  await close(panel);
  assert.equal(await page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="table"]').count(),1,'editing following code retains table boundary attribute control');
  panel=await badge('image',width);
  if(width===1280){
   const address=panel.getByRole('textbox',{name:'图片地址',exact:true});
   await address.fill('javascript:invalid-image');await panel.getByRole('alert').waitFor();
   await panel.getByRole('textbox',{name:'替代文字'}).fill('临时替代文字');
   await panel.getByRole('alert').waitFor();
   assert.equal(await address.getAttribute('aria-invalid'),'true','URL error persists after valid sibling edit');
   assert.equal(await address.inputValue(),'javascript:invalid-image');
   const addressHandle=await address.elementHandle();
   const canvasFirst=page.locator('.tiptap p').first();
   await canvasFirst.click();await page.keyboard.press('End');await page.keyboard.type(' BEFORE_IMAGE');
   assert.equal(await address.inputValue(),'javascript:invalid-image','unrelated earlier edits retain invalid field draft');
   assert.equal(await address.evaluate((element,original)=>element===original,addressHandle),true,'position mapping keeps the native field instance');
   const canonicalImage=await raw(panel).inputValue();await mode(panel,'源码');
   await raw(panel).fill('# 非法图片源码');
   const sourceHandle=await raw(panel).elementHandle();
   await canvasFirst.click();await page.keyboard.press('End');await page.keyboard.type(' BEFORE_IMAGE_AGAIN');
   assert.equal(await raw(panel).inputValue(),'# 非法图片源码','earlier insertion retains invalid raw draft');
   assert.equal(await raw(panel).evaluate((element,original)=>element===original,sourceHandle),true,'position mapping keeps source input instance');
   await raw(panel).fill(canonicalImage);await mode(panel,'可视化');
  }
  await panel.getByRole('textbox',{name:'图片地址',exact:true}).fill('/examples/device.svg?visual='+width);
  await panel.getByRole('textbox',{name:'替代文字'}).fill('更新替代文字');
  for(const preserved of ['fig-visual','width=420','caption=原图注'])assert.ok((await raw(panel).inputValue()).includes(preserved));
  await close(panel);
  await page.locator('.tiptap [data-rk-equation-id="eq-visual"]').first().click();
  panel=panelAt(width);await panel.waitFor();
  assert.equal(await panel.locator('.rk-block-editor-panel').getAttribute('data-block-kind'),'blockMath','actual formula click uses unified panel');
  await panel.getByRole('textbox',{name:'LaTeX 公式'}).fill('y^3+'+width);
  assert.match(await raw(panel).inputValue(),/y\^3/);assert.match(await raw(panel).inputValue(),/eq-visual/);
  await close(panel);
  await page.locator('.tiptap table td').first().click();
  await page.getByRole('button',{name:'编辑表格图注与 ID',exact:true}).click();
  panel=panelAt(width);await panel.waitFor();
  const localTable=panel.getByRole('textbox',{name:'可视化编辑块正文'}).locator('table');
  await localTable.locator('td').first().click();await page.keyboard.press('Home');await page.keyboard.type('改');
  assert.match(await page.locator('.tiptap table td').first().innerText(),/改单元一/);
  const rows=await localTable.locator('tr').count();await panel.getByRole('button',{name:'添加行',exact:true}).click();
  assert.equal(await localTable.locator('tr').count(),rows+1);
  const cols=await localTable.locator('tr').first().locator('th,td').count();await panel.getByRole('button',{name:'添加列',exact:true}).click();
  assert.equal(await localTable.locator('tr').first().locator('th,td').count(),cols+1);
  assert.match(await raw(panel).inputValue(),/tbl-visual/);
  await page.screenshot({path:artifactDir+'/table-'+width+'.png',fullPage:false});
  await close(panel);
  const saved=await page.evaluate(async id=>(await (await fetch('/api/records/'+id)).json()).content,id);
  assert.equal(saved,fixture,'all edits remain local until Save');
  await page.getByRole('button',{name:'源码',exact:true}).click();
  const source=await page.locator('.cm-content').innerText();
  for(const expected of ['VISUAL_'+width,'FRONT_'+width,'背面不可变','const updated = '+width,'fig-visual','eq-visual','tbl-visual'])assert.ok(source.includes(expected),expected+' roundtrips');
  if(width===1280){
   await page.getByRole('button',{name:'保存',exact:true}).click();
   await page.locator('.save-status').getByText('已保存').waitFor();
   const persisted=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,id);
   for(const expected of ['**粗体保持**','https://example.com/preserved','VISUAL_1280','FRONT_1280','背面不可变','const updated = 1280','fig-visual','eq-visual','tbl-visual'])assert.ok(persisted.includes(expected),'saved '+expected);
   await page.waitForLoadState('networkidle');await page.goto(base+'/records/'+id+'?mode=visual');
   await page.locator('.tiptap strong').filter({hasText:'粗体保持'}).waitFor();
   assert.equal(await page.locator('.tiptap a[href="https://example.com/preserved"]').count(),1);
   assert.match(await page.locator('.tiptap pre').innerText(),/const updated = 1280/);
   assert.equal(await page.locator('.tiptap img[alt="更新替代文字"]').count(),1);
   assert.equal(await page.locator('.tiptap [data-rk-equation-id="eq-visual"]').count(),1);
   assert.match(await page.locator('.tiptap table td').first().innerText(),/改单元一/);
   console.log('PASS explicit Save and fresh document reopen preserve marks, IDs and all edited structures');
  }
  console.log('PASS visual block editing, history, invalid draft, nested sibling and structure fields',width);
 }
 const structures=[['tabs','tab','标签页'],['chat','message','消息'],['glossary','definition','术语']];
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:engine==='webkit'?1100:900});
  for(const [kind,child,label] of structures){
   const content=['前置正文。','',':::: '+kind,'','::: '+child+' Alpha'+(child==='message'?' | sender=user':''),'','Alpha **bold** body.','',':::','','::: '+child+' Beta'+(child==='message'?' | sender=assistant':''),'','Beta sibling body.','',':::','','::::'].join('\n');
   await create(content);
   const panel=await block(page.locator('.tiptap .rk-directive-'+kind).first(),width);
   const children=()=>page.locator('.tiptap .rk-directive-'+kind+' .rk-directive-'+child);
   assert.equal(await children().count(),2);
   await panel.getByRole('button',{name:'添加'+label,exact:true}).click();
   assert.equal(await children().count(),3);
   const editor=panel.getByRole('textbox',{name:'可视化编辑块正文'});
   await editor.press('Control+Z');assert.equal(await children().count(),2,'structural add enters parent Undo');
   await editor.press('Control+Shift+Z');assert.equal(await children().count(),3,'Redo refreshes structural controls');
   await panel.getByRole('textbox',{name:label+' 3 标题',exact:true}).fill('Gamma');
   assert.match(await children().nth(2).innerText(),/Gamma/);
   await panel.getByRole('button',{name:label+' 1 下移',exact:true}).click();
   assert.match(await children().nth(0).innerText(),/Beta sibling body/);
   assert.match(await children().nth(1).innerText(),/Alpha/);
   await panel.getByRole('button',{name:'删除'+label+' 3',exact:true}).click();assert.equal(await children().count(),2);
   if(kind==='chat'){
    await panel.getByRole('combobox',{name:'消息 1 身份',exact:true}).selectOption('system');
    assert.match(await raw(panel).inputValue(),/sender=system/);
   }
   assert.equal(await page.locator('.tiptap .rk-directive-'+child+' strong').first().innerText(),'bold','nested formatting preserved after structural changes');
   assert.match(await raw(panel).inputValue(),/Beta sibling body/);
   await close(panel);
   console.log('PASS structured child add, parent history, rename, reorder, remove and sibling preservation',kind,width);
  }
 }
 await page.setViewportSize({width:1280,height:engine==='webkit'?1100:900});await create();
 await page.locator('.tiptap a[href="https://example.com/preserved"]').click({button:'right'});
 await page.getByRole('menuitem',{name:'编辑链接',exact:true}).click();
 let panel=panelAt(1280);await panel.waitFor();
 await panel.getByRole('textbox',{name:'链接地址'}).fill('https://example.com/cancelled');
 assert.equal(await page.locator('.tiptap a[href="https://example.com/preserved"]').count(),1,'link draft stays staged');
 await panel.getByRole('button',{name:'取消',exact:true}).click();await panel.waitFor({state:'hidden'});
 assert.equal(await page.locator('.tiptap a[href="https://example.com/cancelled"]').count(),0);
 for(const query of ['图片','块级公式']){
  await insert(query);panel=panelAt(1280);await panel.waitFor();
  if(query==='图片'){
   await panel.getByRole('textbox',{name:'图片地址',exact:true}).fill('/examples/device.svg?inserted');
   await panel.getByRole('textbox',{name:'替代文本（Alt）'}).fill('插入的图片');
  }else await panel.getByRole('textbox',{name:'LaTeX 公式'}).fill('z^4');
  await panel.getByRole('button',{name:'插入',exact:true}).click();await panel.waitFor({state:'hidden'});
 }
 assert.equal(await page.locator('.tiptap img[src="/examples/device.svg?inserted"]').count(),1);
 const tables=await page.locator('.tiptap table').count();await insert('表格');assert.equal(await page.locator('.tiptap table').count(),tables+1);
 await insert('代码块');await page.keyboard.type('INSERTED_CODE_BODY');
 assert.ok((await page.locator('.tiptap pre').allTextContents()).some(text=>text.includes('INSERTED_CODE_BODY')));
 assert.equal(await page.locator('.tiptap [data-type="block-math"][data-latex="z^4"]').count(),1,'inserted formula has canonical LaTeX');
 const nestedFixture=['前置正文。','','::: warning Nested','','| H1 | H2 |','| --- | --- |','| A | B |','','~~~js','const nested = 1;','~~~','','![Nested image](/examples/device.svg)','','Nested formula $n+1$.','',':::'].join('\n');
 await create(nestedFixture);
 for(const [selector,kind] of [['table td','table'],['pre code','codeBlock'],['img','image']]){
  await page.locator('.tiptap .rk-directive-warning '+selector).first().click({button:'right'});
  await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();
  const nestedPanel=panelAt(1280);await nestedPanel.waitFor();
  assert.equal(await nestedPanel.locator('.rk-block-editor-panel').getAttribute('data-block-kind'),kind,'nested context inspects exact leaf');
  if(kind==='codeBlock')await nestedPanel.getByRole('textbox',{name:'代码正文'}).fill('const nested = 2;');
  if(kind==='image')await nestedPanel.getByRole('textbox',{name:'替代文字'}).fill('Nested edited');
  if(kind==='table'){
   await nestedPanel.getByRole('textbox',{name:'可视化编辑块正文'}).locator('td').first().click();
   await page.keyboard.type('EDIT');
  }
  await close(nestedPanel);
  assert.equal(await page.locator('.tiptap .rk-directive-warning').count(),1,'nested edit preserves callout parent');
 }
 const atomPanel=await block(page.locator('.tiptap .rk-directive-warning').first(),1280);
 await atomPanel.getByRole('button',{name:'编辑公式',exact:true}).click();
 await panelAt(1280).locator('.rk-block-editor-panel[data-block-kind="inlineMath"]').waitFor();
 await panelAt(1280).getByRole('textbox',{name:'LaTeX 公式'}).fill('n+2');
 assert.match(await raw(panelAt(1280)).inputValue(),/n\+2/);
 const typeControl=panelAt(1280).getByRole('combobox',{name:'公式类型',exact:true});
 const validInlineSource=await raw(panelAt(1280)).inputValue();
 await mode(panelAt(1280),'源码');await raw(panelAt(1280)).fill('$unclosed');
 await panelAt(1280).getByRole('alert').waitFor();await mode(panelAt(1280),'可视化');
 if(!await typeControl.isDisabled())await typeControl.selectOption('block');
 assert.equal(await page.locator('.tiptap .rk-directive-warning [data-type="inline-math"]').count(),1,'invalid source blocks a destructive mode conversion');
 await mode(panelAt(1280),'源码');assert.equal(await raw(panelAt(1280)).inputValue(),'$unclosed');
 await raw(panelAt(1280)).fill(validInlineSource);await mode(panelAt(1280),'可视化');
 await panelAt(1280).getByRole('combobox',{name:'公式类型',exact:true}).selectOption('block');
 await page.locator('.tiptap .rk-directive-warning [data-type="block-math"][data-latex="n+2"]').waitFor();
 assert.match(await page.locator('.tiptap .rk-directive-warning').innerText(),/Nested formula/);
 await close(panelAt(1280));
 const surrounding=page.locator('.tiptap .rk-directive-warning p').filter({hasText:'Nested formula'}).first();
 await surrounding.click();await page.keyboard.press('Control+Z');
 await page.locator('.tiptap .rk-directive-warning [data-type="inline-math"][data-latex="n+2"]').waitFor();
 await page.keyboard.press('Control+Shift+Z');
 await page.locator('.tiptap .rk-directive-warning [data-type="block-math"][data-latex="n+2"]').waitFor();
 await page.locator('.tiptap .rk-directive-warning [data-type="block-math"]').click();
 await panelAt(1280).getByRole('button',{name:'删除数学公式',exact:true}).click();
 assert.equal(await page.locator('.tiptap .rk-directive-warning [data-type="block-math"]').count(),0);
 await page.keyboard.press('Control+Z');
 await page.locator('.tiptap .rk-directive-warning [data-type="block-math"][data-latex="n+2"]').waitFor();
 await page.locator('.tiptap .rk-directive-warning img').click({button:'right'});
 await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();
 await panelAt(1280).getByRole('button',{name:'删除图片',exact:true}).click();
 assert.equal(await page.locator('.tiptap .rk-directive-warning img').count(),0);
 assert.equal(await page.locator('.tiptap .rk-directive-warning').count(),1,'image removal preserves its callout');
 assert.equal(await page.locator('.tiptap .rk-directive-warning table').count(),1,'image removal preserves table sibling');
 assert.match(await page.locator('.tiptap .rk-directive-warning pre').innerText(),/const nested = 2/);
 await page.keyboard.press('Control+Z');await page.locator('.tiptap .rk-directive-warning img').waitFor();
 console.log('PASS math conversion and exact nested image/math deletion with Undo preserve surrounding content');
 console.log('PASS nested table/code/image context resolves actual node');
 await create('Intro.\n\n## Editable heading @ attrs heading-visual @\n\n3. **Alpha** list item\n4. Beta list item');
 await page.locator('.tiptap h2').click({button:'right'});
 await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();
 await panelAt(1280).getByRole('combobox',{name:'标题级别',exact:true}).selectOption('3');
 await page.locator('.tiptap h3').waitFor();assert.match(await raw(panelAt(1280)).inputValue(),/heading-visual/);
 await close(panelAt(1280));
 await page.locator('.tiptap ol li p').first().click({button:'right'});
 await page.getByRole('menuitem',{name:'编辑块',exact:true}).click();
 await panelAt(1280).getByRole('textbox',{name:'起始编号',exact:true}).fill('7');
 assert.equal(await page.locator('.tiptap ol').getAttribute('start'),'7');
 assert.equal(await page.locator('.tiptap ol strong').innerText(),'Alpha');
 await close(panelAt(1280));
 console.log('PASS heading level and ordered list start retain identity and formatted body');
 await page.close();
 page=await browser.newPage({viewport:{width:390,height:engine==='webkit'?1100:900},isMobile:true,hasTouch:true});
 await configurePage();
 await page.goto(base+'/login');await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [390,320]){
  await page.emulateMedia({colorScheme:width===320?'dark':'light'});
  await page.setViewportSize({width,height:engine==='webkit'?1100:900});await create();
  await page.locator('.tiptap p').first().tap();
  await page.getByRole('button',{name:'编辑当前块',exact:true}).click();
  const touchPanel=panelAt(width);await touchPanel.waitFor();
  assert.equal(await touchPanel.locator('.rk-block-editor-panel').getAttribute('data-block-kind'),'paragraph');
  const body=touchPanel.getByRole('textbox',{name:'可视化编辑块正文'});
  await body.click();await body.press('Control+End');await page.keyboard.type(' TOUCH_'+width);
  assert.match(await raw(touchPanel).inputValue(),new RegExp('TOUCH_'+width));
  await page.screenshot({path:artifactDir+'/touch-'+width+'.png'});await close(touchPanel);
  console.log('PASS real touch ordinary paragraph current-block entry',width);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS unified insertion panel, staged link cancellation, table/code/image/math insertion');
}catch(error){
 await page.screenshot({path:artifactDir+'/failure.png',fullPage:true}).catch(()=>{});
 console.error('Block visual failure state:',await page.locator('#block-editor').innerText().catch(()=>'(panel closed)'));
 throw error;
}finally{await browser.close();}
