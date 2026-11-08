import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base='http://127.0.0.1:8788';
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(executablePath&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const pageError=[];
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage();
page.setDefaultTimeout(40000);
page.on('pageerror',e=>pageError.push(e.message));
const source=[
 '# Code performance test','','Unrelated paragraph.','','~~~typescript',
 'const greeting = "hello";','console.log(greeting);','~~~','@ attrs code-demo | file=demo.ts @'
].join('\n');
const tokenQuery='.tiptap .rk-code-block span[style*="--shiki-dark"]';
const inspect=()=>page.locator(tokenQuery).count();
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:35000});
 const created=await page.evaluate(async(content)=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Shiki-optimization-regression-'+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,body:await r.json()};
 },source);
 assert.equal(created.status,201);
 await page.goto(base+'/records/'+created.body.id+'?mode=visual',{waitUntil:'domcontentloaded'});
 const code=page.locator('.tiptap .rk-code-block').first();
 await code.waitFor();
 await page.waitForFunction(selector=>document.querySelectorAll(selector).length>=2,tokenQuery,{timeout:20000});
 const before=await inspect();
 await page.locator('.tiptap p').first().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' More text.');
 await page.waitForTimeout(300);
 const afterParagraph=await inspect();
 assert.ok(afterParagraph>=2,'typing outside a code block must preserve Shiki colors');
 const editorCode=code.locator('[data-node-view-content]');
 await editorCode.first().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' const answer = 42;');
 await page.waitForTimeout(800);
 const afterCode=await inspect();
 assert.ok(afterCode>=2,'typing inside a code block must trigger Shiki re-highlighting');
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 const body=await page.locator('.cm-content').innerText();
 assert.ok(body.includes('More text.'),'ordinary paragraph editing should survive mode switch');
 assert.ok(body.includes('answer = 42'),'code editing should survive mode switch');
 assert.deepEqual(pageError,[]);
 console.log('PASS SHIKI COLORS',JSON.stringify({before,afterParagraph,afterCode,sourceContentPresent:true,errors:0}));
}finally{await browser.close();}
