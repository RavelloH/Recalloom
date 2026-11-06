import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchTestBrowser,testOrigin} from './local-browser.mjs';

const keyLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
const secret=keyLine?.slice(keyLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'Only the isolated local Worker may be tested');
const tick=String.fromCharCode(96);
const sample=[
 '# Highlighted mathematics and code',
 '',
 'This inline code is highlighted: <mark>'+tick+'R_T = ΔP_s U_N² / S_N² × 1000'+tick+'</mark> Ω.',
 '',
 'Another example: <mark>the value '+tick+'U_N=10 kV'+tick+' is essential</mark>.',
 '',
 'Plain code should retain its ordinary styling: '+tick+'token_name'+tick+'.',
 '',
 'Inline LaTeX: $E=mc^2$ and $U_N^2$.',
 '',
 'Highlighted tall fraction: <mark>$\\frac{x+y}{z}$</mark> and matrix <mark>$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$</mark>.',
 '',
 'Mixed text and tall math: <mark>Power $\\frac{p}{q}$ matters</mark>.',
 '',
 '$$',
 'R_T = \\frac{\\Delta P_s U_N^2}{S_N^2}\\times1000',
 '$$',
 '',
 '$$',
 'W = \\begin{bmatrix}abcdefghij & klmnopqrst & uvwxyz \\\\ abcdefghij & klmnopqrst & uvwxyz\\end{bmatrix} \\cdot \\begin{bmatrix}a\\\\b\\\\c\\end{bmatrix}',
 '$$'
].join('\n');
const browser=await launchTestBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function api(path,method='GET',body){
 return page.evaluate(async({path,method,body})=>{
  const res=await fetch('/api'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  return {status:res.status,body:await res.json().catch(()=>null)};
 },{path,method,body});
}
function colorContrast(rgb,bg,behind){
 const nums=t=>[...t.matchAll(/[-+]?(?:\d+\.\d+|\d+|\.\d+)/g)].map(m=>Number(m[0]));
 const c=nums(rgb),b=nums(bg),k=nums(behind);
 const alpha=b[3]??1;
 const composite=b.slice(0,3).map((channel,i)=>(channel*alpha+k[i]*(1-alpha))/255);
 const light=arr=>arr.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const fg=light(c.slice(0,3).map(x=>x/255)),bb=light(composite);
 return (Math.max(fg,bb)+.05)/(Math.min(fg,bb)+.05);
}
async function measure(scope,theme){
 const selector=scope==='visual'?'.tiptap':'.markdown-preview';
 await page.locator(selector+' mark code').first().waitFor({timeout:18000});
 const state=await page.locator(selector+' mark code').first().evaluate(node=>{
  const c=getComputedStyle(node),m=getComputedStyle(node.closest('mark'));
  const plain=node.closest('.record-main')?.querySelector((node.closest('.tiptap')?'.tiptap':'.markdown-preview')+' code:not(mark code)');
  const mark=node.closest('mark');
  const codeBoxes=[...node.getClientRects()].map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right}));
  const markBoxes=[...(mark?.getClientRects()??[])].map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right}));
  return {
   color:c.color,textFill:c.webkitTextFillColor,background:c.backgroundColor,
   markBackground:m.backgroundColor,markColor:m.color,
   border:c.borderColor,fontFamily:c.fontFamily,
   plainBackground:plain?getComputedStyle(plain).backgroundColor:null,
   text:node.textContent,codeBoxes,markBoxes
  };
 });
 const contrast=colorContrast(state.color,state.background,state.markBackground);
 console.log('HIGHLIGHT_CODE',JSON.stringify({scope,theme,contrast:+contrast.toFixed(2),...state}));
 assert.ok(contrast>=7,'highlight+code should reach AAA contrast, including on dark mode');
 assert.equal(state.background,'rgba(0, 0, 0, 0)','highlighted code has no separate background');
 assert.ok(state.codeBoxes.every(box=>state.markBoxes.some(mark=>box.top>=mark.top-1 && box.bottom<=mark.bottom+1 && box.left>=mark.left-1 && box.right<=mark.right+1)),
  'inset code border must remain within the yellow highlight on each wrapped line');
 assert.ok(state.text.includes('R_T'));
 return state;
}
async function measureMathLayout(scope,theme){
 const selector=scope==='visual'?'.tiptap':'.markdown-preview';
 const geometry=await page.locator(selector).evaluate((root,scope)=>{
  const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
  const formulas=[...root.querySelectorAll('mark')].map(m=>{
   const node=m.querySelector(scope==='visual'?'[data-type="inline-math"]':'.katex');
   if(!node)return null;
   const actual=node.querySelector('.katex-html')??node;
   return {mark:rect(m),container:rect(node),glyphs:rect(actual),color:getComputedStyle(node).backgroundColor,markColor:getComputedStyle(m).backgroundColor,
     latex:node.getAttribute('data-latex')??actual.textContent?.slice(0,80)};
  }).filter(Boolean);
  const blocks=[...root.querySelectorAll(scope==='visual'?'[data-type="block-math"]':'.katex-display')].map(el=>{
   const content=scope==='visual'?el.querySelector('.block-math-inner'):el.querySelector(':scope > .katex');
   return {container:rect(el),formula:content?rect(content):null,scroll:el.scrollWidth,client:el.clientWidth,
     display:getComputedStyle(el).display,justify:getComputedStyle(el).justifyContent};
  });
  return {formulas,blocks};
 },scope);
 console.log('MATH_GEOMETRY',JSON.stringify({scope,theme,...geometry}));
 assert.ok(geometry.formulas.length>=2,'highlighted fraction and matrix must be actual KaTeX');
 for(const f of geometry.formulas){
  assert.equal(f.markColor,'rgb(245, 216, 112)','one outer mark supplies the yellow surface');
  assert.equal(f.color,'rgba(0, 0, 0, 0)','inner formula must not draw another background');
  assert.ok(f.mark.top<=f.glyphs.top+2 && f.mark.bottom>=f.glyphs.bottom-2 &&
    f.mark.left<=f.container.left+2 && f.mark.right>=f.container.right-2,
   'one outer mark box must enclose the complete height and width of the formula');
 }
 assert.ok(geometry.formulas.some(f=>f.container.height>30),
  'tall highlighted fraction or matrix must expand beyond regular line height');
 assert.ok(geometry.blocks.length>=2,'normal and oversized block math both render');
 for(const b of geometry.blocks){
  assert.ok(b.formula,'block KaTeX must have inner formula');
  if(b.scroll<=b.client+2){
   const containerCenter=(b.container.left+b.container.right)/2;
   const formulaCenter=(b.formula.left+b.formula.right)/2;
   assert.ok(Math.abs(containerCenter-formulaCenter)<4,'block math must be horizontally centered');
  } else {
   assert.ok(b.scroll>b.client,'oversized block math must remain horizontally scrollable');
  }
 }
}
try{
 await page.goto(testOrigin+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(testOrigin+'/',{timeout:25000});
 const created=await api('/records','POST',{name:'Highlight LaTeX E2E '+Date.now()+'.md',kind:'document',content:sample});
 assert.equal(created.status,201,JSON.stringify(created.body));
 const id=created.body.id;
 const original=await api('/records/'+id);
 assert.equal(original.status,200);
 assert.equal(original.body.content,sample);
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>localStorage.setItem('recalloom:mode',theme),theme);
  await page.goto(testOrigin+'/records/'+id+'?mode=visual',{waitUntil:'networkidle'});
  await page.locator('.tiptap mark code').first().waitFor({timeout:20000});
  await page.waitForFunction(expected=>document.documentElement.dataset.effectiveTheme===expected,theme);
  await measure('visual',theme);
  await measureMathLayout('visual',theme);
  assert.ok(await page.locator('.tiptap [data-type="inline-math"] .katex').count()>=2,
   'visual editor has rendered inline TeX');
  assert.ok(await page.locator('.tiptap [data-type="block-math"] .katex').count()>=1,
   'visual editor has rendered block TeX');
  const visualMath=await page.locator('.tiptap [data-type="block-math"]').first().textContent();
  assert.ok(visualMath?.includes('1000'),'KaTeX block displays the formula');
  if(theme==='dark'){
   await page.locator('.tiptap mark [data-type="inline-math"]').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:'tmp/highlight-math-dark-mobile.png',fullPage:false});
  }

  await page.getByRole('button',{name:'预览'}).click();
  await page.locator('.markdown-preview mark code').first().waitFor({timeout:20000});
  await measure('preview',theme);
  await measureMathLayout('preview',theme);
  assert.ok(await page.locator('.markdown-preview .katex-display .katex').count()>=1,
   'Markdown preview renders a display LaTeX equation');
  assert.ok(await page.locator('.markdown-preview .katex:not(.katex-display .katex)').count()>=2,
   'Markdown preview renders two inline LaTeX equations');
  if(theme==='dark'){
   await page.locator('.markdown-preview mark .katex').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:'tmp/highlight-math-dark-preview-mobile.png',fullPage:false});
  }
 }
 const after=await api('/records/'+id);
 assert.equal(after.status,200);
 assert.equal(after.body.content,sample,'visual/preview switching must never alter stored Markdown');
 // Confirm a real visual editor save preserves the highlight on atomic math,
 // not just the initial Markdown import and static preview.
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap h1').click();
 await page.keyboard.press('End');
 await page.keyboard.type(' - edited');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async recordId=>{
  const response=await fetch('/api/records/'+recordId);
  return response.ok&&(await response.json()).content.includes(' - edited');
 },id,{timeout:15000});
 const updated=await api('/records/'+id);
 assert.equal(updated.status,200);
 assert.ok(updated.body.content.includes('<mark>$\\frac{x+y}{z}$</mark>'),'fraction highlight survives visual save');
 assert.ok(updated.body.content.includes('<mark>$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$</mark>'),'matrix highlight survives visual save');
 assert.ok(updated.body.content.includes('<mark>$\\frac{p}{q}$</mark>'),'inline formula stays highlighted inside a mixed text span');
 assert.deepEqual(errors,[]);
 console.log('PASS: border-only highlighted code, full-height formula highlights, centered/scrollable block math, and visual-save fidelity in both themes/modes');
}finally{await browser.close()}
