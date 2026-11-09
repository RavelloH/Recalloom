import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const content='# Drag block\n\nAlpha.\n\nBeta.\n\nGamma.';
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Drag reordering '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },content);
 assert.equal(rec.status,201);
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 const alpha=page.locator('.tiptap p').filter({hasText:'Alpha.'}).first();
 const gamma=page.locator('.tiptap p').filter({hasText:'Gamma.'}).first();
 await alpha.hover();
 const drag=page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'拖动块'});
 await drag.waitFor();
 await drag.dragTo(gamma,{targetPosition:{x:20,y:15}});
 const source=async()=>{
  await page.getByRole('button',{name:'源码'}).click();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  return page.evaluate(()=>navigator.clipboard.readText());
 };
 const order=async()=>page.locator('.tiptap > p').allTextContents();
 let paragraphs=await order();
 assert.ok(paragraphs.indexOf('Alpha.')>paragraphs.indexOf('Gamma.'),'drag should place Alpha after Gamma: '+paragraphs);
 console.log('PASS HTML5 block drag changes visual block order');
 // Undo must be executed in the SAME editor instance. Switching to the
 // source editor would remount Tiptap and reset its per-instance history.
 await page.locator('.tiptap p').filter({hasText:'Alpha.'}).first().click();
 await page.keyboard.press('Control+z');
 paragraphs=await order();
 assert.ok(paragraphs.indexOf('Alpha.')<paragraphs.indexOf('Gamma.'),'Ctrl+Z restores original block order: '+paragraphs);
 const text=await source();
 assert.ok(text.indexOf('Alpha.')<text.indexOf('Gamma.'),'undone block order serializes correctly: '+text);
 console.log('PASS Ctrl+Z restores RMD order without remounting the editor');
}finally{await browser.close()}
