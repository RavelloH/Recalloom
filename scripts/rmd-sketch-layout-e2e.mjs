import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8823';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secret=fs.readFileSync('.dev.vars','utf8').match(/^MCP_AUTH_SECRET=(.+)$/m)?.[1]?.trim();
assert.ok(secret);
const content=[
'# Sketch alignment & glyph regression',
'',
'这是一个不带标记的普通段落，用于校验文档左侧对齐基线。',
'',
'::: highlight',
'',
'这是一个普通的正文段落，用来观察高亮标记是否自然沿左侧阅读基线开始。',
'',
':::',
'',
'::: bracket',
'',
'- 第一项内容',
'- 第二项包含 $P=UI$ 的说明',
'',
':::',
'',
'::: box',
'',
'没有独立显示公式的普通文字块。',
'',
':::',
'',
'::: circle',
'',
'普通文字和行内公式 $E=mc^2$ 共处一个块级标记。',
'',
':::',
'',
'::: underline',
'',
'一个普通文本段落。',
'',
':::',
'',
'::: double-underline',
'',
'一段普通的双线强调文本。',
'',
':::',
'',
'::: circle',
'',
'$$',
'\\frac{U_1}{U_2}=\\frac{N_1}{N_2}',
'$$',
'',
':::',
'',
'::: box',
'',
'$$',
'\\int_0^T i(t)\\,dt=Q',
'$$',
'',
':::',
'',
'公式荧光笔：:: highlight $\\frac{U_1}{U_2}=\\sqrt{3}$ ::。',
'',
'根号与分式：:: highlight $\\frac{1}{\\sqrt{x^2+1}}$ | orange ::。',
'',
'同一行文字与公式：:: circle 总能量为 $E=mc^2$ ::。',
'',
'换行：:: circle 这是一段较长的手绘说明文字，其中有公式 $\\frac{1}{\\sqrt{x^2+1}}$，以及后续比较长的说明内容，检查换行后的单行绘制连续性与公式高度。 ::。'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(base+'/login');await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const rec=await page.evaluate(async content=>{const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Sketch layout regression '+Date.now()+'.md',kind:'document',content})});return {status:r.status,data:await r.json()}},content);
 assert.equal(rec.status,201,JSON.stringify(rec).slice(0,500));
 const id=rec.data.id;const results={};
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:width===1280?900:844});
  for(const mode of ['preview','visual']){
   await page.goto(base+'/records/'+id+'?mode='+mode);
   const selector=mode==='preview'?'.markdown-preview':'.wysiwyg';
   const root=page.locator(selector);await root.waitFor();
   await root.locator('svg[data-sketch-drawing="highlight"]').first().waitFor();
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(400);
   const v=await root.evaluate(el=>{
    const rect=x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,centerX:(r.left+r.right)/2}};
    const blocks=[...el.querySelectorAll('.rk-sketch-block')];
    const reference=[...el.querySelectorAll('p')].find(p=>p.textContent?.includes('不带标记的普通段落'));
    if(!reference)throw new Error('No reference paragraph');
    const referenceX=rect(reference).x;
    const rootMid=rect(el).centerX;
    const blockRects=blocks.map(b=>({kind:b.dataset.rkSketchKind,mathOnly:b.dataset.rkSketchMathOnly==='true',rect:rect(b), margin:getComputedStyle(b).marginInline, content:b.textContent?.slice(0,60)}));
    const inline=[...el.querySelectorAll('.rk-sketch-inline')];
    const svgs=[...el.querySelectorAll('.rk-sketch-overlay > svg')];
    const sketches=inline.filter(x=>x.querySelector('.katex')).map(x=>{
      const r=rect(x),base=[...x.querySelectorAll('.katex-html > .base')].map(rect);
      const mathKind=x.dataset.rkSketchKind;
      const matching=svgs.filter(svg=>svg.dataset.sketchDrawing===mathKind).filter(svg=>{
        const b=rect(svg);return b.right>=r.x-5&&b.x<=r.right+5&&b.bottom>=r.y-12&&b.y<=r.bottom+12;
      });
      const drawing=matching.map(rect);
      return {kind:mathKind,rect:r,glyphs:base,drawings:drawing,text:x.textContent?.slice(0,100),fragments:x.getClientRects().length};
    });
    const mixed=inline.find(x=>x.dataset.rkSketchKind==='circle'&&x.textContent?.includes('总能量为'));
    const mr=rect(mixed),circle=svgs.filter(svg=>svg.dataset.sketchDrawing==='circle').map(rect).filter(r=>r.x<mr.right+7&&r.right>mr.x-7&&r.y<mr.bottom+10&&r.bottom>mr.y-10);
    return {referenceX,rootMid,blockRects,sketches,mixed:{fragments:mixed.getClientRects().length,drawings:circle},svgCount:svgs.length,overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   const name=width+'-'+mode;results[name]=v;
   assert.equal(v.blockRects.length,8,name+' must have eight block sketches');
   assert.equal(v.blockRects.filter(b=>b.mathOnly).length,2,name+' math-only detection');
   for(const b of v.blockRects){
    if(b.mathOnly) assert.ok(Math.abs(b.rect.centerX-v.rootMid)<=12,
      name+' math should center: '+JSON.stringify({center:b.rect.centerX,root:v.rootMid}));
    else assert.ok(Math.abs(b.rect.x-v.referenceX)<=11,
      name+' prose/list should align left: '+JSON.stringify({kind:b.kind,x:b.rect.x,ref:v.referenceX}));
   }
   // A browser may coalesce mixed text/math into one inline client rect.
   // Visible source geometry and one enclosing circle are the invariants.
   assert.ok(v.mixed.fragments>=1,'mixed text/math must have visible source geometry');
   assert.equal(v.mixed.drawings.length,1,name+' mixed text/formula must form ONE circle');
   for(const mark of v.sketches.filter(x=>x.kind==='highlight')){
    assert.equal(mark.drawings.length,1,name+' each highlighted formula must have one painted area');
    const svg=mark.drawings[0];
    for(const glyph of mark.glyphs){
     assert.ok(svg.y<=glyph.y+1&&svg.bottom>=glyph.bottom-1,
       name+' highlighter must cover full KaTeX glyph height '+JSON.stringify({svg,glyph}));
    }
   }
   assert.equal(v.overflow,false,'no page overflow');
   fs.mkdirSync('tmp/sketch-measure/screens',{recursive:true});
   await page.screenshot({path:'tmp/sketch-measure/screens/layout-'+name+'.png',fullPage:true});
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS sketch alignment & math coverage',JSON.stringify({id,...Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{blocks:v.blockRects.map(b=>({kind:b.kind,mathOnly:b.mathOnly,x:+b.rect.x.toFixed(1)})),referenceX:+v.referenceX.toFixed(1),svgCount:v.svgCount,mixedCircles:v.mixed.drawings.length}]))}));
}finally{await browser.close()}
