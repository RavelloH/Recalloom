import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(bin&&line,'Local browser and auth required');
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const raw=[
 '---',
 'title: 这是正文内容，不是数据库元信息',
 'tags: [演示, 仅作为文本]',
 '---',
 '',
 '# 工程知识',
 '',
 '![系统架构](https://example.com/a.png){width=480 caption="原始图注"}',
 '',
 '![普通图片](https://example.com/a.png)',
 '',
 '::::glossary[专业术语]',
 '',
 ':::definition[DO]',
 '',
 '**Durable Objects** 提供有状态计算。',
 '',
 ':::',
 '',
 ':::definition[D1]',
 '',
 '可查询的 SQL 存储。',
 '',
 '- 版本控制',
 '- 数据检索',
 '',
 ':::',
 '',
 '::::',
 '',
 '正文保持可编辑。'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage({viewport:{width:1420,height:900}});
page.setDefaultTimeout(16000);
const errors=[];
page.on('pageerror',err=>errors.push(err.message));
const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAcIBfz0r3j8AAAAASUVORK5CYII=','base64');
await page.route('https://example.com/a.png',async route=>route.fulfill({status:200,contentType:'image/png',body:transparent}));
async function create(content,name){
 const result=await page.evaluate(async({content,name})=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'document',name,content})});
  return {status:r.status,data:await r.json()};
 },{content,name});
 assert.equal(result.status,201,JSON.stringify(result).slice(0,350));
 return result.data.id;
}
async function read(id){return page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()),id);}
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded',timeout:24000});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:20000});
 const id=await create(raw,'Figure glossary '+Date.now()+'.md');
 await page.goto(base+'/records/'+id,{waitUntil:'domcontentloaded',timeout:23000});
 await page.locator('.tiptap').waitFor();
 const plain=page.locator('.tiptap p[data-raw-markdown]').first();
 await plain.waitFor();
 assert.ok((await plain.textContent())?.includes('title: 这是正文内容'),'YAML-looking header is visible plain prose');
 assert.equal(await page.locator('.tiptap [data-rk-frontmatter]').count(),0,'No metadata card exists');
 assert.equal(await page.locator('.tiptap .rk-rich-figure').count(),2,'Both captioned and plain images remain visible');
 const figure=page.locator('.tiptap figure.rk-rich-figure').first();
 await figure.scrollIntoViewIfNeeded();
 assert.equal(await figure.locator('.rk-rich-figcaption').textContent(),'原始图注');
 assert.equal(await figure.locator('img').evaluate(x=>x.style.width),'480px');
 const gloss=page.locator('.tiptap [data-rk-kind="glossary"]').first();
 assert.equal(await gloss.locator('[data-rk-kind="definition"]').count(),2,'Two editable glossary entries');
 assert.ok((await gloss.textContent())?.includes('Durable Objects'));
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),'initial open should not be dirty');
 const original=await read(id);
 assert.equal(original.content,raw,'initial visual load cannot rewrite document');
 await figure.click();
 const caption=figure.getByRole('textbox',{name:'图注（可选）'});
 await caption.waitFor();
 await caption.fill('更新后的图注');
 await caption.press('Tab');
 assert.ok(await page.getByRole('button',{name:'保存'}).isEnabled(),'editing figure caption should mark document dirty');
 await page.getByRole('button',{name:'保存'}).click();
 // Save is disabled immediately while the async PATCH is still in flight.
 // Wait for the *persisted* revision/content instead of the button state.
 await page.waitForFunction(async id=>{
  const response=await fetch('/api/records/'+id);
  if(!response.ok)return false;
  const record=await response.json();
  return record.content?.includes('caption="更新后的图注"');
 },id,{timeout:24000,polling:250});
 const saved=await read(id);
 assert.ok(saved.content.includes('caption="更新后的图注"'),saved.content.slice(0,250));
 assert.ok(saved.content.includes('width=480'),'Image size must survive');
 assert.ok(saved.content.includes(':::definition[DO]'),'Glossary must survive');
 assert.ok(saved.content.includes('![普通图片](https://example.com/a.png)'),'Normal image must survive');
 assert.ok(saved.content.startsWith('---\ntitle: 这是正文内容，不是数据库元信息'),'Document header remains literal source');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('.tiptap .rk-rich-figure').first().waitFor();
 assert.equal(await page.locator('.tiptap .rk-rich-figcaption').first().textContent(),'更新后的图注');
 const embed=await create('# 嵌入视图\n\n{{embed:id:'+id+'}}','Figure glossary embed '+Date.now()+'.md');
 await page.goto(base+'/records/'+embed,{waitUntil:'domcontentloaded',timeout:23000});
 const projection=page.locator('.markdown-preview');
 await projection.first().waitFor();
 const figurePreview=projection.locator('figure.rk-rich-figure-projection').first();
 await figurePreview.waitFor({timeout:25000});
 assert.equal(await figurePreview.locator('figcaption').textContent(),'更新后的图注');
 assert.equal(await figurePreview.locator('img').evaluate(el=>el.style.width),'480px');
 assert.equal(await projection.locator('.rk-glossary-read').count(),1);
 assert.equal(await projection.locator('.rk-definition-read').count(),2);
 assert.ok((await projection.locator('.rk-verbatim-document-text').first().textContent())?.includes('title:'),'Wiki projection must show header as literal text');
 assert.deepEqual(errors,[]);
 console.log('PASS metadata-is-text, rich figures with editable caption, ordinary image compatibility, glossary roundtrip and Wiki projection');
}finally{await browser.close().catch(()=>{});}
