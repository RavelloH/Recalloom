import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';

const candidates=[
 process.env.CHROMIUM_PATH,
 '/usr/bin/chromium-headless-shell','/usr/bin/chromium',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const executablePath=candidates.find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(v=>/^MCP_AUTH_SECRET\s*=/.test(v));
const secret=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(executablePath&&secret,'Missing local-only test browser or auth secret');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Must never run fixture writes against production');
// The original private note is used only when a local ignored fixture exists.
 // In clean clones, run the same semantics against a synthetic public fixture.
const tick=String.fromCharCode(96);
const demo=[
 '# Test power systems overview',
 '',
 '## Part A',
 '- Frequency: <mark>50 Hz</mark>.',
 '- Nominal voltage: <mark>'+tick+'1.05 U_N'+tick+'</mark>.',
 ...Array.from({length:8},(_,i)=>'- Parameter '+i+': <mark>'+tick+'R_'+i+' = U_N^2/S_N'+tick+'</mark>.'),
 '',
 '## Part B',
 ...Array.from({length:5},(_,i)=>'- Highlight '+i+': <mark>Learning concept '+i+'</mark>.'),
 '',
 '## Part C',
 'This section tests that editing a note does not delete its rich text.'
].join('\n');
const doc=process.env.RECALLOOM_TEST_SYNTHETIC==='1'||!existsSync('tmp/electric-power-notes.md')
 ?demo:readFileSync('tmp/electric-power-notes.md','utf8');
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:950}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const get=async(path,method='GET',payload)=>page.evaluate(async({path,method,payload})=>{
 const response=await fetch('/api'+path,{method,headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});
 return {status:response.status,data:await response.json().catch(()=>({}))};
},{path,method,payload});
const good=(item,status,label)=>{assert.equal(item.status,status,label+' '+JSON.stringify(item.data).slice(0,300));return item.data};
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const header=()=>page.locator('.topbar').evaluate(el=>({display:getComputedStyle(el).display,height:el.getBoundingClientRect().height}));
 await page.goto(base+'/',{waitUntil:'networkidle'});
 const empty=await header();
 assert.equal(empty.display,'none','desktop pages with no topbar portals must not show an empty header');
 await page.getByRole('button',{name:'折叠侧边栏'}).click();
 const collapsed=await header();
 assert.notEqual(collapsed.display,'none','collapsed sidebar keeps its navigation recovery');
 await page.getByRole('button',{name:'展开侧边栏'}).click();

 const created=good(await get('/records','POST',{name:'Power-visual-'+Date.now()+'.md',kind:'document',content:doc}),201,'create private fixture');
 await page.goto(base+'/records/'+created.id,{waitUntil:'networkidle'});
 await page.locator('.tiptap').waitFor({timeout:18000});
 const recordHeader=await header();
 assert.notEqual(recordHeader.display,'none','record pages with actions keep the topbar');
 const initial=await page.locator('.tiptap').evaluate(el=>({
  headings:el.querySelectorAll('h1,h2,h3').length,
  highlights:el.querySelectorAll('mark').length,
  markedCode:el.querySelectorAll('mark code').length,
  sourceBlocks:el.querySelectorAll('.raw-markdown-node').length,
  headingContent:el.querySelector('h1')?.textContent,
  text:el.textContent?.slice(0,170)
 }));
 console.log('VISUAL_DOCUMENT',JSON.stringify(initial));
 assert.ok(initial.headings>=4,'original Markdown headings are rich-text headings');
 assert.equal(initial.highlights,15,'15 real highlights are rich text (the intro contains one literal code example)');
 assert.ok(initial.markedCode>=8,'inline code is still nested inside highlights');
 assert.equal(initial.sourceBlocks,0,'supported text needs no literal fallback');
 assert.equal(await page.getByRole('button',{name:'预览'}).count(),0,'only visual and source modes remain');
 assert.equal(await page.getByText(/已保护.*Markdown 原文/).count(),0);
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),'opening rich editor does not dirty original');
 assert.equal(good(await get('/records/'+created.id),200,'read first').content,doc,'opening a document cannot modify stored Markdown');
 await page.screenshot({path:'tmp/vps-visual-power-before.png'});

 // Real edit and save: highlight must survive serialization.
 const editor=page.locator('.tiptap');
 await editor.locator('p').last().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' Visual edit verified.');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{
  const response=await fetch('/api/records/'+id);return response.ok&&(await response.json()).content.includes('Visual edit verified.');
 },created.id,{timeout:20000});
 const saved=good(await get('/records/'+created.id),200,'rich edit saved');
 assert.ok(saved.content.includes('<mark>50 Hz</mark>'));
 assert.ok(saved.content.includes('<mark>'+tick+'1.05 U_N'+tick+'</mark>'),'highlighted code is retained');
 assert.ok(saved.content.includes('Visual edit verified.'));
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.waitForTimeout(550);
 await page.locator('.cm-content').waitFor();
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap mark').first().waitFor();
 assert.equal(await page.locator('.raw-markdown-node').count(),0);
 await page.screenshot({path:'tmp/vps-visual-power-after.png'});

 // Unsupported HTML is ordinary editable text, not a source block.
 const fallbackText='# Before\n\n<div class="unsupported">No special support</div>\n\n<mark> left open.\n\n[^note]: a literal footnote.\n\n## After\n\nSome **ordinary** text.';
 const fallback=good(await get('/records','POST',{name:'Plain-fallback-'+Date.now()+'.md',kind:'document',content:fallbackText}),201,'unknown fixture');
 await page.goto(base+'/records/'+fallback.id,{waitUntil:'networkidle'});
 await page.locator('.tiptap').waitFor();
 await page.waitForFunction(()=>document.querySelector('.tiptap')?.textContent?.includes('No special support'),null,{timeout:12000});
 const plain=await page.locator('.tiptap').textContent();
 assert.ok(plain.includes('<div class="unsupported">No special support</div>'));
 assert.ok(plain.includes('a literal footnote.'),'new GFM footnote definition should remain visible');
 assert.equal(await page.locator('.tiptap [data-rk-footnote-definition]').count(),1,'supported footnote should be a structured editable node');
 assert.ok(await page.locator('.tiptap [data-raw-markdown]').count()>=2,'unknown syntax is editable prose');
 assert.equal(await page.locator('.tiptap [data-raw-markdown]').first().evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled());
 await page.locator('.tiptap h2').last().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' changed');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{
  const response=await fetch('/api/records/'+id);
  return response.ok&&(await response.json()).content.includes('## After changed');
 },fallback.id,{timeout:20000});
 const fallbackSaved=good(await get('/records/'+fallback.id),200,'raw fallback preserved');
 assert.ok(fallbackSaved.content.includes('<div class="unsupported">No special support</div>'),fallbackSaved.content);
 assert.ok(fallbackSaved.content.includes('<mark> left open.'),fallbackSaved.content);
 assert.ok(fallbackSaved.content.includes('[^note]: a literal footnote.'),fallbackSaved.content);
 assert.ok(!fallbackSaved.content.includes('\\<div'),fallbackSaved.content);
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap h2').last().waitFor();
 await page.goto(base+'/records/'+fallback.id+'?mode=preview',{waitUntil:'networkidle'});
 await page.locator('.tiptap').waitFor();
 assert.equal(await page.locator('[data-mode="visual"]').count(),1,'old preview URL opens visual mode');
 await page.locator('.tiptap p[data-raw-markdown]').first().click();
 await page.keyboard.type(' DIRECT_RAW_EDIT');
 assert.ok(await page.getByRole('button',{name:'保存'}).isEnabled(),'unknown Markdown remains directly editable');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{
  const response=await fetch('/api/records/'+id);
  return response.ok&&(await response.json()).content.includes('DIRECT_RAW_EDIT');
 },fallback.id,{timeout:20000});
 const rawEdited=good(await get('/records/'+fallback.id),200,'edited raw text');
 assert.ok(rawEdited.content.includes('DIRECT_RAW_EDIT'));
 assert.ok(!rawEdited.content.includes('\\<div'),'unknown HTML stays literal');
 await page.reload({waitUntil:'networkidle'});
 await page.locator('.tiptap [data-raw-markdown]').first().waitFor();
 assert.ok((await page.locator('.tiptap').textContent()).includes('DIRECT_RAW_EDIT'));
 // The mobile hamburger must always remain available even on an empty page.
 await page.setViewportSize({width:390,height:844});
 await page.goto(base+'/',{waitUntil:'networkidle'});
 const mobile=await header();
 assert.notEqual(mobile.display,'none');
 assert.ok(await page.getByRole('button',{name:'打开导航'}).isVisible());
 console.log('HEADERS',JSON.stringify({empty,collapsed,recordHeader,mobile}));
 assert.deepEqual(errors,[],'no unhandled browser errors');
 console.log('PASS visual first + no empty header + original Markdown unchanged until actual edit');
}finally{await browser.close()}
