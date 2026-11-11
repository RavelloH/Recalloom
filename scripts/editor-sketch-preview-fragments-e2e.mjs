import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const browserPath=[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(value=>value&&existsSync(value));
const config=readFileSync('.dev.vars','utf8');
const line=config.split(/\r?\n/).find(v=>/^\s*MCP_AUTH_SECRET\s*=/.test(v));
const secret=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE??'http://127.0.0.1:8897';
assert.ok(browserPath&&secret);
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);

const browser=await chromium.launch({headless:true,executablePath:browserPath});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.setDefaultTimeout(25000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

const content='普通开头 **中间粗体** 普通结尾';
const source=async id=>page.evaluate(async id=>{
 const response=await fetch('/api/records/'+id);
 if(!response.ok)throw Error('Could not read record: '+response.status);
 return (await response.json()).content;
},id);
const previewCount=()=>page.locator('.rk-sketch-preview-svg[data-sketch-drawing="circle"]').count();
const svgBounds=async selector=>page.locator(selector).first().evaluate(el=>{
 const rect=el.getBoundingClientRect();
 return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
});
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const record=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Mixed-bold sketch preview QA',kind:'document',content})});
  if(!r.ok)throw Error(await r.text());
  return r.json();
 },content);
 await page.goto(base+'/records/'+record.id+'?mode=visual');
 const p=page.locator('.tiptap p').filter({hasText:'普通开头'}).first();
 await p.waitFor();
 await p.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const bubble=page.getByRole('toolbar',{name:'文本格式'});
 for(let attempt=0;attempt<3;attempt++){
  try{await bubble.waitFor({timeout:3000});break;}
  catch(err){
   if(attempt===2)throw err;
   await p.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
  }
 }
 await bubble.getByRole('button',{name:'荧光笔与手绘标记'}).hover();
 const menu=page.getByRole('menu',{name:'荧光笔与手绘标记'});
 await menu.getByRole('menuitem',{name:'手绘圈选'}).hover();
 await page.locator('.rk-sketch-preview-svg[data-sketch-drawing="circle"]').first().waitFor();
 const fragments=await page.locator('.tiptap [data-rk-preview-sketch="true"]').evaluateAll(els=>els.map(el=>({
  text:el.textContent,group:el.dataset.rkPreviewGroup,kind:el.dataset.rkSketchKind,
  rect:el.getBoundingClientRect().toJSON()
 })));
 assert.ok(fragments.length>=3,'Expected ProseMirror to split one preview at bold boundaries: '+JSON.stringify(fragments));
 assert.equal(new Set(fragments.map(v=>v.group)).size,1,'All selection fragments share one preview group');
 assert.equal(await previewCount(),1,'One visual line must draw exactly ONE continuous sketch');
 const expected={left:Math.min(...fragments.map(x=>x.rect.left)),
  right:Math.max(...fragments.map(x=>x.rect.right)),
  top:Math.min(...fragments.map(x=>x.rect.top)),
  bottom:Math.max(...fragments.map(x=>x.rect.bottom))};
 const preview=await svgBounds('.rk-sketch-preview-svg[data-sketch-drawing="circle"]');
 assert.ok(preview.x<=expected.left&&preview.x+preview.width>=expected.right,
  'Preview sketch must cover all normal/bold/normal fragments '+JSON.stringify({preview,expected}));
 assert.equal(await source(record.id),content,'Hover must not modify saved Markdown');
 assert.equal(await page.locator('.save-status.is-dirty').count(),0,'Hover should not mark document dirty');
 await page.screenshot({path:'tmp/sketch-mixed-bold-hover.png'});
 console.log('PASS mixed normal/bold/normal one-line preview: '+fragments.length+' DOM fragments -> one SVG');

 await menu.getByRole('menuitem',{name:'手绘圈选'}).click();
 await page.locator('.rk-sketch-preview-svg').waitFor({state:'detached'});
 await page.locator('.rk-sketch-svg[data-sketch-drawing="circle"]').first().waitFor();
 const committedCount=await page.locator('.rk-sketch-svg[data-sketch-drawing="circle"]').count();
 assert.equal(committedCount,1,'Committed mark should also be one circle');
 const committed=await svgBounds('.rk-sketch-svg[data-sketch-drawing="circle"]');
 assert.ok(Math.abs(committed.width-preview.width)<15&&Math.abs(committed.height-preview.height)<15,
  'Preview and actual mark should cover the same selection '+JSON.stringify({preview,committed}));
 await page.screenshot({path:'tmp/sketch-mixed-bold-committed.png'});
 console.log('PASS applied mark matches preview geometry, one continuous SVG');

 // The renderer must still produce separate drawings across real wrapped lines.
 const wrapped=await page.evaluate(async()=>{
  const content='开始这里普通的长句 **中间粗体内容长句** 紧接着继续很多很多普通文字，确保在窄栏中确实发生换行而不是分割成三个独立标注圈。';
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Wrapped sketch preview QA',kind:'document',content})});
  if(!r.ok)throw Error(await r.text());
  return {id:(await r.json()).id,content};
 });
 await page.goto(base+'/records/'+wrapped.id+'?mode=visual');
 const wrappedP=page.locator('.tiptap p').filter({hasText:'开始这里普通的长句'}).first();
 await wrappedP.waitFor();
 await wrappedP.evaluate(el=>{el.style.width='260px';});
 await wrappedP.click();await page.keyboard.press('ControlOrMeta+A');
 const toolbar=page.getByRole('toolbar',{name:'文本格式'});
 await toolbar.waitFor();
 await toolbar.getByRole('button',{name:'荧光笔与手绘标记'}).hover();
 await page.getByRole('menu',{name:'荧光笔与手绘标记'}).getByRole('menuitem',{name:'手绘圈选'}).hover();
 await page.locator('.rk-sketch-preview-svg[data-sketch-drawing="circle"]').first().waitFor();
 const wrappedData=await page.locator('[data-rk-preview-sketch="true"]').evaluateAll(els=>{
  const rects=els.flatMap(el=>[...el.getClientRects()].map(r=>({center:r.top+r.height/2,height:r.height})));
  const ys=[];
  for(const r of rects.sort((a,b)=>a.center-b.center)){
   if(!ys.some(y=>Math.abs(y.center-r.center)<=Math.max(2,Math.min(y.height,r.height)*.6)))ys.push(r);
  }
  return {fragments:els.length,lines:ys.length};
 });
 assert.ok(wrappedData.lines>=2,'Fixture must wrap onto multiple visual lines: '+JSON.stringify(wrappedData));
 await page.waitForTimeout(100);
 assert.equal(await previewCount(),wrappedData.lines,
  'One preview sketch per wrapped visual LINE, not per style fragment '+JSON.stringify(wrappedData));
 assert.equal(await source(wrapped.id),wrapped.content);
 console.log('PASS wrapped mixed-format text: '+wrappedData.fragments+' fragments -> '+wrappedData.lines+' visual-line drawings');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
