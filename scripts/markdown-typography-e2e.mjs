/** Visual-only regression: no production data or MCP changes. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';

const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
assert.ok(edge&&secretLine,'A local browser and test secret are required');
const secret=secretLine.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
const browser=await chromium.launch({headless:true,executablePath:edge});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

const longLine='const longLine = "'+'x'.repeat(150)+'";';
const markdown=[
 '# Markdown 排版回归',
 '',
 '这是一段混合中文和 English 的说明文字，主要验证宽屏场景下的可读行宽、字体、行距以及长文档排版。'.repeat(4),
 '',
 '## 第二节：正文与列表',
 '',
 '- 第一个项目：用于验证行间距和多行换行。',
 '- 第二个项目：**粗体**、*斜体*、[链接](https://example.com)。',
 '- 第三个项目：带有 `inline code` 的列表。',
 '',
 '> 引用块应当与正文对齐，同时使用 Astryx 主题的中性色。',
 '',
 '```ts',
 longLine,
 '```',
 '',
 '| '+Array.from({length:12},(_,i)=>'列 '+(i+1)).join(' | ')+' |',
 '| '+Array(12).fill('---').join(' | ')+' |',
 '| '+Array.from({length:12},(_,i)=>String(i+1)).join(' | ')+' |',
 '',
 '这是表格下方的一段普通文本，用于确认宽内容不会把正文整体撑开。',
 '',
 '$$',
 'x^2 + y^2 = z^2',
 '$$',
 '',
 '最后一段正文：宽屏与手机上的段落行宽应遵循一致的版式规则。'
].join('\n');

async function metrics(selector){
 return page.evaluate(selector=>{
  const root=document.querySelector(selector);
  if(!root)throw Error('Missing document root '+selector);
  const para=root.querySelector(':scope > p');
  const code=root.querySelector(':scope > .code-block');
  const table=root.querySelector(':scope > .tableWrapper, :scope > table');
  if(!para||!code||!table)throw Error('Missing document geometry '+JSON.stringify({p:!!para,pre:!!code,table:!!table,children:[...root.children].slice(0,15).map(x=>({tag:x.tagName,cls:x.className,text:x.textContent?.slice(0,55)}))}));
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,width:r.width,right:r.right};};
  return {
   document:rect(root),paragraph:rect(para),pre:rect(code),table:rect(table),
   fontSize:parseFloat(getComputedStyle(root).fontSize),
   lineHeight:parseFloat(getComputedStyle(root).lineHeight),
   viewport:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
   // Wide blocks scroll inside their own viewport (overlay scrollbar), never the page.
   wideScroll:(v=>v.scrollWidth>v.clientWidth)(code.querySelector('.rk-scroll-viewport')),
   tableScroll:(v=>v.scrollWidth>v.clientWidth)(table.querySelector('.rk-scroll-viewport')),
   headingCount:root.querySelectorAll('h1,h2,h3').length
  };
 },selector);
}
try {
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const id=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Markdown typography isolated '+Date.now(),kind:'document',content})});
  if(!r.ok)throw Error('Fixture create failed '+r.status);
  return (await r.json()).id;
 },markdown);
 await page.goto(base+'/records/'+id,{waitUntil:'networkidle'});
 await page.locator('.tiptap').waitFor();
 // The document is scrolled by Astryx's native viewport, not window/body.
 const scrollStatus=await page.evaluate(()=>{
   const pane=document.querySelector('.main-scroll');
   const topbar=document.querySelector('.topbar');
   if(!(pane instanceof HTMLElement)||!topbar)throw Error('Missing Astryx scroll viewport');
   const before=topbar.getBoundingClientRect().y;
   pane.scrollTop=480;
   const status={height:pane.clientHeight,contentHeight:pane.scrollHeight,
     position:pane.scrollTop,topbarShift:Math.abs(topbar.getBoundingClientRect().y-before),
     overflow:getComputedStyle(pane).overflowY};
   pane.scrollTop=0;
   return status;
 });
 assert.ok(scrollStatus.contentHeight>scrollStatus.height,'long document overflows its scroll area');
 assert.ok(scrollStatus.position>100,'desktop document scrolls inside the Astryx area: '+JSON.stringify(scrollStatus));
 assert.ok(scrollStatus.topbarShift<1,'topbar remains fixed while document scrolls');
 const visual=await metrics('.tiptap');
 // One measure: prose, code and tables share the same column edges.
 assert.ok(visual.paragraph.width<=802&&visual.paragraph.width>=700,'prose follows readable measure: '+JSON.stringify(visual));
 assert.ok(Math.abs(visual.document.width-visual.paragraph.width)<=1,'document is the column');
 for(const block of ['pre','table'])assert.ok(Math.abs(visual[block].x-visual.paragraph.x)<=1&&Math.abs(visual[block].width-visual.paragraph.width)<=1,block+' shares the prose column');
 assert.ok(visual.tableScroll,'wide table scrolls inside its block');
 assert.ok(visual.lineHeight>=visual.fontSize*1.7,'comfortable line spacing');
 assert.ok(visual.wideScroll,'long code scrolls inside its block');

 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.locator('.markdown-preview').waitFor();
 const preview=await metrics('.markdown-preview');
 assert.ok(Math.abs(preview.paragraph.width-visual.paragraph.width)<=1,'visual and preview have identical prose measure');
 assert.ok(Math.abs(preview.fontSize-visual.fontSize)<=0.1,'visual and preview have identical type scale');
 assert.ok(Math.abs(preview.lineHeight-visual.lineHeight)<=0.1,'visual and preview have identical leading');
 for(const block of ['pre','table'])assert.ok(Math.abs(preview[block].x-visual[block].x)<=1&&Math.abs(preview[block].width-visual[block].width)<=1,'preview '+block+' matches the visual editor');
 assert.ok(preview.wideScroll&&preview.tableScroll,'preview wide blocks scroll the same way');
 mkdirSync('tmp',{recursive:true});
 await page.screenshot({path:'tmp/typography-desktop.png',fullPage:false});
 console.log('DESKTOP',JSON.stringify({visual,preview}));

 for(const width of [320,390,430]){
  await page.setViewportSize({width,height:844});
  // Let responsive SideNav finish its CSS slide-out before screenshot and measurements.
  await page.waitForTimeout(350);
  const mobile=await metrics('.markdown-preview');
  assert.ok(mobile.scrollWidth<=mobile.viewport,'mobile page must not overflow '+width+': '+JSON.stringify(mobile));
  assert.ok(mobile.paragraph.width<=mobile.document.width,'mobile paragraph must fit');
  assert.ok(mobile.fontSize>=15.5,'mobile text remains legible');
  if(width===390){
    const mobileScroll=await page.evaluate(()=>{
      const pane=document.querySelector('.main-scroll');
      const topbar=document.querySelector('.topbar');
      if(!(pane instanceof HTMLElement)||!topbar)throw Error('Missing mobile scroll area');
      const y=topbar.getBoundingClientRect().y;
      pane.scrollTop=240;
      const out={scrollTop:pane.scrollTop,topbarShift:Math.abs(topbar.getBoundingClientRect().y-y),
        viewport:pane.clientWidth};
      pane.scrollTop=0;
      return out;
    });
    assert.ok(mobileScroll.scrollTop>=150,'mobile document remains scrollable within the overlay-scrollbar viewport');
    assert.ok(mobileScroll.topbarShift<1,'mobile topbar stays fixed while document scrolls');
    await page.screenshot({path:'tmp/typography-mobile.png',fullPage:false});
  }
 }
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await page.locator('.tiptap').waitFor();
 const phone=await metrics('.tiptap');
 assert.ok(phone.scrollWidth<=phone.viewport,'mobile Tiptap must not widen document');
 const rawId=await page.evaluate(async()=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({name:'Typography raw Markdown '+Date.now(),kind:'document',
      content:'# Raw Markdown\n\n文本[^footnote]\n\n[^footnote]: 保留原文。'})});
  if(!response.ok)throw Error('Raw fixture '+response.status);
  return (await response.json()).id;
 });
 await page.goto(base+'/records/'+rawId,{waitUntil:'networkidle'});
 await page.locator('.raw-markdown-node').first().waitFor();
 await page.locator('.raw-markdown-node').first().getByRole('button',{name:'编辑此段源码'}).click();
 const raw=page.getByRole('textbox',{name:'编辑原始 Markdown'}).first();
 assert.ok(await raw.isVisible(),'Astryx TextArea is accessible inside source node');
 assert.ok(await raw.evaluate(el=>!!el.closest('.raw-markdown-field')),'raw text editor rendered in field wrapper');
 await page.locator('.raw-markdown-node').first().getByRole('button',{name:'取消'}).click();
 assert.equal(errors.length,0,'no unhandled browser errors');
 console.log('PASS Markdown typography: one column, in-block scrolling, preview/editor parity, mobile 320/390/430, Astryx raw node');
}finally {await browser.close();}
