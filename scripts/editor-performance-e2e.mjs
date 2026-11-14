/** Large-document behavior and lazy table scrolling, in isolated local D1. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const engine=process.env.RECALLOOM_TEST_ENGINE==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x)):undefined;
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const mobile=process.env.RECALLOOM_TEST_MOBILE==='1';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executable?{executablePath:executable}:{})});
const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1365,height:900},isMobile:mobile,hasTouch:mobile});
page.setDefaultTimeout(25000);
// Forward production __Host- cookies only on this WebKit HTTP loopback test.
if(engine==='webkit'){
 let cookie='';
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(request.url().endsWith('/api/auth/login')){
   const response=await route.fetch();
   cookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
   await route.fulfill({response});return;
  }
  if(!cookie){await route.continue();return;}
  await route.fulfill({response:await route.fetch({headers:{...(await request.allHeaders()),cookie}})});
 });
}
const faults=[];page.on('pageerror',error=>faults.push(error.message));
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const sections=Array.from({length:48},(_,i)=>[
 '## Section '+i,'','| Key | Value |','| --- | --- |','| A | B |','',
 'Text with :: circle $\\frac{P^2+Q^2}{U^2}R$ | color=blue :: and **bold** words.','',
 '$$','\\dot U_1=\\dot U_2+\\frac{P R+Q X}{U_2}','$$',''
].join('\n')).join('\n');
const wide='| '+Array.from({length:16},(_,i)=>'Column'+i).join(' | ')+' |\n'+
 '| '+Array(16).fill('---').join(' | ')+' |\n'+
 '| '+Array(16).fill('WideValue').join(' | ')+' |';
const content='# Performance fixture\n\nEditable paragraph for performance checks.\n\n'+sections+'\n'+wide+'\n';
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const record=await page.evaluate(async content=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Editor performance '+Date.now()+'.md',kind:'document',content})});
  if(!response.ok)throw Error('Cannot create fixture');
  return response.json();
 },content);
 await page.goto(base+'/records/'+record.id+'?mode=source');
 await page.locator('.cm-content').waitFor();
 const start=performance.now();
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.tiptap table').length===49);
 await page.evaluate(()=>document.fonts.ready);
 await settle();
 const loadMs=Math.round(performance.now()-start);
 const first=page.locator('.tiptap .tableWrapper').first();
 const last=page.locator('.tiptap .tableWrapper').last();
 await page.evaluate(()=>{
  const tables=document.querySelectorAll('.tiptap table');
  window.__perfTableIdentity={first:tables[0],last:tables[tables.length-1]};
 });
 assert.equal(await first.locator('.os-scrollbar').count(),0,'fitting tables must not initialize overlay scrollbars');
 assert.equal(await last.locator('.os-scrollbar').count(),0,'distant tables must not initialize overlay scrollbars');
 await last.scrollIntoViewIfNeeded();
 const overlay=await page.evaluate(()=>document.documentElement.dataset.scrollbarMode==='overlay');
 if(engine==='chromium')assert.equal(overlay,true,'Chromium must exercise the overlay scrollbar path');
 if(overlay)await last.locator('.os-scrollbar-horizontal').waitFor({state:'attached'});
 await page.waitForFunction(()=>{
  const viewport=[...document.querySelectorAll('.tiptap .tableWrapper .rk-scroll-viewport')].at(-1);
  return viewport.scrollWidth>viewport.clientWidth+1;
 });
 await last.locator('.rk-scroll-viewport').evaluate(viewport=>{viewport.scrollLeft=viewport.scrollWidth;});
 await page.waitForFunction(()=>[...document.querySelectorAll('.tiptap .tableWrapper')].at(-1)?.hasAttribute('data-edge-start'));
 assert.ok(await page.evaluate(()=>{
  const tables=document.querySelectorAll('.tiptap table');
  return tables[0]===window.__perfTableIdentity.first&&tables[tables.length-1]===window.__perfTableIdentity.last;
 }),'initializing scrolling must preserve ProseMirror table DOM');
 console.log('PASS fitting/offscreen tables stay lightweight; wide tables scroll without replacing editable DOM');

 const paragraph=page.locator('.tiptap p').filter({hasText:'Editable paragraph for performance checks.'}).first();
 await paragraph.click();await page.keyboard.press('End');
 const initialCount=await page.locator('.workbench-character-count').getAttribute('aria-label').then(label=>Number(label.replace('字数 ','')));
 await page.keyboard.type('0123456789');await page.keyboard.insertText('😀中文');
 await page.locator('.save-status').getByText('未保存').waitFor();
 await page.waitForFunction(expected=>document.querySelector('.workbench-character-count')?.getAttribute('aria-label')==='字数 '+expected,initialCount+13);
 // WebKit's End key may place the caret inside a line on touch viewports.
 // Assert the edit itself without assuming the original sentence stays whole.
 assert.match(await page.locator('.tiptap').innerText(),/0123456789😀中文/);
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>!document.querySelector('.tiptap').textContent.includes('0123456789'));
 await page.locator('.save-status').getByText('已保存').waitFor();
 await page.waitForFunction(expected=>document.querySelector('.workbench-character-count')?.getAttribute('aria-label')==='字数 '+expected,initialCount);
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('recalloom:draft:')).length),0);
 console.log('PASS large-document typing, latest Unicode character count and undo-to-clean recovery');

 await first.locator('td p,th p').first().click();await page.keyboard.press('End');
 const expansion='W'.repeat(240);
 await page.keyboard.insertText(expansion);
 if(overlay)await first.locator('.os-scrollbar-horizontal').waitFor({state:'attached'});
 await page.waitForFunction(()=>{
  const viewport=document.querySelector('.tiptap .tableWrapper .rk-scroll-viewport');
  return viewport.scrollWidth>viewport.clientWidth+1;
 });
 await page.locator('.save-status').getByText('未保存').waitFor();
 // The status transition briefly retains its exiting "saved" label.
 // Await the actual PATCH acknowledgement before reading persisted content.
 const acknowledgement=page.waitForResponse(response=>
  response.url()===base+'/api/records/'+record.id+'/content'&&response.request().method()==='PATCH');
 await page.keyboard.press('Control+s');
 assert.equal((await acknowledgement).status(),200);
 await page.locator('.save-status').getByText('已保存').waitFor();
 const saved=await page.evaluate(async id=>(await fetch('/api/records/'+id)).json(),record.id);
 assert.ok(saved.content.includes(expansion),'Save must capture the latest edit while count work is pending');
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 const source=await page.evaluate(()=>document.querySelector('.cm-content')?.cmTile?.root?.view.state.doc.toString());
 assert.equal(source,saved.content,'mode switching must use exactly the saved canonical Markdown');
 await page.reload();await page.locator('.cm-content').waitFor();
 assert.equal(await page.getByText('已恢复本标签页未保存的草稿').count(),0);
 console.log('PASS table growth, immediate Save, mode switch and clean reload',JSON.stringify({engine,mobile,loadMs}));

 // Compatibility: table node views are still detached in their constructor.
 // The observer fallback must wait for connection; blocked Workers must keep
 // the exact character count without preventing editing.
 const fallback=await page.evaluate(async()=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Observer fallback.md',kind:'document',content:'# Fallback\n\nFallback paragraph.\n\n| A | B |\n| --- | --- |\n| C | D |'})});
  return response.json();
 });
 await page.addInitScript(()=>{
  window.IntersectionObserver=undefined;
  window.Worker=class{constructor(){throw Error('Worker blocked for fallback coverage');}};
 });
 await page.goto(base+'/records/'+fallback.id+'?mode=visual');
 await page.locator('.tiptap table').waitFor();
 if(overlay)await page.locator('.tiptap .tableWrapper .os-scrollbar-horizontal').waitFor({state:'attached'});
 const fallbackCount=await page.locator('.workbench-character-count').getAttribute('aria-label').then(label=>Number(label.replace('字数 ','')));
 await page.locator('.tiptap p').filter({hasText:'Fallback paragraph.'}).click();
 await page.keyboard.press('End');await page.keyboard.insertText('XYZ');
 await page.waitForFunction(expected=>document.querySelector('.workbench-character-count')?.getAttribute('aria-label')==='字数 '+expected,fallbackCount+3);
 console.log('PASS missing observers and blocked Workers preserve table attachment and character counts');
 assert.deepEqual(faults,[]);
}catch(error){
 console.error('Editor performance scenario failed',JSON.stringify({engine,mobile,url:page.url(),faults,
  visible:await page.locator('body').innerText().then(text=>text.slice(0,1200)).catch(()=>null)}));
 throw error;
}finally{
 if(engine==='webkit')await page.unrouteAll({behavior:'ignoreErrors'});
 await browser.close();
}
