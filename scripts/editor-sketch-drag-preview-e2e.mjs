import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8825';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET\s*=\s*(.+)$/m)?.[1]?.trim();
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(secret&&bin);
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:1200}});
page.setDefaultTimeout(14000);
const contentMd=[
 '# 标注随块移动','','::: warning Drag me','','拖动这个 Callout 作为源块。','',':::',
 '','::: box','','BOX_A：默认方框包裹普通段落。','',':::',
 '','::: bracket','','- 第一条带标注的知识点','- 第二条带标注的知识点','',':::',
 '','::: circle','','CIRCLE_C：$E=mc^2$ 内容。','',':::',
 '','尾部段落。'
].join('\n');
async function snapshot(){
 return page.evaluate(()=>{
  const root=document.querySelector('.wysiwyg');
  const measure=(kind)=>{
   const host=root?.querySelector('.tiptap .rk-sketch-block[data-rk-sketch-kind="'+kind+'"]');
   const svg=root?.querySelector('.rk-sketch-overlay > .rk-sketch-svg[data-sketch-drawing="'+kind+'"]');
   if(!host||!svg)return null;
   const hr=host.getBoundingClientRect(),sr=svg.getBoundingClientRect();
   return {hostY:hr.y,svgY:sr.y,relativeY:sr.y-hr.y,
    hostTransform:getComputedStyle(host.closest('.rk-directive-sketch')??host).transform,
    svgTransform:getComputedStyle(svg).transform,
    opacity:getComputedStyle(svg).opacity,svgCount:root.querySelectorAll('.rk-sketch-overlay > svg').length};
  };
  return {box:measure('box'),bracket:measure('bracket'),circle:measure('circle'),
   active:document.body.classList.contains('rk-block-drag-active')};
 });
}
const verifyRelative=(a,b,label,tolerance=10)=>{
 for(const kind of ['box','bracket','circle']){
  assert.ok(a[kind]&&b[kind],label+': missing '+kind+' '+JSON.stringify({a,b}));
  assert.ok(Math.abs(a[kind].relativeY-b[kind].relativeY)<tolerance,
   label+': marker drifted away from '+kind+' '+JSON.stringify({before:a[kind],after:b[kind]}));
 }
};
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const rec=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Sketch drag preview '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,data:await r.json()};
 },contentMd);
 assert.equal(rec.status,201,JSON.stringify(rec).slice(0,400));
 await page.goto(base+'/records/'+rec.data.id+'?mode=visual');
 await page.locator('.tiptap .rk-directive-warning').first().waitFor();
 await page.locator('.rk-sketch-overlay > svg[data-sketch-drawing="circle"]').first().waitFor();
 await page.waitForTimeout(330);
 const before=await snapshot();
 for(const kind of ['box','bracket','circle'])assert.ok(before[kind],kind+' sketch must be rendered');
 const warning=page.locator('.tiptap .rk-directive-warning').first();
 const circle=page.locator('.tiptap .rk-directive-sketch').filter({hasText:'CIRCLE_C'}).first();
 await warning.hover();
 const handle=page.getByRole('group',{name:'块把手'}).getByRole('button',{name:'拖动块'});
 await handle.waitFor();
 const h=await handle.boundingBox(),target=await circle.boundingBox();assert.ok(h&&target);
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);
 await page.mouse.down();
 await page.mouse.move(h.x+h.width/2+12,h.y+h.height/2+12,{steps:6});
 await page.mouse.move(target.x+Math.min(30,target.width/2),target.y+target.height*.85,{steps:16});
 await page.waitForTimeout(280); // Allow the 180ms compositor transform to settle.
 // Reproduces the bug: a redraw scheduled while the drag is active used to
 // replace translated SVGs and strand marks at their old position.
 // Invalidate the sketch renderer without resizing/reflowing the entire
 // browser viewport (which would also cancel the drag preview itself).
 await page.evaluate(()=>document.documentElement.classList.add('rk-sketch-test-theme-change'));
 await page.waitForTimeout(90);
 const inFlight=await snapshot();
 assert.equal(inFlight.active,true,'must be an active native block drag');
 const slot=await page.locator('.rk-block-drop-slot').getAttribute('data-moved');
 assert.equal(slot,'true','destination must be moved');
 let movedCount=0;
 for(const kind of ['box','bracket','circle']){
  const hostDelta=inFlight[kind].hostY-before[kind].hostY;
  const markerDelta=inFlight[kind].svgY-before[kind].svgY;
  if(Math.abs(hostDelta)>16)movedCount++;
  assert.ok(Math.abs(markerDelta-hostDelta)<9,
   kind+' SVG must track content during drag: '+JSON.stringify({hostDelta,markerDelta,before:before[kind],during:inFlight[kind]}));
  assert.ok(Math.abs(inFlight[kind].relativeY-before[kind].relativeY)<9,kind+' should keep optical alignment during drag');
 }
 assert.ok(movedCount>=2,'must move multiple annotated siblings, got '+JSON.stringify(inFlight));
 console.log('PASS '+movedCount+' independent SVG sketches follow moving siblings in live block drag');

 await page.mouse.up();
 await page.waitForTimeout(350);
 const after=await snapshot();
 assert.equal(after.active,false,'drag state must be removed');
 verifyRelative(before,after,'after drop');
 for(const kind of ['box','bracket','circle']){
  assert.ok(!after[kind].svgTransform||after[kind].svgTransform==='none','SVG cannot retain stale CSS drag shift on drop: '+JSON.stringify(after[kind]));
  assert.equal(after[kind].opacity,'1','sketch should fully reappear after drop');
 }
 console.log('PASS placed sketches re-anchor without residual transforms');

 // Focus plain prose: clicking the circle's embedded KaTeX would open a
 // formula dialog and intercept the subsequent drag hover.
 await page.locator('.tiptap p').filter({hasText:'尾部段落。'}).first().click();
 await page.keyboard.press('Control+z');
 await page.waitForTimeout(300);
 const undone=await snapshot();
 verifyRelative(before,undone,'after Undo');
 console.log('PASS Ctrl+Z reorders and redraws SVG overlays without drift');

 // A source block with a sketch itself should dim with its source text.
 const boxBlock=page.locator('.tiptap .rk-directive-sketch').filter({hasText:'BOX_A'}).first();
 await boxBlock.hover();
 const h2=await handle.boundingBox();
 const tail=await page.locator('.tiptap p').filter({hasText:'尾部段落。'}).first().boundingBox();
 assert.ok(h2&&tail);
 await page.mouse.move(h2.x+h2.width/2,h2.y+h2.height/2);
 await page.mouse.down();
 await page.mouse.move(h2.x+h2.width/2+16,h2.y+h2.height/2+15,{steps:8});
 await page.mouse.move(tail.x+Math.min(tail.width/2,25),tail.y+Math.min(tail.height-2,14),{steps:18});
 await page.waitForTimeout(270);
 const sourceDuring=await snapshot();
 assert.equal(sourceDuring.active,true);
 assert.ok(sourceDuring.box&&Number(sourceDuring.box.opacity)<.15,
  'source annotation should fade with dragged sketch block: '+JSON.stringify(sourceDuring.box));
 for(const kind of ['bracket','circle']){
  const hostDelta=sourceDuring[kind].hostY-undone[kind].hostY;
  const svgDelta=sourceDuring[kind].svgY-undone[kind].svgY;
  assert.ok(Math.abs(hostDelta)>16,kind+' must visibly move when an earlier sketch block is dragged near the tail');
  assert.ok(Math.abs(hostDelta-svgDelta)<9,kind+' must move its SVG in lockstep with its text');
 }
 await page.keyboard.press('Escape');
 await page.mouse.up();
 await page.waitForTimeout(350);
 const cancelled=await snapshot();
 assert.equal(cancelled.active,false);
 assert.equal(cancelled.box.opacity,'1','cancelled drag must not leave a dim sketch');
 verifyRelative(before,cancelled,'after cancel');
 console.log('PASS sketch source fades during drag and restores when cancelled');
}finally{await browser.close();}
