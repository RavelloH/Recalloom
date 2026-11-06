import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchTestBrowser,testOrigin} from './local-browser.mjs';
const secret=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET=/.test(x))?.split('=')[1]?.trim();
assert.ok(secret);
const sample=[
 '# Highlighted display math',
 '',
 '<mark>','$$','Z_B=\\frac{U_B^2}{S_B},\\qquad I_B=\\frac{S_B}{\\sqrt{3}U_B}','$$','</mark>',
 '',
 '<mark>','','$$','\\begin{aligned}R_T &= \\frac{\\Delta P_s U_N^2}{S_N^2}\\\\ X_T &= \\frac{U_s\\%}{100}\\frac{U_N^2}{S_N}\\end{aligned}','$$','','</mark>',
 '',
 'Unmarked display:','',
 '$$','E=mc^2','$$',
 '',
 'Inline fraction: <mark>$\\frac{x+y}{z}$</mark> and matrix <mark>$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$</mark>.',
 '',
 'Mixed mark: <mark>Power $\\frac{p}{q}$ matters a lot.</mark>.'
].join('\n');
const browser=await launchTestBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const api=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{
 const r=await fetch('/api'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json().catch(()=>null)};
},{path,method,body});
async function verify(mode){
 const scope=mode==='visual'?'.tiptap':'.markdown-preview';
 const actual=await page.locator(scope).evaluate((root,mode)=>{
  const rect=x=>{const b=x.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom,right:b.right};};
  const blocks=[...root.querySelectorAll(mode==='visual'?'.rk-highlighted-block-math':'[data-highlighted-math]')].map(n=>{
   if(mode==='preview')console.log('PREVIEW_MARKED_BLOCK_HTML',n.outerHTML.slice(0,900));
   const math=n.querySelector(mode==='visual'?'.block-math-inner':'.katex-display');
   return {rect:rect(n),math:math?rect(math):null,bg:math?getComputedStyle(math).backgroundColor:null,formula:!!n.querySelector('.katex'),html:n.outerHTML.slice(0,1000)};
  });
  const marks=[...root.querySelectorAll('mark')].filter(n=>n.querySelector('.katex')).map(n=>{
   const formula=n.querySelector(mode==='visual'?'[data-type="inline-math"]':'.katex');
   return {mark:rect(n),formula:rect(formula),display:getComputedStyle(n).display,
    bg:getComputedStyle(n).backgroundColor,innerBg:getComputedStyle(formula).backgroundColor};
  });
  return {blocks,marks,raw:(root.textContent??'').includes('<mark>'),overflow:root.scrollWidth-root.clientWidth};
 },mode);
 console.log('RESULT',mode,JSON.stringify(actual).slice(0,3200));
 assert.equal(actual.blocks.length,2);
 assert.ok(actual.blocks.every(x=>x.formula&&x.bg==='rgb(245, 216, 112)'));
 assert.ok(actual.marks.length>=3);
 assert.ok(actual.marks.every(x=>x.display==='inline-flex'&&x.bg==='rgb(245, 216, 112)'&&x.innerBg==='rgba(0, 0, 0, 0)'));
 assert.ok(actual.marks.every(x=>x.mark.y<=x.formula.y+.5&&x.mark.bottom>=x.formula.bottom-.5));
 assert.ok(actual.marks.every(x=>x.mark.x<=x.formula.x+.5&&x.mark.right>=x.formula.right-.5));
 assert.ok(!actual.raw&&actual.overflow<5);
}
try{
 await page.goto(testOrigin+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(testOrigin+'/',{timeout:24000});
 const created=await api('/records','POST',{name:'Marked display math '+Date.now()+'.md',kind:'document',content:sample});
 assert.equal(created.status,201,JSON.stringify(created));
 const id=created.data.id;
 for(const theme of ['dark','light']){
  await page.evaluate(t=>localStorage.setItem('recalloom:mode',t),theme);
  await page.goto(testOrigin+'/records/'+id+'?mode=visual',{waitUntil:'networkidle'});
  await page.locator('.rk-highlighted-block-math').first().waitFor({timeout:18000});
  await verify('visual');
  if(theme==='dark')await page.screenshot({path:'tmp/marked-display-visual.png'});
  await page.getByRole('button',{name:'预览'}).click();
  await page.locator('[data-highlighted-math]').first().waitFor({timeout:18000});
  await verify('preview');
  if(theme==='dark')await page.screenshot({path:'tmp/marked-display-preview.png'});
 }
 assert.equal((await api('/records/'+id)).data.content,sample);
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap h1').click();
 await page.keyboard.press('End');
 await page.keyboard.type(' edited');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{const r=await fetch('/api/records/'+id);return r.ok&&(await r.json()).content.includes(' edited')},id,{timeout:18000});
 const updated=(await api('/records/'+id)).data.content;
 assert.equal((updated.match(/<mark>\n\$\$/g)??[]).length,2,'marked blocks remain marked after a real edit');
 assert.ok(updated.includes('Z_B=\\frac{U_B^2}{S_B}'));
 assert.deepEqual(errors,[]);
 console.log('PASS marked block math parsing, single-area inline highlight, preview/edit parity and save');
}finally{await browser.close()}
