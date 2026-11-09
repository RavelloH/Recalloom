import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base='http://127.0.0.1:8805';
const secret=readFileSync('.dev.vars','utf8').match(/MCP_AUTH_SECRET=([^\r\n]+)/)?.[1];
assert.ok(secret);
const audit=JSON.parse(readFileSync('tmp/rmd-parity-audit.json','utf8')).results;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page=await browser.newPage({viewport:{width:1220,height:850}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const read=async id=>page.evaluate(async id=>(await (await fetch('/api/records/'+id)).json()).content,id);
const beforeSource={};
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');

 for(const [key,{id}] of Object.entries(audit)){
  const r=await page.evaluate(async id=>(await (await fetch('/api/records/'+id)).json()).content,id);
  beforeSource[key]=r;
 }
 const open=async(name,mode)=>{
  await page.goto(base+'/records/'+audit[name].id+'?mode='+mode);
  await page.locator(mode==='visual'?'.editor-view .tiptap':'.editor-view .markdown-preview').waitFor();
 };
 for(const mode of ['visual','preview']){
  await open('inline',mode);
  const marks=page.locator('.editor-view mark');
  assert.ok(await marks.count()>=2,'Mark + red Highlight missing');
  const colors=await marks.evaluateAll(nodes=>nodes.slice(0,2).map(node=>({value:node.getAttribute('data-rk-color'),background:getComputedStyle(node).backgroundColor})));
  assert.equal(colors[0].value,null);
  assert.equal(colors[1].value,'red');
  assert.notEqual(colors[0].background,colors[1].background,'red Highlight must not use yellow Mark color in '+mode);
  const tooltip=page.locator('.editor-view .rk-tooltip-inline[data-rk-tooltip]');
  assert.ok(await tooltip.count()>=2,'Tooltip and Abbr share accessible semantics in '+mode);
  await tooltip.first().focus();
  assert.match(await tooltip.first().evaluate(el=>getComputedStyle(el,'::after').content),/有状态计算/);
  const cloze=page.locator('.editor-view .rk-cloze-trigger,.editor-view .rk-cloze-reveal').first();
  await cloze.click();
  assert.equal(await cloze.getAttribute('aria-expanded'),'true','Cloze reveal must be interactive '+mode);
  await cloze.click();
  assert.equal(await cloze.getAttribute('aria-expanded'),'false','Cloze hide must work '+mode);

  await open('callouts',mode);
  for(const kind of ['note','info','tip','success','warning','danger','example','question'])
   assert.equal(await page.locator('.editor-view .rk-rmd-callout[data-rk-kind="'+kind+'"]').count(),1,kind+' Callout missing '+mode);
  assert.ok((await page.locator('.editor-view').innerText()).includes('详细内容。'),'Details content missing '+mode);

  await open('structured',mode);
  const tab=page.locator('.editor-view [class*="rk-tabs-"][data-rk-tabs],.editor-view .rk-tabs-edit').first();
  assert.ok(await tab.count(),'Tabs missing '+mode);
  assert.ok((await tab.innerText()).includes('标签页'),'Tabs title missing '+mode);
  const active=tab.locator('button[data-tab-value="1"]');
  await active.click();
  assert.equal(await active.getAttribute('aria-current'),'true','Tabs interactive state missing '+mode);
  assert.ok((await tab.innerText()).includes('第二个面板'),'Second tab content missing '+mode);
  await tab.locator('button[data-tab-value="0"]').click();
  const flash=page.locator('.editor-view .rk-flashcard').first();
  assert.ok(await flash.count());
  const button=flash.getByRole('button',{name:'显示答案'});
  await button.click();
  assert.equal(await flash.getByRole('button',{name:'收起答案'}).getAttribute('aria-expanded'),'true');
  assert.ok((await flash.innerText()).includes('答案。'),'Flashcard back should become visible '+mode);
  await flash.getByRole('button',{name:'收起答案'}).click();
  assert.equal(await flash.getByRole('button',{name:'显示答案'}).getAttribute('aria-expanded'),'false');
  for(const term of ['AST','CAS'])assert.ok((await page.locator('.editor-view').innerText()).includes(term),'Glossary entry missing '+term+' '+mode);
  assert.ok((await page.locator('.editor-view').innerText()).includes('问题来了。'),'Chat user message missing '+mode);
  assert.ok((await page.locator('.editor-view').innerText()).includes('回复，包括'),'Chat assistant message missing '+mode);
  await open('blocks',mode);
  const figure=page.locator('.editor-view figure.rk-rich-figure').first();
  await figure.waitFor();
  assert.ok((await figure.innerText()).includes('实验装置'),'image caption missing '+mode);
  assert.ok((await page.locator('.editor-view').innerText()).includes('测量数据'),'table caption missing '+mode);
  assert.ok((await page.locator('.editor-view').innerText()).includes('example.ts'),'code header missing '+mode);
  console.log('PASS',mode,'Mark/Highlight, Tooltip/Abbr, Cloze, 8 Callouts, Details, Tabs, Chat, Flashcard, Glossary, Figure, Table and Code');
 }

 await page.goto(base+'/help');
 await page.getByRole('heading',{name:'RMD 语法参考'}).waitFor();
 await page.getByRole('navigation',{name:'RMD 组件导航'}).getByRole('button',{name:'完整参考手册'}).click();
 await page.setViewportSize({width:375,height:850});
 const table=page.locator('.rk-help-prose table').filter({hasText:'color'}).first();
 await table.waitFor();
 const tableReport=await table.evaluate(element=>{
  const cell=element.querySelector('td');
  return {client:element.clientWidth,scroll:element.scrollWidth,
   firstCellWidth:cell?.getBoundingClientRect().width??0,
   pageScroll:document.documentElement.scrollWidth,viewport:innerWidth};
 });
 assert.ok(tableReport.scroll>tableReport.client+100,'parameter tables should scroll horizontally on phones '+JSON.stringify(tableReport));
 assert.ok(tableReport.firstCellWidth>60,'table columns must remain readable '+JSON.stringify(tableReport));
 assert.ok(tableReport.pageScroll<=tableReport.viewport+1,'help page should not overflow viewport '+JSON.stringify(tableReport));
 console.log('PASS MOBILE HELP TABLE',JSON.stringify(tableReport));
 for(const [key,{id}] of Object.entries(audit)){
  const after=await page.evaluate(async id=>(await (await fetch('/api/records/'+id)).json()).content,id);
  assert.equal(after,beforeSource[key],'reading or switching parity views must not write database '+key);
 }
 assert.deepEqual(errors,[],'no uncaught JS errors');
 console.log('PASS READ ONLY no document revisions or frontend errors');
}finally{await browser.close().catch(()=>{});}
