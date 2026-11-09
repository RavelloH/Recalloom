import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const sample=[
'# Nested RMD command tests','',':::: chat','',
'::: message 现有代理 | sender=assistant','','原始回复。','',':::','','::::',
'',':::: tabs',
'','::: tab 第一项','','第一个标签页。','',':::','','::::',
'',':::: glossary','','::: definition 电压','','电势差。','',':::','','::::',
'',':::: flashcard','','::: front','','问题？','',':::','','::: back','','答案。','',':::','','::::'
].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Nested slash commands '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },sample);
 assert.equal(rec.status,201);
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 await page.locator('.tiptap').waitFor();
 await page.waitForTimeout(450);
 const cases=[
  {parent:'chat',before:1,child:'message',query:'添加聊天消息',selector:'.rk-directive-message',trigger:'.rk-directive-message .rk-directive-body p'},
  {parent:'tabs',before:1,child:'tab',query:'添加标签页',selector:'.rk-directive-tab',trigger:'.rk-directive-tab .rk-directive-body p'},
  {parent:'glossary',before:1,child:'definition',query:'添加术语定义',selector:'.rk-directive-definition',trigger:'.rk-directive-definition .rk-directive-body p'}
 ];
 for(const item of cases){
  // Use a fresh document for each parent. UI selection after an insert stays
  // inside the newly inserted child by design; don't let one case leak into another.
  if(item.parent!=='chat'){
   const fresh=await page.evaluate(async content=>{
    const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Nested '+Date.now()+'.md',kind:'document',content})});
    return {status:r.status,data:await r.json()};
   },sample);
   assert.equal(fresh.status,201);
   await page.goto(base+'/records/'+fresh.data.id+'?mode=visual');
   await page.locator('.tiptap').waitFor();
  }
  const parent=page.locator('.rk-directive-'+item.parent).first();
  assert.equal(await parent.locator(item.selector).count(),item.before,'initial '+item.child);
  await parent.locator(item.trigger).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/'+item.query);
  const list=page.getByRole('listbox',{name:'插入块'});
  await list.waitFor();
  const option=list.getByRole('option',{name:new RegExp(item.query)});
  await option.waitFor();
  await option.click();
  await page.waitForTimeout(200);
  assert.equal(await parent.locator(item.selector).count(),item.before+1,'new '+item.child+' must be a sibling within '+item.parent);
  await page.getByRole('button',{name:'源码'}).click();
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  const childPattern=new RegExp('::: '+item.child+'(?: |\\n)','g');
  assert.equal((copied.match(childPattern)||[]).length,2,'both siblings survive serialization '+item.child);
  console.log('PASS legal child and source roundtrip',item.parent,item.child);
 }
 await page.getByRole('button',{name:'可视化'}).click();
 const flash=page.locator('.rk-directive-flashcard').first();
 await flash.locator('.rk-directive-front .rk-directive-body p').first().click();
 await page.keyboard.press('End');await page.keyboard.press('Enter');
 await page.keyboard.type('/添加闪卡正面');
 assert.equal(await page.getByRole('listbox',{name:'插入块'}).count(),0,'duplicate front must not be insertable');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'源码'}).click();
 await page.locator('.cm-content').first().click();
 await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
 const source=await page.evaluate(()=>navigator.clipboard.readText());
 assert.equal((source.match(/::: front/g)||[]).length,1);
 assert.equal((source.match(/::: back/g)||[]).length,1);
 assert.deepEqual(errors,[]);
 console.log('PASS nested RMD children and flashcard duplicate protection');
}finally{await browser.close()}
