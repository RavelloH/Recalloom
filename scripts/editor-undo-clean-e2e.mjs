import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const engine=process.env.RECALLOOM_TEST_ENGINE==='webkit'?'webkit':'chromium';
const bin=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x)):undefined;
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(bin?{executablePath:bin}:{})});
const context=await browser.newContext({viewport:{width:1200,height:850}});
const page=await context.newPage();
page.setDefaultTimeout(20000);
if(engine==='webkit'){
 let sessionCookie='';
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(request.url().endsWith('/api/auth/login')){
   const response=await route.fetch();
   const match=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'');
   if(match)sessionCookie=match[1];
   await route.fulfill({response});return;
  }
  if(!sessionCookie){await route.continue();return;}
  const response=await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}});
  await route.fulfill({response});
 });
}
const faults=[];
page.on('pageerror',error=>faults.push(error.message));
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const content='# Original heading\n\nFirst paragraph with **bold** and [link](https://example.org).\n\n';
 const record=await page.evaluate(async content=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Undo clean regression '+Date.now()+'.md',kind:'document',content})});
  if(!response.ok)throw Error('Cannot create test record: '+await response.text());
  return response.json();
 },content);
 await page.goto(base+'/records/'+record.id+'?mode=visual');
 const editor=page.locator('.tiptap');
 await editor.waitFor();
 const status=page.locator('.save-status');
 await status.getByText('已保存').waitFor();
 const paragraph=editor.locator('p').filter({hasText:'First paragraph'}).first();
 await paragraph.click();
 await page.keyboard.press('End');
 await page.keyboard.type(' UNDO_TEST');
 await status.getByText('未保存').waitFor();
 assert.match(await paragraph.innerText(),/UNDO_TEST/);
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>!document.querySelector('.tiptap')?.textContent?.includes('UNDO_TEST'));
 await status.getByText('已保存').waitFor({timeout:4000});
 const drafts=await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('recalloom:draft:')));
 assert.equal(drafts.length,0,'undo to original content must remove stale stored draft');
 console.log('PASS visual Ctrl+Z resets true dirty state and clears draft',engine);
 // The exact raw Markdown is preserved when undo reaches the initial doc.
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 const sourceContent=await page.evaluate(()=>{
  const view=document.querySelector('.cm-editor')?.cmView?.view;
  return view?.state?.doc?.toString()??null;
 });
 if(sourceContent!==null)assert.equal(sourceContent,content,'Undo must not reserialize unchanged input');
 console.log('PASS no-op undo keeps the original source Markdown',engine);
 // Source editing uses CodeMirror history, but must share the same dirty
 // baseline and clean-draft logic as the visual editor.
 await page.locator('.cm-content').click();
 await page.keyboard.press('Control+End');
 await page.keyboard.type('SOURCE_UNDO_TEST');
 await status.getByText('未保存').waitFor();
 await page.keyboard.press('Control+z');
 await status.getByText('已保存').waitFor({timeout:4000});
 assert.equal((await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('recalloom:draft:')))).length,0,
  'source undo must not leave an obsolete recovery draft');
 console.log('PASS source Ctrl+Z resets the same dirty state and draft',engine);
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await editor.waitFor();
 await page.locator('.save-status').getByText('已保存').waitFor();
 await page.reload();
 await page.locator('.save-status').getByText('已保存').waitFor();
 assert.equal(await page.getByText('已恢复本标签页未保存的草稿').count(),0,
  'a clean reload must not display a stale recovered draft');
 console.log('PASS reload after complete undo does not resurrect a stale draft',engine);
 await page.getByText('概览',{exact:true}).first().click();
 await page.waitForURL(base+'/');
 assert.equal(await page.getByRole('dialog',{name:'未保存的编辑内容'}).count(),0);
 console.log('PASS clean editor navigation does not open the unsaved dialog',engine);
 assert.deepEqual(faults,[]);
}finally{
 if(engine==='webkit')await page.unrouteAll({behavior:'ignoreErrors'});
 await context.close();
 await browser.close();
}
