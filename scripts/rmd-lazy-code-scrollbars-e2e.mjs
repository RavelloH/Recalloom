import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base='http://127.0.0.1:8788';
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(browserPath&&secretLine);
const secret=secretLine.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1250,height:900}});
page.setDefaultTimeout(60000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));

const codeLines=[
 '~~~ts','const modest = "'+'a'.repeat(55)+'";','~~~',
 '','~~~ts','const second = 42;','~~~',
 ...Array.from({length:127},(_,i)=>'\n~~~ts\nconst code'+i+' = '+i+';\n~~~'),
 '','~~~ts','const tail = "'+'Z'.repeat(1000)+'";','~~~'
];
const markdown='# Lazy code scrollbar lifecycle\n\n'+codeLines.join('\n');
const codeSelector='.tiptap .rk-code-block';
const insideBars=n=>page.locator(codeSelector).nth(n).locator('.os-scrollbar').count();
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:35000});
 const response=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'document',name:'Lazy-code-scrollbar-'+Date.now()+'.md',content})});
  return {status:r.status,body:await r.json()};
 },markdown);
 assert.equal(response.status,201,JSON.stringify(response));
 await page.goto(base+'/records/'+response.body.id+'?mode=visual',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(selector=>document.querySelectorAll(selector).length===130,codeSelector,{timeout:100000});
 await page.waitForTimeout(300);
 const initialBars=await page.locator('.tiptap .os-scrollbar').count();
 assert.equal(initialBars,0,'short visible code blocks and off-screen long blocks must not allocate overlays');
 assert.equal(await insideBars(129),0,'far offscreen long code must not be initialized');
 console.log('PASS INITIAL_LAZY',JSON.stringify({blocks:130,bars:initialBars,tailBars:0}));

 // A short code block changes width without an observed pre border-box resize.
 const second=page.locator(codeSelector).nth(1);
 await second.locator('[data-node-view-content]').first().click();
 await page.keyboard.press('End');
 await page.keyboard.insertText('X'.repeat(360));
 await page.waitForFunction(selector=>document.querySelectorAll(selector)[1]?.querySelectorAll('.os-scrollbar').length>=2,codeSelector,{timeout:15000});
 const editedBars=await insideBars(1);
 assert.ok(editedBars>=2);
 console.log('PASS CODE_EDIT_OVERFLOW',editedBars);

 // The distant long block attaches only when it approaches the viewport.
 const last=page.locator(codeSelector).last();
 await last.scrollIntoViewIfNeeded();
 await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].at(-1)?.querySelectorAll('.os-scrollbar').length>=2,codeSelector,{timeout:15000});
 const lastBars=await insideBars(129);
 assert.ok(lastBars>=2);
 const overflow=await last.locator('.rk-code-viewport').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
 assert.ok(overflow.scroll>overflow.client+2,JSON.stringify(overflow));
 console.log('PASS OFFSCREEN_ACTIVATION',JSON.stringify({lastBars,...overflow}));

 // Viewport resizing creates a previously unnecessary scrollbar.
 const first=page.locator(codeSelector).first();
 await first.scrollIntoViewIfNeeded();
 await page.setViewportSize({width:390,height:900});
 await page.waitForFunction(selector=>document.querySelectorAll(selector)[0]?.querySelectorAll('.os-scrollbar').length>=2,codeSelector,{timeout:20000});
 const narrow=await first.locator('.rk-code-viewport').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
 assert.ok(narrow.scroll>narrow.client+2,JSON.stringify(narrow));
 console.log('PASS RESIZE_OVERFLOW',narrow);

 // Horizontal scrolling and the edge fade still work after late activation.
 await first.locator('.rk-code-viewport').evaluate(el=>{el.scrollLeft=Math.floor((el.scrollWidth-el.clientWidth)/2);el.dispatchEvent(new Event('scroll'));});
 await page.waitForFunction(selector=>{
  const el=document.querySelectorAll(selector)[0];return el?.hasAttribute('data-edge-start')&&el?.hasAttribute('data-edge-end');
 },codeSelector,{timeout:10000});
 console.log('PASS SCROLL_EDGES');

 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 const source=await page.locator('.cm-content').innerText();
 assert.ok(source.includes('X'.repeat(180)),'code editing must survive switch to source');
 // CodeMirror virtualizes offscreen lines. Jump to the end before inspecting
 // the distant code block instead of assuming innerText is the whole file.
 await page.locator('.cm-content').click();
 await page.keyboard.press('Control+End');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('const tail'),null,{timeout:10000});
 assert.deepEqual(errors,[],'no browser exceptions expected');
 console.log('PASS SOURCE_AND_ERRORS',JSON.stringify({errors:errors.length,sourceContainsChanges:true}));
}finally{await browser.close();}
