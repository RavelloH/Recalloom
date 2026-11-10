import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(binary&&secret);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const fixture=[
'# 响应式交互验收','','alpha beta gamma','','[示例链接](https://example.com/sample)','',
'| 名称 | 值 |','| --- | --- |','| 测试 | 42 |','',
'~~~js','console.log("hello");','~~~','',
'::: warning 注意','','这个 Callout 应该保留右侧操作把手。','',':::','',
'最后一段用于右键插入测试。'
].join('\n');
async function login(page){
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
}
async function create(page){
 const response=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'V5 responsive '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },fixture);
 assert.equal(response.status,201);
 await page.goto(base+'/records/'+response.data.id+'?mode=visual');
 await page.locator('.tiptap').waitFor();
}
const desktop=await browser.newContext({viewport:{width:1280,height:900}});
const page=await desktop.newPage();
page.setDefaultTimeout(13000);
try{
 await login(page);await create(page);
 assert.equal(await page.evaluate(()=>matchMedia('(hover: hover) and (pointer: fine)').matches),true);
 assert.equal(await page.getByRole('toolbar',{name:'格式工具栏'}).count(),0);
 const paragraph=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 await paragraph.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const toolbar=page.getByRole('toolbar',{name:'文本格式'});await toolbar.waitFor();
 for(const label of ['标题','列表','对齐方式','引用','行内代码','插入行内公式','插入或编辑链接','更多'])
  assert.equal(await toolbar.getByRole('button',{name:label}).count(),1,'missing '+label);
 assert.equal(await toolbar.getByRole('button',{name:'行内组件'}).count(),0);
 assert.equal(await toolbar.getByRole('button',{name:'荧光笔与手绘标记'}).count(),1);
 assert.equal(await toolbar.getByRole('button',{name:'弱化注释'}).count(),0);
 await toolbar.getByRole('button',{name:'更多'}).click();
 let menu=page.getByRole('menu',{name:'更多'});await menu.waitFor();
 for(const label of ['注释','徽标 Badge','提示 Tooltip','缩写 Abbr','键帽 Kbd','挖空 Cloze'])
  assert.equal(await menu.getByRole('menuitem',{name:label}).count(),1,'more must include '+label);
 await page.keyboard.press('Escape');
 await toolbar.getByRole('button',{name:'标题'}).click();
 menu=page.getByRole('menu',{name:'标题'});await menu.waitFor();
 for(const label of ['正文','1 级标题','2 级标题','3 级标题','4 级标题','5 级标题','6 级标题'])
  assert.equal(await menu.getByRole('menuitem',{name:label}).count(),1,'heading state missing '+label);
 await menu.getByRole('menuitem',{name:'2 级标题'}).click();
 await page.locator('.tiptap h2').filter({hasText:'alpha beta gamma'}).first().waitFor();
 console.log('PASS desktop formatting state menu transforms paragraph to h2');
 const heading=page.locator('.tiptap h2').filter({hasText:'alpha beta gamma'}).first();
 await heading.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.getByRole('button',{name:'标题'}).click();
 await page.getByRole('menu',{name:'标题'}).getByRole('menuitem',{name:'2 级标题'}).click();
 await page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first().waitFor();
 console.log('PASS clicking active heading toggles to paragraph');

 // Lists and blockquotes are reversible formatting states, never slash
 // "new block" entries. Test both directions through the actual toolbar.
 let stateLine=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 await stateLine.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.getByRole('button',{name:'列表'}).click();
 await page.getByRole('menu',{name:'列表'}).getByRole('menuitem',{name:'项目列表'}).click();
 await page.locator('.tiptap ul li').filter({hasText:'alpha beta gamma'}).first().waitFor();
 await page.locator('.tiptap li p').filter({hasText:'alpha beta gamma'}).first().click();
 await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.getByRole('button',{name:'列表'}).click();
 await page.getByRole('menu',{name:'列表'}).getByRole('menuitem',{name:'项目列表'}).click();
 assert.equal(await page.locator('.tiptap ul li').filter({hasText:'alpha beta gamma'}).count(),0);
 stateLine=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 await stateLine.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.getByRole('button',{name:'引用'}).click();
 await page.locator('.tiptap blockquote').filter({hasText:'alpha beta gamma'}).first().waitFor();
 await page.locator('.tiptap blockquote p').first().click();
 await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.getByRole('button',{name:'引用'}).click();
 assert.equal(await page.locator('.tiptap blockquote').filter({hasText:'alpha beta gamma'}).count(),0);
 console.log('PASS list and blockquote state toggles are reversible');

 stateLine=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 await stateLine.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.getByRole('button',{name:'对齐方式'}).click();
 await page.getByRole('menu',{name:'对齐方式'}).getByRole('menuitem',{name:'居中对齐'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.tiptap p')]
  .some(el=>el.textContent?.includes('alpha beta gamma')&&getComputedStyle(el).textAlign==='center'));
 stateLine=page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first();
 await stateLine.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.getByRole('button',{name:'对齐方式'}).click();
 await page.getByRole('menu',{name:'对齐方式'}).getByRole('menuitem',{name:'居中对齐'}).click();
 assert.notEqual(await stateLine.evaluate(el=>getComputedStyle(el).textAlign),'center');
 console.log('PASS center alignment state toggles back to the default');

 // Keep the text selection live while hovering a formatting control.
 // Other state-switch tests can legitimately leave the editor caret collapsed.
 await page.locator('.tiptap p').filter({hasText:'alpha beta gamma'}).first().click();
 await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 await toolbar.waitFor();
 const markButton=toolbar.getByRole('button',{name:'高亮'});
 await markButton.hover();
 await page.getByRole('tooltip').first().waitFor({state:'visible'});
 const entrance=await page.getByRole('tooltip').first().evaluate(el=>getComputedStyle(el).animationName);
 assert.notEqual(entrance,'none','tooltip must have a visible entrance animation');
 await page.emulateMedia({reducedMotion:'reduce'});
 const reduced=await page.getByRole('tooltip').first().evaluate(el=>getComputedStyle(el).animationName);
 assert.equal(reduced,'none','reduced motion must disable tooltip animation');
 await page.emulateMedia({reducedMotion:'no-preference'});
 console.log('PASS tooltip animation and reduced-motion accessibility');

 // Targeted right-click menus.
 await page.locator('.tiptap a[href*="example.com"]').first().click({button:'right'});
 let context=page.getByRole('menu',{name:'编辑器右键菜单'});await context.waitFor();
 for(const text of ['打开链接','复制链接','编辑链接','移除链接'])
  assert.ok(await context.getByRole('menuitem',{name:text}).count()>0,'link right click '+text);
 await page.keyboard.press('Escape');
 await page.locator('.tiptap table td').first().click({button:'right'});
 context=page.getByRole('menu',{name:'编辑器右键菜单'});await context.waitFor();
 for(const text of ['在上方插入行','在下方插入行','在左侧插入列','在右侧插入列','删除行','删除列','合并单元格'])
  assert.ok(await context.getByRole('menuitem',{name:text}).count()>0,'table right click '+text);
 await page.keyboard.press('Escape');
 await page.locator('.tiptap pre code').first().click({button:'right'});
 context=page.getByRole('menu',{name:'编辑器右键菜单'});await context.waitFor();
 for(const text of ['复制代码','切换语言'])
  assert.ok(await context.getByRole('menuitem',{name:text}).count()>0,'code right click '+text);
 await page.keyboard.press('Escape');
 const last=page.locator('.tiptap p').filter({hasText:'最后一段'}).first();
 await last.click({button:'right'});
 context=page.getByRole('menu',{name:'编辑器右键菜单'});await context.waitFor();
 for(const text of ['粘贴','插入'])
  assert.ok(await context.getByRole('menuitem',{name:text}).count()>0,'blank context '+text);
 await context.getByRole('menuitem',{name:'插入'}).click();
 await page.getByRole('listbox',{name:'插入内容'}).waitFor();
 assert.equal(await page.getByRole('listbox',{name:'插入内容'}).getByText('正文').count(),0);
 assert.equal(await page.getByRole('listbox',{name:'插入内容'}).getByText('表格').count()>0,true);
 console.log('PASS right click links, tables, code, paste and slash insertion');
 await page.keyboard.press('Escape');
 await page.locator('.tiptap .rk-directive-warning').first().hover();
 const grip=page.getByRole('group',{name:'块把手'});
 await grip.waitFor();
 for(const label of ['拖动块','编辑块','块操作'])assert.ok(await grip.getByRole('button',{name:label}).count()>0,'grip '+label);
 const geometry=await grip.boundingBox();assert.ok(geometry&&geometry.width<52&&geometry.height>95);
 await grip.getByRole('button',{name:'编辑块'}).click();
 const drawer=page.getByRole('complementary',{name:'块编辑面板'});await drawer.waitFor();
 assert.notEqual(await drawer.evaluate(el=>getComputedStyle(el).animationName),'none');
 await drawer.getByRole('button',{name:'关闭块编辑'}).click();
 await page.locator('.rk-block-editor-panel[data-closing="true"]').waitFor();
 await drawer.waitFor({state:'hidden'});
 console.log('PASS vertical grip and animated Drawer enter/exit',geometry);

 await page.locator('.tiptap p').filter({hasText:'最后一段'}).first().click({button:'right'});
 context=page.getByRole('menu',{name:'编辑器右键菜单'});await context.waitFor();
 await context.getByRole('menuitem',{name:'粘贴'}).click();
 await page.getByRole('status').filter({hasText:'Ctrl+V'}).first().waitFor({timeout:4500}).catch(()=>{});
 console.log('PASS clipboard paste entry exists');
}finally{await desktop.close();}
for(const [kind,width,height] of [['pad',1024,768],['phone',390,844]]){
 const ctx=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true});
 const p=await ctx.newPage();
 try{
  await login(p);await create(p);
  const capabilities=await p.evaluate(()=>({fine:matchMedia('(hover: hover) and (pointer: fine)').matches,
   coarse:matchMedia('(pointer: coarse)').matches,width:innerWidth}));
  assert.equal(capabilities.fine,false,kind+JSON.stringify(capabilities));
  const top=p.getByRole('toolbar',{name:'格式工具栏'});await top.waitFor();
  assert.equal(await p.getByRole('toolbar',{name:'文本格式'}).count(),0,kind+' no selection bubble');
  assert.equal(await p.locator('.rk-editor-context-area').count(),0,kind+' native context menu');
  await p.locator('.tiptap .rk-directive-warning').first().tap();
  assert.equal(await p.locator('.rk-block-grip').count(),0,kind+' no desktop drag grip');
  assert.ok(await top.getByRole('button',{name:'插入内容'}).count()>0,kind+' plus menu');
  assert.ok(await top.getByRole('group',{name:'当前块操作'}).count()>0,kind+' top block actions');
  const metrics=await top.evaluate(el=>([...el.querySelectorAll('button')].slice(0,12).map(b=>{
   const rect=b.getBoundingClientRect();const svg=b.querySelector('svg,.toolbar-highlight');
   const inner=svg?.getBoundingClientRect();
   return {label:b.getAttribute('aria-label'),height:rect.height,offset:inner?Math.abs((inner.top+inner.height/2)-(rect.top+rect.height/2)):null};
  })));
  assert.ok(metrics.every(v=>v.height>=42&&v.offset!==null&&v.offset<4),
   'touch toolbar icons not vertically centered: '+JSON.stringify(metrics));
  await top.getByRole('button',{name:'插入内容'}).click();
  const picker=p.getByRole('listbox',{name:'插入内容'});await picker.waitFor();
  assert.ok(await picker.getByText('表格').count()>0,kind+' slash insertion content');
  console.log('PASS touch-first',kind,capabilities,'toolbar icon alignment, no custom context/grip, insert and block actions');
 }finally{await ctx.close();}
}
await browser.close();
