import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const origin=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(browserPath&&secretLine);
const secret=secretLine.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const raw=[
 '# Cross-reference visual editor',
 '',
 '![架构图](https://example.com/a.png){#fig-architecture width=480 caption="系统架构"}',
 '',
 '$$',
 'P=UI',
 '$$ {#eq-power}',
 '',
 '| 参数 | 数值 |',
 '| :--- | ---: |',
 '| 电压 | 220 |',
 '',
 ': 系统参数 {#tbl-params}',
 '',
 '参见 @fig-architecture、@eq-power、@tbl-params 以及 @eq-missing。',
 '',
 '代码中的引用 '+String.fromCharCode(96)+'@fig-architecture'+String.fromCharCode(96)+' 不应显示。',
 '',
 '~~~markdown',
 '@eq-pretend',
 '$$',
 'x',
 '$$ {#eq-pretend}',
 '~~~'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
page.setDefaultTimeout(18000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAcIBfz0r3j8AAAAASUVORK5CYII=','base64');
await page.route('https://example.com/a.png',route=>route.fulfill({status:200,contentType:'image/png',body:png}));
const read=async id=>page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()),id);
const create=async content=>{
 const r=await page.evaluate(async content=>{const res=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'document',name:'Cross-ref E2E '+Date.now()+'.md',content})});return {status:res.status,data:await res.json()};},content);
 assert.equal(r.status,201,JSON.stringify(r));
 return r.data.id;
};
try{
 await page.goto(origin+'/login',{waitUntil:'domcontentloaded',timeout:25000});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/',{timeout:25000});
 const id=await create(raw);
 await page.goto(origin+'/records/'+id,{waitUntil:'domcontentloaded'});
 const editor=page.locator('.tiptap');await editor.waitFor({timeout:25000});
 const figure=editor.locator('[data-rk-figure-id="fig-architecture"]');await figure.waitFor();
 const equation=editor.locator('[data-rk-equation-id="eq-power"]');await equation.waitFor();
 const table=editor.locator('.rk-hscroll[data-rk-table-id="tbl-params"]');await table.waitFor();
 assert.ok((await figure.textContent())?.includes('图 1'));
 assert.equal(await editor.locator('[data-rk-cross-ref]').count(),4);
 for(const [id,label] of [['fig-architecture','图 1'],['eq-power','公式 1'],['tbl-params','表 1']]){
  const ref=editor.locator('[data-rk-cross-ref="'+id+'"]');
  assert.ok((await ref.textContent())?.includes(label),'ref '+id+' expected '+label);
 }
 assert.ok((await editor.locator('[data-rk-cross-ref="eq-missing"]').textContent())?.includes('引用不存在'));
 assert.equal(await editor.locator('[data-rk-equation-id="eq-pretend"]').count(),0);
 assert.equal(await editor.locator('[data-rk-cross-ref="eq-pretend"]').count(),0);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'open must not be dirty');
 assert.equal((await read(id)).content,raw);
 const sourceProps={
  figId:await figure.getAttribute('id'),
  eqId:await equation.getAttribute('id'),
  tblId:await table.getAttribute('id')
 };
 console.log('VISUAL_ANCHORS',JSON.stringify(sourceProps));
 // NodeView inline reference click scrolls to the original node.
 const ref=editor.locator('[data-rk-cross-ref="fig-architecture"]');
 await ref.scrollIntoViewIfNeeded();await ref.locator('a').click();
 assert.equal(await figure.getAttribute('id'),'user-content-fig-architecture');
 // Edit equation ID in the existing interactive formula dialog.
 await equation.scrollIntoViewIfNeeded();await equation.click();
 const dialog=page.getByRole('dialog',{name:'编辑数学公式'});
 await dialog.waitFor({timeout:18000});
 const idInput=dialog.getByRole('textbox',{name:'公式 ID（可选，eq-...）'});
 assert.equal(await idInput.inputValue(),'eq-power');
 await idInput.fill('eq-renamed');
 await dialog.getByRole('button',{name:'更新',exact:true}).click();
 await editor.locator('[data-rk-equation-id="eq-renamed"]').waitFor();
 assert.ok((await editor.locator('[data-rk-cross-ref="eq-power"]').textContent())?.includes('引用不存在'),'old reference should fail explicitly');
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isEnabled(),'editing ID should mark dirty');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  return r.ok&&(await r.json()).content.includes('$$ {#eq-renamed}');
 },id,{timeout:22000,polling:200});
 const stored=await read(id);
 assert.ok(stored.content.includes('$$\nP=UI\n$$ {#eq-renamed}'),stored.content);
 assert.ok(stored.content.includes(': 系统参数 {#tbl-params}'),stored.content);
 assert.ok(stored.content.includes('![架构图](https://example.com/a.png){#fig-architecture'),stored.content);
 assert.ok(stored.content.includes('```markdown')||stored.content.includes('~~~markdown'),'code fences should remain present even if normalized');
 assert.ok(stored.content.includes('@eq-pretend')&&stored.content.includes('{#eq-pretend}'),'code fence body must remain unchanged');
 await page.reload({waitUntil:'domcontentloaded'});
 await editor.locator('[data-rk-equation-id="eq-renamed"]').waitFor();
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled());
 const host=await create('# Embedded cross references\n\n{{embed:id:'+id+'}}');
 await page.goto(origin+'/records/'+host,{waitUntil:'domcontentloaded'});
 const preview=page.locator('.markdown-preview');await preview.first().waitFor({timeout:23000});
 const eqPreview=preview.locator('.rk-numbered-math-projection');await eqPreview.first().waitFor({timeout:21000});
 assert.ok(await eqPreview.first().locator('.katex').count()>=1,'numbered read-only equation must render KaTeX, not raw code');
 assert.equal(await preview.locator('.rk-rich-figure-projection[data-rk-figure-id="fig-architecture"]').count(),1);
 assert.equal(await eqPreview.getAttribute('id'),'user-content-eq-renamed');
 assert.ok((await eqPreview.first().textContent())?.includes('1'),'equation number in wiki');
 assert.equal(await preview.locator('.rk-table-caption-read').textContent(),'系统参数');
 for(const [id,label] of [['fig-architecture','图 1'],['tbl-params','表 1']]){
  const ref=preview.locator('.rk-cross-reference-read[href="#user-content-'+id+'"]');
  assert.ok((await ref.textContent())?.includes(label),'Wiki ref '+id);
 }
 const missing=preview.locator('.rk-cross-reference-missing');
 assert.ok((await missing.allTextContents()).some(t=>t.includes('eq-power')||t.includes('eq-missing')));
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  const bounds=await preview.first().evaluate(x=>({scroll:x.scrollWidth,width:x.clientWidth}));
  assert.ok(bounds.scroll<=bounds.width+2,'Wiki viewport '+width+' should not overflow '+JSON.stringify(bounds));
 }
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'Wiki embeds should not dirty');
 assert.deepEqual(errors,[]);
 console.log('PASS cross-ref figure/equation/table IDs, numbered links, source roundtrip, equation dialog edit, save/reload, 390/320 Wiki projection, no phantom writes');
}finally{await browser.close().catch(()=>{});}
