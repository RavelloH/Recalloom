import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8793';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const path=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const credential=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(v=>/^MCP_AUTH_SECRET\s*=/.test(v));
assert.ok(path&&credential);
const secret=credential.slice(credential.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({headless:true,executablePath:path,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1100,height:850}});
page.setDefaultTimeout(18000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const source=[
 '# Review Markdown and finalized syntax','',
 'a == b 且 c == d，==x==，<mark>强调</mark>，:highlight[警告]{color=red}。','',
 '用户注释 %%始终可见%% 与 **普通粗体**。','',
 '> [!NOTE]','> 来自 GitHub 的提示框。','',
 '按 <kbd>Ctrl</kbd> + <kbd>S</kbd>，:tooltip[悬浮]{content="这里有说明"}。','',
 '正文 **加粗** <unknown-chip data-key="1"/> 继续 **加粗**。','',
 '~~~json','{"review":"{++THIS_IS_CODE++}"}','~~~','',
 '新增 {++QA_ADD++} 删除 {--QA_DEL--} 替换 {~~QA_OLD~>QA_NEW~~} 高亮 {==QA_HIGHLIGHT==} 批注 {>>QA_COMMENT<<}。','',
 '<details>','<summary>问题 [v2]</summary>','','继续填写 **答案**。','</details>','',
 ':::tab[无父级]','','它只能作为原文。','',':::'
].join('\n');
const json=async (endpoint,options)=>page.evaluate(async ({endpoint,options})=>{
 const response=await fetch('/api'+endpoint,options);
 return {status:response.status,data:await response.json()};
},{endpoint,options});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:22000});
 const created=await json('/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'document',name:'Rich review E2E '+Date.now()+'.md',content:source})});
 assert.equal(created.status,201,JSON.stringify(created));
 const id=created.data.id;
 await page.goto(base+'/records/'+id,{waitUntil:'domcontentloaded'});
 const editor=page.locator('.tiptap');await editor.waitFor({timeout:23000});
 assert.equal(await editor.locator('[data-rk-critic]').count(),5);
 assert.equal(await editor.locator('[data-rk-kind="note"]').count(),1,'GitHub NOTE must become callout');
 assert.equal(await editor.locator('[data-rk-kind="details"]').count(),1,'HTML details must be editable');
 assert.equal(await editor.locator('[data-rk-kind="tab"]').count(),0,'orphan tab must not become a rich child');
 assert.ok(await editor.locator('[data-raw-markdown]').count()>=1);
 assert.ok(await editor.locator('[data-raw-inline]').count()>=1);
 assert.ok(await editor.locator('.rk-inline-kbd').count()>=2);
 assert.ok(await editor.locator('.rk-inline-tooltip').count()>=1);
 assert.ok(await editor.getByText('始终可见').count()>0);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'opening never changes source');
 assert.equal((await json('/records/'+id)).data.content,source);
 await editor.locator('[data-rk-critic="addition"] .rk-critic-accept').click();
 await editor.locator('[data-rk-critic="deletion"] .rk-critic-accept').click();
 await editor.locator('[data-rk-critic="substitution"] .rk-critic-reject').click();
 await editor.locator('[data-rk-critic="highlight"] .rk-critic-accept').click();
 await editor.locator('[data-rk-critic="comment"] .rk-critic-actions button').click();
 assert.equal(await editor.locator('[data-rk-critic]').count(),0);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isEnabled());
 assert.equal((await json('/records/'+id)).data.content,source);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  if(!r.ok)return false;
  const s=(await r.json()).content;
  return s.includes('QA_ADD')&&s.includes('QA_OLD')&&!s.includes('QA_DEL')&&!s.includes('QA_NEW')&&!s.includes('{++QA_ADD++}');
 },id,{timeout:22000,polling:200});
 const saved=(await json('/records/'+id)).data.content;
 const normalizedSaved=saved.replaceAll('\\_','_');
 for(const token of ['QA_ADD','QA_OLD','<mark>QA_HIGHLIGHT</mark>','<unknown-chip data-key="1"/>','a == b 且 c == d'])
  assert.ok(normalizedSaved.includes(token),'missing '+token+' from '+saved);
 assert.ok(!saved.includes('QA_COMMENT'));
 await page.reload({waitUntil:'domcontentloaded'});await editor.waitFor();
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled());
 const host=await json('/records',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({kind:'document',name:'Rich readonly E2E '+Date.now()+'.md',content:'# Wiki read-only\n\n{{embed:id:'+id+'}}'})});
 assert.equal(host.status,201,JSON.stringify(host));
 await page.goto(base+'/records/'+host.data.id,{waitUntil:'domcontentloaded'});
 const read=page.locator('.markdown-preview');await read.first().waitFor({timeout:20000});
 assert.ok(await read.locator('mark').count()>=2);
 assert.ok(await read.getByText('始终可见').count()>0);
 assert.ok((await read.textContent()).includes('==x=='));
 assert.ok(await read.locator('kbd').count()>=2);
 assert.ok(await read.locator('.rk-callout-heading').count()>=1);
 // A Wiki alias inside a GFM table must escape \| in source, then
 // produce exactly two columns and an ordinary interactive Wiki reference.
 const tableContent='| 项目 | 引用 |\n| --- | --- |\n| A | [[id:'+id+'\\|引用别名]] |';
 const tableFixture=await json('/records',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({kind:'document',name:'Wiki GFM alias E2E '+Date.now()+'.md',content:tableContent})});
 assert.equal(tableFixture.status,201,JSON.stringify(tableFixture));
 await page.goto(base+'/records/'+tableFixture.data.id,{waitUntil:'domcontentloaded'});
 const table=page.locator('.tiptap table');await table.first().waitFor({timeout:20000});
 assert.equal(await table.locator('tbody tr').last().locator('td').count(),2,'Wiki | alias must not add a table column');
 assert.ok((await table.textContent()).includes('引用别名'),'Wiki alias should be legible in visual table');
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'opening escaped table must not create an edit');
 assert.deepEqual(errors,[]);
 console.log('PASS review accept/reject/resolve, source persistence, HTML, alerts, inline raw, Wiki embedding, escaped GFM aliases');
}finally{await browser.close().catch(()=>{});}
