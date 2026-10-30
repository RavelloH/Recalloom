/**
 * Full browser roundtrip regression for the NeutralPress-derived Tiptap core.
 * Runs against an isolated local Worker, never against production documents.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';
const browserBin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const keyLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(browserBin&&keyLine,'Local browser and .dev.vars required');
const secret=keyLine.slice(keyLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base='http://127.0.0.1:8897',browser=await chromium.launch({headless:true,executablePath:browserBin});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const tick=String.fromCharCode(96);
const samples=[
 ['plain','# Heading\n\nSome **bold**, *italic* and [link](https://example.com).',true,{}],
 ['extended-marks','Paragraph with <u>underline</u>, <mark>highlight</mark>, <sup>sup</sup> and <sub>sub</sub>.',true,{u:1,mark:1,sup:1,sub:1}],
 ['alternate-underline','Use ++underlined++ and normal text.',true,{u:1}],
 ['aligned-table','| Item | Value | Status |\n| :--- | ---: | :---: |\n| A | 42 | Ready |',true,{table:1,align:['left','right','center']}],
 ['gfm','- [x] Done\n- [ ] Pending\n\n~~removed~~ and '+tick+'inline'+tick,true,{}],
 ['math','Inline $x^2$ and block:\n\n$$\nx^2+y^2=z^2\n$$',true,{}],
 ['mermaid',tick.repeat(3)+'mermaid\ngraph TD\n A-->B\n'+tick.repeat(3),true,{}],
 ['extra-blank-lines','# Title\n\nFirst paragraph.\n\n\nSecond paragraph.',true,{}],
 ['auto-link','Visit <https://example.com> for docs.',true,{}],
 ['identifier-placeholder','Owner web:owner:<sessionId> and grant:<actorId>.',true,{}],
 ['unclosed-html-tag','The <mark> element should not be dropped.',false,{}],
 ['unsupported-footnote','A detail[^note].\n\n[^note]: Important footnote text.',false,{}],
 ['unsupported-reference-link','[Read this][docs]\n\n[docs]: https://example.com "Docs"',false,{}],
 ['unsupported-html','<div class="notice">Careful HTML</div>',false,{}],
 ['yaml-frontmatter','---\ntitle: Example\ntags:\n - foo\n---\n\n# Content',false,{}]
];
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 await page.goto(base+'/library');
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill('Tiptap fidelity E2E '+Date.now());
 await page.getByRole('button',{name:'创建',exact:true}).click();
 let revisions=1;
 for(const [name,content,visualExpected,marks] of samples){
  await page.getByRole('button',{name:'Markdown'}).click();
  await page.locator('.cm-line').first().waitFor({timeout:15000});
  await page.locator('.cm-content').fill(content);
  await page.getByRole('button',{name:'保存'}).click();
  revisions++;
  await page.getByText('R'+revisions,{exact:false}).first().waitFor({timeout:15000});
  await page.getByRole('button',{name:'可视化'}).click();
  await page.waitForTimeout(280);
  const visible=await page.locator('.tiptap').count()>0;
  assert.equal(visible,visualExpected,name+' visual-mode fidelity');
  assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),name+' must never dirty original without edits');
  if(visible){
   const actual=await page.locator('.tiptap').evaluate(el=>({
    u:el.querySelectorAll('u').length,mark:el.querySelectorAll('mark').length,
    sup:el.querySelectorAll('sup').length,sub:el.querySelectorAll('sub').length,
    table:el.querySelectorAll('table').length,
    align:[...el.querySelectorAll('tr:first-child>*')].map(x=>x.style.textAlign)
   }));
   for(const [key,value] of Object.entries(marks))assert.deepEqual(actual[key],value,name+' markup '+key);
  }else{
   assert.ok(await page.locator('.warning-banner').count(),name+' offers safe source fallback');
  }
  await page.getByRole('button',{name:'Markdown'}).click();
  await page.locator('.cm-line').first().waitFor({timeout:15000});
  const raw=await page.locator('.cm-line').allTextContents();
  assert.equal(raw.join('\n'),content,name+' source remains byte-for-byte identical on mode switches');
 }
 // Real edits must preserve extended marks through Markdown export.
 const ext=String(samples.find(row=>row[0]==='extended-marks')[1]);
 await page.getByRole('button',{name:'Markdown'}).click();
  await page.locator('.cm-line').first().waitFor({timeout:15000});
 await page.locator('.cm-content').fill(ext);
 await page.getByRole('button',{name:'保存'}).click();
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap').click();
 await page.locator('.tiptap').focus();
 await page.keyboard.press('End');
 await page.locator('.tiptap').pressSequentially(' Continued.',{delay:8});
 const visualTyped=await page.locator('.tiptap').innerText();
 const saveDisabled=await page.getByRole('button',{name:'保存'}).isDisabled();
 await page.getByRole('button',{name:'Markdown'}).click();
  await page.locator('.cm-line').first().waitFor({timeout:15000});
 const editedMarks=(await page.locator('.cm-line').allTextContents()).join('\n');
 for(const tag of ['u','mark','sup','sub'])assert.ok(editedMarks.includes('<'+tag+'>'),tag+' must survive visual edit');
 assert.ok(editedMarks.includes('Continued.'),'visual typing reflected: '+JSON.stringify({visualTyped,saveDisabled,editedMarks}));
 const originalTable=String(samples.find(row=>row[0]==='aligned-table')[1]);
 await page.locator('.cm-content').fill(originalTable);
 await page.getByRole('button',{name:'保存'}).click();
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap table tr:last-child td:first-child').click();
 await page.locator('.tiptap').focus();
 await page.keyboard.press('End');
 await page.locator('.tiptap').pressSequentially(' updated',{delay:8});
 const tableDOM=await page.locator('.tiptap').innerText();
 const tableFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,cls:document.activeElement?.className,html:document.activeElement?.outerHTML.slice(0,200)}));
 await page.getByRole('button',{name:'Markdown'}).click();
  await page.locator('.cm-line').first().waitFor({timeout:15000});
 const editedTable=(await page.locator('.cm-line').allTextContents()).join('\n');
 assert.ok(editedTable.includes('updated'),'visual table cell edit exported: '+JSON.stringify({editedTable,tableDOM,tableFocus}));
 assert.match(editedTable,/\| -------- \| -------: \| :------: \|/,'table alignment preserved after edit');
 // Mobile Safari-like viewport: toolbar groups must wrap without document overflow.
 const mobileCtx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 await mobileCtx.addCookies(await page.context().cookies());
 const mobile=await mobileCtx.newPage();
 const mobileUrl=new URL(page.url());mobileUrl.searchParams.set('mode','visual');
 await mobile.goto(mobileUrl.toString(),{waitUntil:'networkidle'});
 await mobile.locator('.wysiwyg-toolbar').waitFor();
 const mobileGeometry=await mobile.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,toolbar:document.querySelector('.wysiwyg-toolbar')?.getBoundingClientRect().width,editor:document.querySelector('.tiptap')?.getBoundingClientRect().width}));
 assert.ok(mobileGeometry.scroll<=mobileGeometry.viewport,'editor toolbar must not overflow mobile viewport: '+JSON.stringify(mobileGeometry));
 assert.ok(mobileGeometry.editor>260,'editor retains readable mobile writing area');
 await mobileCtx.close();
 console.log('PASS NeutralPress Markdown: '+samples.length+' samples plus actual mark/table visual edits');
}finally{await browser.close();}
