import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&bin);
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const content='# Drag block\n\n::: warning Alpha\n\nAlpha inside.\n\n:::\n\nBeta.\n\nGamma.';
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Drag RMD blocks '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },content);
 assert.equal(rec.status,201);
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 const alpha=page.locator('.tiptap .rk-directive-warning').first();
 const gamma=page.locator('.tiptap p').filter({hasText:'Gamma.'}).first();
 await alpha.hover();
 const drag=page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'拖动块'});
 await drag.waitFor();
 const rect=await gamma.boundingBox(),handle=await drag.boundingBox();assert.ok(rect&&handle);
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
 await page.mouse.down();
 await page.mouse.move(handle.x+handle.width/2+10,handle.y+handle.height/2+10,{steps:5});
 await page.mouse.move(rect.x+Math.min(40,rect.width/2),rect.y+Math.max(8,rect.height*.9),{steps:18});
 await page.waitForTimeout(250);
 const preview=await page.evaluate(()=>({
  destination:document.querySelector('.rk-block-drop-slot')?.getAttribute('data-moved'),
  shift:[...document.querySelectorAll('.tiptap > *')].filter(n=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(n).transform).m42)>10).length,
  motion:document.querySelector('.rk-block-drop-slot')?.getAttribute('data-motion'),
  nodes:[...document.querySelectorAll('.tiptap > *')].map(n=>({text:n.textContent?.slice(0,24),transform:getComputedStyle(n).transform})),
  externalStyle:!!document.querySelector('style[data-rk-drag-styles]'),
  dragging:document.body.classList.contains('rk-block-drag-active')
 }));
 console.log('DRAG_PREVIEW',JSON.stringify(preview));
 assert.equal(preview.destination,'true','callout must preview insertion after paragraph: '+JSON.stringify(preview));
 assert.ok(preview.shift>0,'siblings should move in the visual preview: '+JSON.stringify(preview));
 await page.mouse.up();
 assert.equal(await page.locator('style[data-rk-drag-styles]').count(),0,'no temporary drag CSS after drop');
 const sequence=async()=>page.locator('.tiptap > *').evaluateAll(nodes=>nodes.map(node=>node.textContent?.trim()??''));
 let blocks=await sequence();
 assert.ok(blocks.findIndex(t=>t.includes('Alpha inside.'))>blocks.findIndex(t=>t==='Gamma.'),
  'explicit callout must move after plain paragraphs: '+JSON.stringify(blocks));
 console.log('PASS RMD-only handle can reorder across paragraphs without giving paragraphs their own grip');
 await alpha.locator('.rk-directive-body p').first().click();
 await page.keyboard.press('Control+z');
 blocks=await sequence();
 assert.ok(blocks.findIndex(t=>t.includes('Alpha inside.'))<blocks.findIndex(t=>t==='Gamma.'),
  'Ctrl+Z restores source order: '+JSON.stringify(blocks));
 console.log('PASS Ctrl+Z restores one atomic block move');
}finally{await browser.close();}
