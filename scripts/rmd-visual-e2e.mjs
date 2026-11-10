import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8799';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'must only test localhost');
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(v=>/^MCP_AUTH_SECRET\s*=/.test(v));
assert.ok(browserPath&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const input=[
 '# Visual RMD QA @ attrs visual-rmd @',
 '',
 '文中 :: mark **重点** :: 和 :: highlight 彩色 | yellow ::。',
 '',
 '状态 :: badge 已完成 | success :: 和 :: tooltip DO | description=有状态计算 ::。',
 '',
 '标准 [站点](https://example.com "链接标题") 必须保留 HTML title 属性。',
 '',
 '注释 %%编辑时必须可见%%。',
 '',
 '%%',
 '块注释必须可编辑。',
 '%%',
 '',
 '![实验装置](device.png "图片标题") @ attrs fig-device | width=480 | caption=实验装置 @',
 '',
 '::: mark',
 '',
 '$$',
 'E=mc^2',
 '$$',
 '',
 ':::',
 '',
 '| 名称 | 状态 |',
 '| --- | --- |',
 '| Test | :: badge 完成 | success :: |',
 '@ attrs tbl-test | caption=状态表 @',
 '',
 '同文档交叉引用 [[#fig-device]] 和 [[#tbl-test]]。',
 '',
 '~~~ts', 'const rmdAnchor = true;', '~~~', '@ attrs code-visual | file=demo.ts @',
 '',
 '此段支持单独引用。 @ attrs paragraph-visual @',
 '',
 '另外参见 [[#visual-rmd]]、[[#paragraph-visual]]、[[#code-visual]]。',
 '',
 '普通内容末尾。',
 '',
 '## 错误属性 @ attrs | width=abc @'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:850}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const json=async(path,method='GET',payload)=>page.evaluate(async({path,method,payload})=>{
 const r=await fetch('/api'+path,{method,headers:payload?{'content-type':'application/json'}:{},
 body:payload?JSON.stringify(payload):undefined});
 return {status:r.status,body:await r.json().catch(()=>({}))};
},{path,method,payload});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const created=await json('/records','POST',{kind:'document',name:'Visual-RMD-v1-'+Date.now()+'.md',content:input});
 assert.equal(created.status,201,JSON.stringify(created).slice(0,350));
 const id=created.body.id;
 await page.goto(base+'/records/'+id+'?mode=visual',{waitUntil:'domcontentloaded'});
 const visual=page.locator('.tiptap');
 await visual.waitFor({timeout:25000});
 await visual.locator('.rk-inline-badge').first().waitFor();
 assert.equal(await visual.locator('mark:not([data-rk-color])').count(),1,'default Mark one inline');
 assert.equal(await visual.locator('.rk-sketch-inline[data-rk-sketch-kind="highlight"][data-rk-sketch-color="yellow"]').count(),1);
 assert.equal(await visual.locator('.rk-rmd-block-mark').count(),1,'block Mark node');
 assert.equal(await visual.locator('table tbody tr').count(),2,'Tiptap includes the header row in tbody');
 assert.equal(await visual.locator('table tbody tr').last().locator('td').count(),2,'GFM two columns');
 assert.equal(await visual.locator('.rk-rmd-comment-block').count(),1);
 const cross=await visual.locator('.rk-cross-reference a').allTextContents();
 assert.deepEqual(cross.slice(0,2),['图 1','表 1'],'typed references remain numbered');
 assert.ok(cross.includes('章节：Visual RMD QA')&&cross.some(t=>t.includes('段落：此段支持单独引用'))&&cross.includes('代码：demo.ts'),'all local anchors must resolve '+JSON.stringify(cross));
 assert.equal(await visual.locator('#user-content-code-visual').count(),1,'visual code block has real anchor');
 const attrsCount=await visual.locator('.rk-rmd-attrs-decoration').count();
 assert.ok(attrsCount>=3,'valid attrs have inert visible decorations');
 assert.ok((await visual.locator('.rk-rmd-attrs-decoration').first().textContent()).includes('visual-rmd'));
 assert.equal(await visual.locator('.rk-rmd-invalid-attrs').count(),1,'invalid attrs only styled as raw text');
 assert.ok(await visual.getByText('编辑时必须可见').count()>=1);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'opening does not dirty');
 assert.equal((await json('/records/'+id)).body.content,input,'initial parsing cannot write D1');
 // Human edit, then preview must show latest UNSAVED draft while D1 is unchanged.
 await visual.getByText('普通内容末尾。').last().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' USER_EDIT_RMD');
 await page.getByRole('button',{name:'保存',exact:true}).waitFor({state:'visible'});
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isEnabled());
 await page.getByRole('button',{name:'预览',exact:true}).click();
 const preview=page.locator('.markdown-preview').first();
 await preview.waitFor();
 assert.ok((await preview.textContent()).includes('USER_EDIT_RMD'),'preview uses current unsaved draft');
 assert.ok(!(await preview.textContent()).includes('编辑时必须可见'),'comment hidden in preview');
 assert.ok(!(await preview.textContent()).includes('块注释必须可编辑'),'block comment hidden in preview');
 assert.ok((await preview.textContent()).includes('@ attrs | width=abc @'),'invalid attrs are literal preview text');
 assert.equal(await preview.locator('.rk-rmd-attrs-decoration').count(),0,'preview has no edit decorations');
 assert.equal(await preview.locator('#user-content-code-visual').count(),1,'preview code anchor is accessible');
 assert.ok((await preview.textContent()).includes('章节：Visual RMD QA')&&(await preview.textContent()).includes('代码：demo.ts'),'preview resolves unnumbered local references');
 assert.equal((await json('/records/'+id)).body.content,input,'preview switch cannot commit D1');
 await page.getByRole('button',{name:'源码',exact:true}).click();
 const cm=page.locator('.cm-content');await cm.waitFor();
 // CodeMirror virtualizes invisible lines: DOM innerText is not the whole
 // editor document. Inspect the mounted editor view's actual state instead.
 const text=await cm.evaluate(el=>el.cmTile?.root?.view?.state?.doc?.toString()??'');
 assert.ok(text.length>input.length/2,'must inspect the complete CodeMirror state, not its virtual DOM');
 for(const marker of [':: mark',':: highlight','%%','@ attrs tbl-test','[[#fig-device]]','USER_EDIT_RMD'])
  assert.ok(text.includes(marker),'source has RMD canonical '+marker+' in '+text.slice(0,600));
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await visual.waitFor();
 assert.ok(await visual.getByText(/USER_EDIT_RMD/).count()>0,'visual retains new content');
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isEnabled());
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  return r.ok&&(await r.json()).content.includes('USER_EDIT_RMD');
 },id,{timeout:20000});
 // Local Worker reads can briefly disagree after a write; require three
 // independent no-store reads to observe the same committed revision.
 await page.waitForFunction(async recordId=>{
  const samples=await Promise.all([1,2,3].map(async()=>{
   const response=await fetch('/api/records/'+recordId,{cache:'no-store'});
   return response.ok?String((await response.json()).content??''):'';
  }));
  return samples.every(value=>value.includes('USER_EDIT_RMD'));
 },id,{timeout:20000});
 const saved=(await json('/records/'+id)).body.content;
 for(const marker of ['文中','状态','标准',':: mark',':: highlight','@ attrs tbl-test','%%','USER_EDIT_RMD','[站点](https://example.com "链接标题")','![实验装置](device.png "图片标题")','[[#code-visual]]'])
  assert.ok(saved.includes(marker),'saved retains '+marker+' in '+saved);
 await page.reload({waitUntil:'domcontentloaded'});
 await visual.waitFor();
 assert.ok(await visual.locator('.rk-inline-badge').count()>=2,'reload preserved rich badge nodes');
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'reload is clean');
 const bg=await visual.locator('mark:not([data-rk-color])').first().evaluate(node=>getComputedStyle(node).backgroundColor);
 assert.equal(bg,'rgb(245, 216, 112)','Mark visual unchanged');
 // The removed @tiptap/markdown dependency must not disable real slash
 // commands still provided by StarterKit. Test actual menu + ProseMirror.
 await visual.locator('p').last().click();
 await page.keyboard.press('Control+End');
 await page.keyboard.press('Enter');
 await page.keyboard.type('/分割线');
 const slash=page.getByRole('listbox',{name:'插入内容'});
 await slash.waitFor({state:'visible'});
 await slash.getByRole('option',{name:/分割线/}).first().click();

 assert.ok(await visual.locator('hr').count()>=1,
  'slash structural insertion must remain functional; quotation is now a toolbar state');
 assert.deepEqual(errors,[],'client page errors');
 console.log('PASS RMD visual/preview/source unsaved edit, safe save/reload, Mark color, comments, table, math, slash action');
}finally{await browser.close().catch(()=>{});}
