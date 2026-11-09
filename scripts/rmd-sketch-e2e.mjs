import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8821';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'test worker must be localhost only');
const exe=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert.ok(exe);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET=(.+)$/m)?.[1]?.trim();
assert.ok(secret);
const kinds=['highlight','circle','box','bracket','underline','double-underline','dotted-underline','wavy','arrow'];
const blocks=['highlight','circle','box','bracket','underline','double-underline'];
const fixture=[
 '# 手绘标记完整验收',
 '',
 ...kinds.flatMap((kind,i)=>[
  '标记 '+(i+1)+'：:: '+kind+' 特别重要的文字与公式 $\\frac{1}{\\sqrt{x}}$'+(i===0?'':' | color=blue')+' ::。',
  ''
 ]),
 '多行：:: box 这是一段需要自然换行的很长很长的文字，用来验证笔迹是否可以随着窄屏阅读的行盒正确分段呈现而不是使用禁止换行的固定元素。 ::',
 '',
 '<u>原有普通下划线</u> 和 :: mark 默认语义重点 ::。',
 '',
 ...blocks.flatMap(kind=>[
  '::: '+kind+(kind==='highlight'?'':' | stroke=2.5 | padding=6'),
  '',
  '$$',
  '\\int_0^1 x^2\\,dx=\\frac{1}{\\sqrt{2}}',
  '$$',
  '',
  ':::',
  ''
 ])
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:exe,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
page.setDefaultTimeout(25000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
fs.mkdirSync('tmp/sketch-screens',{recursive:true});
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const created=await page.evaluate(async content=>{
  const res=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Sketch local browser fixture '+Date.now()+'.md',kind:'document',content})});
  return {status:res.status,data:await res.json()};
 },fixture);
 assert.equal(created.status,201,JSON.stringify(created).slice(0,350));
 const id=created.data.id;
 const metrics={id};
 for(const theme of ['light','dark']){
  await page.evaluate(mode=>localStorage.setItem('recalloom:mode',mode),theme);
  for(const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]){
   await page.setViewportSize({width:viewport.width,height:viewport.height});
   for(const mode of ['preview','visual']){
    await page.goto(base+'/records/'+id+'?mode='+mode);
    const root=page.locator(mode==='preview'?'.markdown-preview':'.wysiwyg');
    await root.waitFor();
    await page.waitForFunction(sel=>{
     const root=document.querySelector(sel);
     return root&&root.querySelectorAll('svg[data-sketch-drawing]').length>=15;
    },mode==='preview'?'.markdown-preview':'.wysiwyg',{timeout:15000});
    const rows=await root.evaluate(el=>{
     const base=el.getBoundingClientRect();
     const marks=[...el.querySelectorAll('[data-rk-sketch-kind]')];
     const svgs=[...el.querySelectorAll('svg[data-sketch-drawing]')];
     const rect=n=>{const r=n.getBoundingClientRect();return {w:+r.width.toFixed(1),h:+r.height.toFixed(1),x:+(r.left-base.left).toFixed(1),y:+(r.top-base.top).toFixed(1)}};
     return {
      markers:marks.map(n=>({kind:n.getAttribute('data-rk-sketch-kind'),math:n.getAttribute('data-rk-sketch-math-only'),tag:n.tagName,rect:rect(n),pieces:n.getClientRects().length})),
      drawings:svgs.map(n=>({kind:n.getAttribute('data-sketch-drawing'),rect:rect(n),paths:n.querySelectorAll('path').length,pointer:getComputedStyle(n).pointerEvents,animation:getComputedStyle(n).animationName})),
      blockMath:marks.filter(n=>n.classList.contains('rk-sketch-block')).map(n=>{
       const glyph=n.querySelector('.katex-html,.block-math-inner');
       const mathRect=glyph?.getBoundingClientRect();
       const candidate=svgs.filter(s=>s.getAttribute('data-sketch-drawing')===n.getAttribute('data-rk-sketch-kind'))
        .map(s=>s.getBoundingClientRect()).sort((a,b)=>Math.abs(a.top-(mathRect?.top??0))-Math.abs(b.top-(mathRect?.top??0)))[0];
       return {kind:n.getAttribute('data-rk-sketch-kind'),mathOnly:n.dataset.rkSketchMathOnly,
        glyphW:mathRect?.width??null,svgW:candidate?.width??null};
      }),
      katex:el.querySelectorAll('.katex').length,
      mark:el.querySelectorAll('mark:not([data-rk-color])').length,
      underline:el.querySelectorAll('u').length,
      hasProseMirrorOverlay:!!el.querySelector('.tiptap .rk-sketch-overlay'),
      documentOverflow:document.documentElement.scrollWidth>innerWidth+1
     };
    });
    const key=theme+'-'+viewport.name+'-'+mode;metrics[key]=rows;
    if(rows.markers.length!==kinds.length+1+blocks.length)console.log('DIAGNOSTIC',key,JSON.stringify({markers:rows.markers.map(x=>[x.kind,x.tag,x.math]),drawings:rows.drawings.map(x=>x.kind),katex:rows.katex}).slice(0,5000));
    assert.equal(rows.markers.length,kinds.length+1+blocks.length,'annotation wrapper count '+key);
    assert.deepEqual([...new Set(rows.markers.map(x=>x.kind))].sort(),[...kinds].sort());
    assert.ok(rows.drawings.length>=rows.markers.length,'each marker has an SVG '+key);
    assert.ok(rows.drawings.every(x=>x.paths>=1&&x.pointer==='none'&&x.animation==='none'),'all paths static, non-interactive');
    assert.ok(rows.katex>=7,'math formulas retained');
    assert.equal(rows.blockMath.length,6,'six math-only block annotations');
    assert.ok(rows.blockMath.every(x=>x.mathOnly==='true'),'math-only blocks keep their sizing flag: '+JSON.stringify(rows.blockMath));
    assert.ok(rows.blockMath.every(x=>x.glyphW!==null&&x.svgW!==null&&x.svgW<=x.glyphW+50),
      'block formula outlines must not stretch across the document: '+JSON.stringify(rows.blockMath));
    assert.ok(rows.mark>=1&&rows.underline>=1,'legacy mark and ordinary underline retained');
    assert.equal(rows.hasProseMirrorOverlay,false,'SVG layer must not be inside the editor DOM');
    assert.equal(rows.documentOverflow,false,'no page-level horizontal overflow at '+key);
    if(viewport.name==='mobile'){
     const multiline=rows.markers.find(x=>x.kind==='box'&&x.pieces>1);
     assert.ok(multiline,'inline marker must follow wrapped text');
    }
    if(viewport.name==='desktop'||mode==='preview')
     await page.screenshot({path:'tmp/sketch-screens/'+key+'.png',fullPage:true});
   }
   const a=metrics[theme+'-'+viewport.name+'-preview'],b=metrics[theme+'-'+viewport.name+'-visual'];
   assert.deepEqual(a.drawings.map(x=>x.kind),b.drawings.map(x=>x.kind),'same drawing types across preview/visual');
  }
 }
 // A settled document must not redraw every animation frame. In particular,
 // ResizeObserver callbacks must not re-register their own targets on paint.
 await page.setViewportSize({width:1280,height:900});
 await page.goto(base+'/records/'+id+'?mode=preview');
 await page.locator('.markdown-preview svg[data-sketch-drawing]').first().waitFor();
 const idleChanges=await page.evaluate(async()=>{
  const layer=document.querySelector('.markdown-preview .rk-sketch-overlay');
  if(!layer)throw new Error('Missing annotation layer');
  await new Promise(resolve=>setTimeout(resolve,350));
  let mutations=0;
  const observer=new MutationObserver(records=>{mutations+=records.length;});
  observer.observe(layer,{childList:true,subtree:true,attributes:true});
  await new Promise(resolve=>setTimeout(resolve,850));
  observer.disconnect();
  return mutations;
 });
 assert.ok(idleChanges<=1,'idle annotation layer must not continuously redraw: '+idleChanges);
 assert.deepEqual(errors,[],'JS errors: '+JSON.stringify(errors));
 console.log('PASS SKETCH ANNOTATION',JSON.stringify({
  variants:kinds,blockVariants:blocks,
  previewDesktop:metrics['light-desktop-preview'].drawings.length,
  visualDesktop:metrics['light-desktop-visual'].drawings.length,
  mobile:metrics['dark-mobile-preview'].drawings.length,
  kaTex:metrics['dark-mobile-visual'].katex,
 }));
}finally{await browser.close();}
