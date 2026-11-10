import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET=(.+)$/m)?.[1]?.trim();
assert.ok(secret);
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const doc=[
 '# Container direct titles',
 '',
 '::: warning 温馨提醒',
 '',
 '请注意正文应继续原位编辑。',
 '',
 ':::',
 '',
 '::: details 附加说明',
 '',
 '折叠内容保持完整。',
 '',
 ':::',
 '',
 ':::: tabs 演示标签组',
 '',
 '::: tab 第一页',
 '',
 '页内内容。',
 '',
 ':::',
 '',
 '::::',
].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  const rec=await page.evaluate(async content=>{
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Direct titles UI '+Date.now()+'.md',kind:'document',content})});
   return {status:r.status,data:await r.json()};
  },doc);
  assert.equal(rec.status,201,JSON.stringify(rec).slice(0,300));
  await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
  const warning=page.locator('.rk-directive-warning').first();
  const hit=warning.locator('.rk-directive-title-hit').first();await hit.waitFor();
  assert.equal(await warning.locator('.rk-directive-title button').count(),0,'no pencil icon');
  await hit.click();
  const input=warning.getByRole('textbox',{name:'容器标题'});await input.waitFor();
  await input.fill('单击即改标题');await input.press('Enter');
  await warning.locator('.rk-directive-title-hit').getByText('单击即改标题').waitFor();
  await warning.locator('.rk-directive-title-hit').click();
  const second=warning.getByRole('textbox',{name:'容器标题'});
  await second.fill('Escape 不应写入');await second.press('Escape');
  await warning.locator('.rk-directive-title-hit').getByText('单击即改标题').waitFor();
  assert.equal(await warning.locator('.rk-directive-title-hit').getByText('Escape 不应写入').count(),0);
  const details=page.locator('.rk-directive-details').first();
  await details.locator('.rk-directive-title-hit').click();
  const dinput=details.getByRole('textbox',{name:'容器标题'});
  await dinput.fill('直接编辑说明标题');await dinput.press('Enter');
  await details.locator('.rk-directive-title-hit').getByText('直接编辑说明标题').waitFor();
  assert.match(await details.innerText(),/折叠内容保持完整/,'click title must not collapse details or discard body');
  const tabs=page.locator('.rk-directive-tabs').first();
  await tabs.locator('.rk-directive-title-hit').first().click();
  const tinput=tabs.getByRole('textbox',{name:'容器标题'});
  await tinput.fill('标签页标题');await tinput.press('Enter');
  await tabs.locator('.rk-directive-title-hit').first().getByText('标签页标题').waitFor();
  await page.getByRole('button',{name:'源码'}).click();
  const code=await page.locator('.cm-content').first().innerText();
  assert.match(code,/::: warning 单击即改标题/);
  assert.match(code,/::: details 直接编辑说明标题/);
  assert.match(code,/:::: tabs 标签页标题/);
  assert.doesNotMatch(code,/Escape 不应写入/);
  console.log('PASS direct structural titles',width,'warning/details/tabs, cancel and source');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close()}
