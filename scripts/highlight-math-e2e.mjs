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
 '$$',
 'R_T = \\frac{\\Delta P_s U_N^2}{S_N^2}\\times1000',
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
  return {
   color:c.color,textFill:c.webkitTextFillColor,background:c.backgroundColor,
   markBackground:m.backgroundColor,markColor:m.color,
   border:c.borderColor,fontFamily:c.fontFamily,
   plainBackground:plain?getComputedStyle(plain).backgroundColor:null,
   text:node.textContent
  };
 });
 const contrast=colorContrast(state.color,state.background,state.markBackground);
 console.log('HIGHLIGHT_CODE',JSON.stringify({scope,theme,contrast:+contrast.toFixed(2),...state}));
 assert.ok(contrast>=7,'highlight+code should reach AAA contrast, including on dark mode');
 assert.notEqual(state.background,state.plainBackground,'highlighted code has a dedicated warm surface');
 assert.ok(state.text.includes('R_T'));
 return state;
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
  assert.ok(await page.locator('.tiptap [data-type="inline-math"] .katex').count()>=2,
   'visual editor has rendered inline TeX');
  assert.ok(await page.locator('.tiptap [data-type="block-math"] .katex').count()>=1,
   'visual editor has rendered block TeX');
  const visualMath=await page.locator('.tiptap [data-type="block-math"]').first().textContent();
  assert.ok(visualMath?.includes('1000'),'KaTeX block displays the formula');
  if(theme==='dark')await page.screenshot({path:'tmp/highlight-math-dark-mobile.png',fullPage:false});

  await page.getByRole('button',{name:'预览'}).click();
  await page.locator('.markdown-preview mark code').first().waitFor({timeout:20000});
  await measure('preview',theme);
  assert.ok(await page.locator('.markdown-preview .katex-display .katex').count()>=1,
   'Markdown preview renders a display LaTeX equation');
  assert.ok(await page.locator('.markdown-preview .katex:not(.katex-display .katex)').count()>=2,
   'Markdown preview renders two inline LaTeX equations');
  if(theme==='dark')await page.screenshot({path:'tmp/highlight-math-dark-preview-mobile.png',fullPage:false});
 }
 const after=await api('/records/'+id);
 assert.equal(after.status,200);
 assert.equal(after.body.content,sample,'visual/preview switching must never alter stored Markdown');
 assert.deepEqual(errors,[]);
 console.log('PASS: highlighted inline code contrast in both themes, visual/preview, mobile; inline/block KaTeX; unchanged Markdown');
}finally{await browser.close()}
