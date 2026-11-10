import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8826';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(browserPath&&secret);
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const source='# Code direct edit\n\n~~~typescript\nconst answer = 42;\n~~~\n@ attrs code-answer | file=original.ts | wrap=true @';
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const rec=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Direct code title '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },source);
  assert.equal(rec.status,201);
  await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
  const title=page.locator('.rk-code-title-hit').first();
  await title.waitFor();
  assert.equal(await page.getByRole('button',{name:'修改代码文件名'}).count(),0,'no separate pencil is required');
  await title.click();
  const input=page.getByRole('textbox',{name:'代码文件名'});
  await input.waitFor();
  await input.fill('cancelled.ts');await input.press('Escape');
  await title.getByText('original.ts').waitFor();
  assert.equal(await page.locator('.rk-code-title-hit').getByText('cancelled.ts').count(),0,'Escape cancels rather than saving on blur');
  await title.focus();await title.press('Enter');
  await input.waitFor();
  await input.fill('updated.ts');await input.press('Enter');
  await title.getByText('updated.ts').waitFor();
  assert.match(await page.locator('.tiptap .rk-code-viewport').first().innerText(),/const answer = 42;/,'the code body is untouched');
  const codeBadge=page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="codeBlock"]').first();
  await codeBadge.waitFor();
  assert.match(await codeBadge.innerText(),/file=updated.ts/);
  const saved=await page.evaluate(async id=>{
   const r=await fetch('/api/records/'+id);return (await r.json()).content;
  },rec.data.id);
  // The service never saves on an in-browser attribute mutation.
  assert.equal(saved,source);
  await page.getByRole('button',{name:'源码'}).click();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const actual=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(actual,/file=updated\.ts/);
  assert.doesNotMatch(actual,/cancelled\.ts/);
  console.log('PASS code filename direct click/keyboard/Enter/Escape/source',width);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close()}
