import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8827';
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&executablePath);
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(14000);
const content=['# Nested drag test','',
':::: chat My chat','','::: message A | sender=user','','Message A.','',':::',
'','::: message B | sender=assistant','','Message B.','',':::',
'','::: message C | sender=assistant','','Message C.','',':::','', '::::','',
':::: tabs Tabs','','::: tab First','','Tab first.','',':::','', '::: tab Second','','Tab second.','',':::','', '::::'].join('\n');
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Nested drag '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },content);assert.equal(rec.status,201);
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 const msgs=page.locator('.tiptap .rk-directive-chat .rk-directive-message');
 await msgs.first().waitFor();
 const titles=async()=>msgs.allTextContents();
 assert.match((await titles())[0],/Message A\./);
 await msgs.first().hover();
 const grip=page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'拖动块'});
 await grip.waitFor();
 const thirdBox=await msgs.nth(2).boundingBox();
 await grip.dragTo(msgs.nth(2),{targetPosition:{x:25,y:Math.floor(thirdBox.height*.9)}});
 let order=await titles();
 assert.ok(order[0].includes('Message B.')&&order[2].includes('Message A.'),'drag only reorders nested Chat messages: '+order);
 console.log('PASS nested message HTML5 drag reorder');
 // One Ctrl+Z must revert the drag alone, not remove/recreate the document.
 await msgs.last().locator('.rk-directive-body p').first().click();
 await page.keyboard.press('Control+z');
 order=await titles();
 assert.ok(order[0].includes('Message A.')&&order[2].includes('Message C.'),'undo restores nested order: '+order);
 console.log('PASS nested drag Ctrl+Z restores source order');
 // Cross-parent drop (Chat → Tab) must be rejected by the node action contract.
 await msgs.first().hover();
 await grip.dragTo(page.locator('.rk-directive-tab').first(),{targetPosition:{x:20,y:20}});
 order=await titles();
 assert.ok(order[0].includes('Message A.')&&order[2].includes('Message C.'),'cross-parent drag must be rejected: '+order);
 assert.equal(await page.locator('.tiptap .rk-directive-chat .rk-directive-message').count(),3);
 console.log('PASS nested cross-parent HTML5 drop rejected');
}finally{await browser.close()}
