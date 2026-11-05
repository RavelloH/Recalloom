/** Graph palette visual regression: check Cytoscape colours, theme updates and geometry. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const browserPath=[
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
const secret=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(browserPath&&secret,'Missing local browser/secret');
const base='http://127.0.0.1:8898';
const browser=await chromium.launch({headless:true,executablePath:browserPath});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:920}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.evaluate(()=>localStorage.setItem('recalloom:mode','light'));
 await page.reload();
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:20000});
 const records=await page.evaluate(async()=>{
  const stamp=Date.now();
  const created=[];
  for(const name of ['Dark Palette Alpha','Dark Palette Beta','Dark Palette Gamma']){
   const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    name:name+' '+stamp,kind:'document',content:'# '+name+'\n\nKnowledge relationship.'})});
   if(!r.ok)throw Error('create fixture '+r.status);
   created.push(await r.json());
  }
  for(const [source,target,relation] of [
   [created[0].id,created[1].id,'references'],
   [created[2].id,created[0].id,'related']
  ]){
   const r=await fetch('/api/records/'+source+'/links',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'add',targetId:target,relation})});
   if(!r.ok)throw Error('link fixture '+r.status);
  }
  return created;
 });
 await page.goto(base+'/graph?focus='+records[0].id+'&semantic=false',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'知识关系网'}).waitFor({timeout:20000});
 await page.waitForFunction(()=>!!document.querySelector('.knowledge-graph-canvas')?._cyreg?.cy?.nodes()?.length,{timeout:15000});
 const inspect=()=>page.evaluate(id=>{
  const host=document.querySelector('.knowledge-graph-canvas');
  const cy=host?._cyreg?.cy;
  const node=cy?.$id(id);
  return {
   theme:document.documentElement.dataset.effectiveTheme,
   color:node?.style('color'),
   fill:node?.style('background-color'),
   border:node?.style('border-color'),
   focusFill:node?.selected()?node.style('background-color'):undefined,
   labelHalo:node?.style('text-outline-color'),
   edge:cy?.edges()?.first()?.style('line-color'),
   nodeCount:cy?.nodes()?.length,
   zoom:cy?.zoom(),
   selected:node?.selected(),
   htmlWidth:document.documentElement.scrollWidth,
   viewport:innerWidth
  };
 },records[0].id);
 const light=await inspect();
 assert.equal(light.theme,'light');
 assert.match(light.color??'',/rgb\(0,\s*0,\s*0\)/,'light text has real rgb black');
 assert.ok(light.nodeCount>=3);
 await page.screenshot({path:'tmp/graph-theme-after-light.jpg',type:'jpeg',quality:57});
 await page.evaluate(id=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy;
  cy.$id(id).select();
  cy.zoom(0.83);
 },records[0].id);
 const selectedBefore=await inspect();
 await page.getByRole('button',{name:'主题：浅色'}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.effectiveTheme==='dark',{timeout:8000});
 await page.waitForFunction(id=>{
  const cy=document.querySelector('.knowledge-graph-canvas')?._cyreg?.cy;
  return cy?.$id(id)?.style('color')?.includes('255');
 },records[0].id,{timeout:10000});
 const dark=await inspect();
 console.log('THEME_LIGHT',JSON.stringify(light));
 console.log('THEME_DARK',JSON.stringify(dark));
 assert.match(dark.color??'',/rgb\(255,\s*255,\s*255\)/,'dark text is bright');
 assert.notEqual(dark.fill,light.fill,'node fill responds to theme');
 assert.notEqual(dark.edge,light.edge,'edge colour responds to theme');
 assert.equal(dark.selected,true,'selection survives theme switch');
 assert.ok(Math.abs(dark.zoom-selectedBefore.zoom)<0.01,'zoom survives theme switch');
 await page.screenshot({path:'tmp/graph-theme-after-dark.jpg',type:'jpeg',quality:59});
 await page.getByRole('button',{name:'主题：深色'}).click();
 await page.getByRole('button',{name:'主题：跟随系统'}).waitFor();
 const system=await page.evaluate(()=>({actual:document.documentElement.dataset.effectiveTheme,
  expected:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}));
 assert.equal(system.actual,system.expected,'system theme tracks the OS preference');
 await page.getByRole('button',{name:'主题：跟随系统'}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.effectiveTheme==='light',{timeout:8000});
 await page.waitForFunction(id=>{
  const cy=document.querySelector('.knowledge-graph-canvas')?._cyreg?.cy;
  return /^rgb\(0,\s*0,\s*0\)$/.test(cy?.$id(id)?.style('color')??'');
 },records[0].id,{timeout:9000});
 const again=await inspect();
 assert.equal(again.fill,light.fill,'system light returns to the original palette');
 assert.equal(again.selected,true);
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(300);
 const mobile=await inspect();
 assert.ok(mobile.htmlWidth<=mobile.viewport+1,'mobile graph has no horizontal overflow');
 await page.screenshot({path:'tmp/graph-theme-after-mobile.jpg',type:'jpeg',quality:60});
 assert.deepEqual(errors,[]);
 console.log('PASS graph themes: real rgb colors, distinct node/edge palettes, dark/light switch, preserved zoom/selection, 390px mobile');
}finally{await browser.close();}
