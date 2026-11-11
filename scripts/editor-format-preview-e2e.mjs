import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const bin=[process.env.RECALLOOM_BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(v=>v&&existsSync(v));
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(v=>/^\s*MCP_AUTH_SECRET\s*=/.test(v));
const secret=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(bin&&secret);assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const browser=await chromium.launch({headless:true,executablePath:bin});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.setDefaultTimeout(22000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const content='Hover preview target and friends.\n\nA separate paragraph.';
const getRecord=async id=>page.evaluate(async id=>{
 const response=await fetch('/api/records/'+id);
 if(!response.ok)throw Error('read failed '+response.status);
 return response.json();
},id);
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const record=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Hover QA',kind:'document',content})});
  if(!r.ok)throw Error(await r.text());
  return r.json();
 },content);
 await page.goto(base+'/records/'+record.id+'?mode=visual');
 const para=page.locator('.tiptap p').filter({hasText:'Hover preview target'}).first();
 const bubble=page.getByRole('toolbar',{name:'文本格式'});
 for(let retry=0;retry<3;retry++){
  await para.click();
  await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
  try{await bubble.waitFor({timeout:3500});break;}
  catch(err){if(retry===2)throw err;}
 }
 const format=selector=>page.locator('.tiptap '+selector);
 const clean=async()=>assert.equal((await getRecord(record.id)).content,content,'Hover preview must not persist Markdown');
 const saved=async()=>assert.ok((await page.locator('.save-status').innerText()).includes('已保存'),'Hover must not mark draft dirty');
 const hover=async (name,selector)=>{
  await bubble.getByRole('button',{name,exact:true}).hover();
  await format(selector).first().waitFor();
  await clean();await saved();
 };
 await hover('粗体','.rk-hover-format--bold');
 const boldEffect=await format('.rk-hover-format--bold').first().evaluate(el=>({animation:getComputedStyle(el).animationName,weight:getComputedStyle(el).fontWeight}));
 assert.ok(boldEffect.animation.includes('rk-format-preview-breathe'));
 assert.ok(Number(boldEffect.weight)>=600);
 await hover('斜体','.rk-hover-format--italic');
 assert.equal(await format('.rk-hover-format--bold').count(),0,'Old hover must clear');
 await hover('删除线','.rk-hover-format--strike');
 await hover('下划线','.rk-hover-format--underline');
 await hover('高亮','.rk-hover-format--mark');
 await hover('引用','.rk-hover-format--blockquote');
 await hover('行内代码','.rk-hover-format--code');
 assert.equal(await format('strong').count(),0,'Preview must not turn text into strong');
 console.log('PASS bold/italic/strike/underline/highlight previews animate without changing Markdown');

 await bubble.getByRole('button',{name:'标题'}).hover();
 const menu=page.getByRole('menu',{name:'标题'});
 await menu.waitFor();
 const headingTrigger=bubble.getByRole('button',{name:'标题'});
 assert.equal(await headingTrigger.getAttribute('aria-describedby'),null,
  'Dropdown trigger must not attach a competing hover tooltip');
 await page.waitForTimeout(850);
 assert.equal(await page.getByRole('tooltip').count(),0,
  'Dropdown menu should be the only hover overlay, without a separate tooltip');
 await menu.getByRole('menuitem',{name:'2 级标题'}).hover();
 await format('.rk-hover-format--heading[data-rk-preview-level="2"]').first().waitFor();
 assert.equal(await page.locator('.tiptap h2').count(),0,'Heading hover never converts node type');
 await menu.getByRole('menuitem',{name:'3 级标题'}).hover();
 await format('.rk-hover-format--heading[data-rk-preview-level="3"]').first().waitFor();
 await clean();
 console.log('PASS heading H2/H3 preview is block decoration and never writes');

 const headingMenu=page.locator('.rk-inline-popover[data-state="open"]');
 await bubble.getByRole('button',{name:'列表'}).hover();
 const listMenu=page.getByRole('menu',{name:'列表'});
 await listMenu.waitFor();
 await page.locator('.rk-inline-popover[data-state="closing"]').waitFor();
 const crossfade=await page.locator('.rk-inline-popover').evaluateAll(menus=>menus.map(el=>({
  name:el.getAttribute('aria-label'),state:el.dataset.state,
  animation:getComputedStyle(el).animationName,
  pointer:getComputedStyle(el).pointerEvents
 })));
 assert.ok(crossfade.some(x=>x.name==='标题'&&x.state==='closing'&&x.animation.includes('rk-inline-menu-exit')&&x.pointer==='none'));
 assert.ok(crossfade.some(x=>x.name==='列表'&&x.state==='open'&&x.animation.includes('rk-inline-menu-enter')));
 await page.locator('.rk-inline-popover[data-state="closing"]').waitFor({state:'detached'});
 await listMenu.getByRole('menuitem',{name:'项目列表'}).hover();
 await format('.rk-hover-format--list-bullet').first().waitFor();
 await bubble.getByRole('button',{name:'对齐方式'}).hover();
 await page.getByRole('menu',{name:'对齐方式'}).getByRole('menuitem',{name:'居中对齐'}).hover();
 await format('.rk-hover-format--align-center').first().waitFor();
 await clean();
 console.log('PASS dropdown hover crossfade and list/alignment non-mutating preview');

 await bubble.getByRole('button',{name:'更多'}).hover();
 const more=page.getByRole('menu',{name:'更多'});
 await more.getByRole('menuitem',{name:'上标'}).hover();
 await format('.rk-hover-format--superscript').first().waitFor();
 await more.getByRole('menuitem',{name:'下标'}).hover();
 await format('.rk-hover-format--subscript').first().waitFor();
 await more.getByRole('menuitem',{name:'注释'}).hover();
 await format('.rk-hover-format--comment').first().waitFor();
 await clean();
 console.log('PASS more-menu superscript, subscript and comment previews');

 await bubble.getByRole('button',{name:'荧光笔与手绘标记'}).hover();
 const sketchMenu=page.getByRole('menu',{name:'荧光笔与手绘标记'});
 await sketchMenu.waitFor();
 await sketchMenu.getByRole('menuitem',{name:'手绘圈选'}).hover();
 const sketch=format('.rk-hover-format--sketch');
 await sketch.first().waitFor();
 await page.locator('.rk-sketch-preview-svg[data-sketch-drawing="circle"]').first().waitFor();
 const sketchAnimation=await page.evaluate(()=>({
  text:getComputedStyle(document.querySelector('.rk-hover-format--sketch')).animationName,
  svg:getComputedStyle(document.querySelector('.rk-sketch-preview-svg')).animationName,
  svgParent:document.querySelector('.rk-sketch-preview-svg')?.parentElement?.className
 }));
 assert.equal(sketchAnimation.text,'none','Text must never pulse for sketch previews');
 assert.ok(sketchAnimation.svg.includes('rk-sketch-preview-breathe'));
 await clean();await saved();
 await sketchMenu.getByRole('menuitem',{name:/^荧光笔/}).hover();
 await page.locator('.rk-sketch-preview-svg[data-sketch-drawing="highlight"]').first().waitFor();
 await sketchMenu.getByRole('menuitem',{name:'手绘双下划线'}).hover();
 await page.locator('.rk-sketch-preview-svg[data-sketch-drawing="double-underline"]').first().waitFor();
 await clean();await saved();
 await page.screenshot({path:'tmp/format-hover-sketch-preview.png'});
 await page.locator('.workbench-header').hover();
 await sketch.waitFor({state:'detached'});
 await page.locator('.rk-sketch-preview-svg').waitFor({state:'detached'});
 console.log('PASS sketch hover draws breathing real SVG only; text and persisted Markdown untouched');

 await bubble.getByRole('button',{name:'插入行内公式'}).hover();
 assert.equal(await format('.rk-hover-format').count(),0,'Formula insertion must not preview a formatting state');
 await bubble.getByRole('button',{name:'插入或编辑链接'}).hover();
 assert.equal(await format('.rk-hover-format').count(),0,'Link insertion must not preview formatting state');
 await bubble.getByRole('button',{name:'粗体'}).hover();
 await bubble.getByRole('button',{name:'粗体'}).click();
 await format('strong').first().waitFor();
 assert.equal(await format('.rk-hover-format--bold').count(),0,'Click must clear preview');
 await page.locator('.save-status.is-dirty').waitFor();
 assert.ok((await page.locator('.save-status').innerText()).includes('未保存'),'Click must mark document dirty');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.getByText('已保存',{exact:true}).first().waitFor();
 assert.ok((await getRecord(record.id)).content.includes('**Hover preview target and friends.**'));
 console.log('PASS clicking a previewed format commits exactly once');

 const outline=await page.locator('.editor-view-switcher [role="group"]').evaluate(el=>({
  outline:getComputedStyle(el).outlineWidth,offset:getComputedStyle(el).outlineOffset,padding:getComputedStyle(el).padding,
  rect:el.getBoundingClientRect().toJSON()
 }));
 assert.equal(outline.outline,'1px');assert.equal(outline.offset,'0px');assert.ok(outline.padding==='0px');
 await page.screenshot({path:'tmp/format-hover-mode-ring.png'});
 await para.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await bubble.waitFor();
 const neutral=await bubble.getByRole('button',{name:'粗体'}).evaluate(el=>({
  pressed:el.getAttribute('aria-pressed'),background:getComputedStyle(el).backgroundColor,
  color:getComputedStyle(el).color
 }));
 console.log('NEUTRAL_SELECTION',JSON.stringify(neutral));
 assert.equal(neutral.pressed,'true');
 await bubble.getByRole('button',{name:'粗体'}).hover();
 const unsetBold=format('.rk-hover-format--remove-bold').first();
 await unsetBold.waitFor();
 assert.ok(Number(await unsetBold.evaluate(el=>getComputedStyle(el).fontWeight))<=400,
  'Already-active bold must preview turning OFF');
 assert.ok((await getRecord(record.id)).content.includes('**Hover preview target and friends.**'),
  'Previewing cancellation must not commit the cancellation');
 console.log('PASS active formatting previews the toggle-off target state');

 const existingHeading=await page.evaluate(async()=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Heading toggle QA',kind:'document',content:'## Current H2\n\nOther text.'})});
  return r.json();
 });
 await page.goto(base+'/records/'+existingHeading.id+'?mode=visual');
 const h2=page.locator('.tiptap h2').filter({hasText:'Current H2'});
 await h2.waitFor();await h2.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const headingBubble=page.getByRole('toolbar',{name:'文本格式'});
 await headingBubble.waitFor();
 await headingBubble.getByRole('button',{name:'标题'}).hover();
 await page.getByRole('menu',{name:'标题'}).getByRole('menuitem',{name:'2 级标题'}).hover();
 const unheading=page.locator('.tiptap [data-rk-preview-level="0"]');
 await unheading.first().waitFor();
 assert.ok(parseFloat(await unheading.first().evaluate(el=>getComputedStyle(el).fontSize))<=18,
  'Hovering the active heading level must show paragraph typography');
 assert.equal((await getRecord(existingHeading.id)).content,'## Current H2\n\nOther text.');
 console.log('PASS active H2 hover previews returning to a paragraph');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
