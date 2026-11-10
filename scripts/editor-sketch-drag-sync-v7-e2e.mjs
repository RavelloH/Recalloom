import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const executablePath=[
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(fs.existsSync);
assert.ok(secret&&executablePath);
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(15000);
const fixture=[
 '# Sketch drag synchronization',
 '',
 '::: warning',
 '',
 'Drag the warning block to the end.',
 '',
 ':::',
 '',
 '::: box',
 '',
 'A boxed paragraph with a hand-drawn outline.',
 '',
 ':::',
 '',
 '::: bracket',
 '',
 '- First bracket line',
 '- Second bracket line',
 '',
 ':::',
 '',
 '::: circle',
 '',
 'Circle with $E=mc^2$',
 '',
 ':::',
 '',
 'Final destination paragraph.'
].join('\n');

async function snapshot(){
 return page.evaluate(()=>{
  const root=document.querySelector('.wysiwyg');
  const svgs=[...root.querySelectorAll('.rk-sketch-overlay > svg[data-sketch-drawing]')];
  const out={};
  for(const kind of ['box','bracket','circle']){
   const holder=root.querySelector('.tiptap .rk-directive-sketch[data-rk-kind="'+kind+'"] [data-rk-sketch-kind="'+kind+'"]');
   const svg=svgs.find(el=>el.dataset.sketchDrawing===kind);
   if(!holder||!svg)throw Error('missing sketch '+kind+': '+root.querySelector('.tiptap')?.innerHTML.slice(0,500));
   const a=holder.getBoundingClientRect(),b=svg.getBoundingClientRect();
   out[kind]={contentY:a.y,drawY:b.y,contentCenter:a.top+a.height/2,drawCenter:b.top+b.height/2,
    contentHeight:a.height,drawHeight:b.height,
    deltaY:b.y-a.y,transform:getComputedStyle(svg).transform,opacity:getComputedStyle(svg).opacity};
  }
  return out;
 });
}
async function drag(source,target){
 await source.hover();
 const button=page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'拖动块'});
 await button.waitFor();
 const handle=await button.boundingBox(),dest=await target.boundingBox();
 assert.ok(handle&&dest);
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
 await page.mouse.down();
 await page.mouse.move(handle.x+handle.width/2+14,handle.y+handle.height/2+12,{steps:5});
 await page.mouse.move(dest.x+Math.min(60,dest.width*.5),dest.y+dest.height*.8,{steps:16});
 await page.waitForTimeout(290);
}
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const result=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Sketch Drag Sync '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },fixture);
 assert.equal(result.status,201);
 await page.goto(base+'/records/'+result.data.id+'?mode=visual');
 const target=page.locator('.tiptap p').filter({hasText:'Final destination paragraph.'}).first();
 await target.waitFor();
 await page.locator('.rk-sketch-overlay > svg[data-sketch-drawing="bracket"]').first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(200);

 const before=await snapshot();
 await drag(page.locator('.tiptap .rk-directive-warning').first(),target);
 const moved=await snapshot();
 const state=await page.evaluate(()=>({dragging:document.body.classList.contains('rk-block-drag-active'),
  moved:document.querySelector('.rk-block-drop-slot')?.getAttribute('data-moved')}));
 assert.equal(state.dragging,true);
 assert.equal(state.moved,'true');
 for(const kind of ['box','bracket','circle']){
  const amount=moved[kind].contentY-before[kind].contentY;
  const drawingAmount=moved[kind].drawY-before[kind].drawY;
  assert.ok(Math.abs(amount)>8,kind+' should visually move when warning block moves: '+JSON.stringify({before:before[kind],moved:moved[kind]}));
  assert.ok(Math.abs(amount-drawingAmount)<6,
   kind+' SVG must follow its transformed block at the same Y offset: '+JSON.stringify({amount,drawingAmount,before:before[kind],moved:moved[kind]}));
  assert.ok(Math.abs(moved[kind].deltaY-before[kind].deltaY)<6,kind+' must retain the original optical alignment');
 }
 console.log('PASS sibling box, bracket, circle SVG drawings follow live block preview transforms');

 await page.mouse.up();
 await page.waitForTimeout(220);
 const dropped=await snapshot();
 for(const kind of ['box','bracket','circle'])
  assert.ok(Math.abs(dropped[kind].deltaY-before[kind].deltaY)<6,'after drop '+kind+' drawing should re-anchor');
 assert.equal(await page.locator('style[data-rk-drag-styles]').count(),0);
 console.log('PASS all three hand-drawn annotations restore alignment after drop');

 await page.locator('.tiptap p').filter({hasText:'Drag the warning block'}).first().click();
 await page.keyboard.press('Control+z');
 await page.waitForTimeout(200);
 const undone=await snapshot();
 for(const kind of ['box','bracket','circle'])
  assert.ok(Math.abs(undone[kind].deltaY-before[kind].deltaY)<6,'undo '+kind+' should remain aligned');
 console.log('PASS undo preserves sketch-to-text alignment');

 // A source that itself carries hand-drawn SVGs should have its original
 // drawing dimmed during drag, and reappear once the drag is released.
 const box=page.locator('.tiptap .rk-directive-sketch[data-rk-kind="box"]').first();
 await drag(box,target);
 const source=await snapshot();
 assert.ok(Number(source.box.opacity)<.2,'source annotation must dim with its source block: '+JSON.stringify(source.box));
 await page.mouse.up();
 await page.waitForTimeout(200);
 const restored=await snapshot();
 assert.ok(Number(restored.box.opacity)>.9,'source annotation must return after drop');
 console.log('PASS dragging a hand-drawn source dims and restores its own overlay');

 // Cancel by releasing outside the editor: no DOM reorder and no lingering
 // opacity/offset on the detached overlay drawings.
 await box.hover();
 const grip=page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'拖动块'});
 await grip.waitFor();
 const h=await grip.boundingBox();assert.ok(h);
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);
 await page.mouse.down();
 await page.mouse.move(h.x+h.width/2+16,h.y+h.height/2+14,{steps:5});
 await page.mouse.move(30,120,{steps:16});
 await page.mouse.up();
 await page.waitForTimeout(220);
 assert.equal(await page.locator('style[data-rk-drag-styles]').count(),0,'cancel must remove drag styles');
 const cancelled=await snapshot();
 for(const kind of ['box','bracket','circle'])
  assert.ok(Math.abs(cancelled[kind].deltaY-before[kind].deltaY)<6,
   'cancel '+kind+' must re-anchor without stale SVG offsets');
 console.log('PASS cancelling a drag outside the editor resets every annotation');

}finally{await browser.close();}
