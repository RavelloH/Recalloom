import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const binary=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&binary);
const browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.setDefaultTimeout(16000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source=[
 '移动 RMD 属性 Drawer 测试：此段在 H1 之前，避免页面标题提升隐藏正文标题节点。','',
 '# 移动属性测试 @ attrs mobile-heading @','','这是段落。 @ attrs mobile-paragraph @','',
 '~~~typescript','const answer = 42;','~~~','@ attrs code-mobile | file=before.ts | wrap=true @','',
 '![实验装置](/examples/device.svg "图片") @ attrs fig-mobile | width=420 | caption=原图说明 @'
].join('\n');
const api=(method,recordId,content)=>page.evaluate(async({method,recordId,content})=>{
 const r=await fetch('/api/records'+(recordId?'/'+recordId:''),{
  method,headers:content?{'content-type':'application/json'}:undefined,
  body:content?JSON.stringify(content):undefined
 });return {status:r.status,data:await r.json()};
},{method,recordId,content});
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:width===390?844:700});
  const rec=await api('POST',null,{name:'Mobile schema attrs '+Date.now()+'.md',kind:'document',content:source});
  assert.equal(rec.status,201,JSON.stringify(rec).slice(0,400));
  const id=rec.data.id;
  await page.goto(base+'/records/'+id+'?mode=visual');
  const panel=page.getByRole('dialog',{name:'块编辑面板'});
  const badge=kind=>page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="'+kind+'"]').first();
  const close=async()=>{await panel.getByRole('button',{name:'关闭块编辑'}).click();await panel.waitFor({state:'hidden'});};
  await badge('image').click();
  await panel.waitFor();
  const sheet=panel.locator('.workspace-panel-sheet');
  await page.waitForFunction(()=>{
   const element=document.getElementById('block-editor');
   return element&&Math.abs(new DOMMatrix(getComputedStyle(element).transform).m42)<=1;
  });
  await sheet.evaluate(async element=>{await Promise.allSettled(element.getAnimations().map(animation=>animation.finished));});
  const geometry=await sheet.evaluate(e=>{
   const r=e.getBoundingClientRect(),preview=e.querySelector('.rk-block-panel-preview')?.getBoundingClientRect();
   return {left:r.left,top:r.top,width:r.width,height:r.height,previewHeight:preview?.height??0};
  });
  assert.ok(geometry.width>=width-1&&Math.abs(geometry.left)<1,'mobile bottom sheet fills the available width '+JSON.stringify(geometry));
  assert.ok(geometry.top>0&&geometry.height<(width===390?844:700),
   'mobile block editor retains the bottom sheet presentation '+JSON.stringify(geometry));
  assert.ok(geometry.previewHeight>40&&geometry.previewHeight<=Math.round((width===390?844:700)*.31),
   'sticky live preview limited to 30% '+JSON.stringify(geometry));
  assert.equal(await panel.getByRole('region',{name:'图片 Markdown 属性'}).count(),1);
  assert.equal(await page.locator('.rk-rmd-attrs-editor').count(),0,'old floating attrs dialog must be gone');
  const field=panel.getByRole('textbox',{name:'宽度 px'});
  assert.equal(await field.inputValue(),'420');
  await field.fill('39');
  await panel.getByRole('alert').waitFor();
  assert.ok((await panel.getByRole('alert').innerText()).includes('40'));
  assert.match(await badge('image').innerText(),/width=420/,'invalid dimension did not modify the original');
  await field.fill('480');
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-rmd-attrs-decoration')].some(el=>el.textContent.includes('width=480')));
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-block-editor-panel textarea')].some(el=>el.value.includes('width=480')));
  assert.match(await panel.getByRole('textbox',{name:'块源码'}).inputValue(),/width=480/,'structured node attrs must refresh raw RMD in the same panel');
  await panel.getByRole('textbox',{name:'图注'}).fill('更新后的图注');
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-rmd-attrs-decoration')].some(el=>el.textContent.includes('更新后的图注')));
  await close();
  await badge('codeBlock').click();
  await panel.waitFor();
  assert.equal(await panel.getByRole('region',{name:'代码块 Markdown 属性'}).count(),1);
  const wrap=panel.getByRole('checkbox',{name:'自动换行'});
  assert.equal(await wrap.isChecked(),true);
  await wrap.uncheck();
  await page.waitForFunction(()=>!document.querySelector('.tiptap .rk-code-block')?.classList.contains('rk-code-wrap'));
  assert.doesNotMatch(await badge('codeBlock').innerText(),/wrap=/,'false is the schema default and must be omitted from canonical RMD');
  await panel.getByRole('textbox',{name:'文件名'}).fill('after.ts');
  await page.waitForFunction(()=>[...document.querySelectorAll('.rk-block-editor-panel textarea')].some(el=>el.value.includes('file=after.ts')));
  await close();
  await badge('heading').click();
  await panel.waitFor();
  await panel.getByRole('textbox',{name:'稳定 ID（可选）'}).fill('renamed-mobile');
  await close();
  assert.equal((await api('GET',id)).data.content,source,'live editing does not write to D1');
  await page.getByRole('button',{name:'源码'}).click();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const actual=await page.evaluate(()=>navigator.clipboard.readText());
  for(const expected of ['@ attrs renamed-mobile @','file=after.ts','width=480','caption=更新后的图注'])
   assert.ok(actual.includes(expected),expected+' should survive RMD roundtrip:\n'+actual);
  assert.doesNotMatch(actual,/wrap=true/,'unchecked wrap canonicalizes to absence of explicit default');
  const h=await page.evaluate(()=>({window:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(h.document<=h.window+1,'no horizontal scroll on '+width+'px mobile');
  console.log('PASS mobile shared schema drawer',width,JSON.stringify(geometry));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
