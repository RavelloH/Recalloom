import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:8805';
const registry=JSON.parse(readFileSync('src/rmd/registry.json','utf8'));
const secret=readFileSync('.dev.vars','utf8').match(/MCP_AUTH_SECRET=([^\r\n]+)/)[1];
const colors=registry.colors;
const kinds=['note','info','tip','success','warning','danger','example','question'];
const source=[
 '# 深色模式组件颜色核验',
 ...colors.map(color=>'- :: highlight '+color+' | '+color+' ::'),
 '',
 ...colors.map(color=>'::: highlight | color='+color+'\n\n'+color+' block\n\n:::'),
 ...kinds.map(kind=>'::: '+kind+' '+kind+'\n\n'+kind+' content\n\n:::')
].join('\n\n');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page=await browser.newPage({viewport:{width:375,height:812},deviceScaleFactor:1});
page.setDefaultTimeout(22000);
await page.addInitScript(()=>localStorage.setItem('recalloom:mode','dark'));
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const result=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'RMD-dark-parity-'+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,body:await r.json()};
 },source);
 assert.equal(result.status,201,JSON.stringify(result));
 const output={};
 for(const mode of ['visual','preview']){
  await page.goto(base+'/records/'+result.body.id+'?mode='+mode);
  await page.locator('.editor-view '+(mode==='visual'?'.tiptap':'.markdown-preview')).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-effective-theme'),'dark');
  output[mode]=await page.evaluate(()=>{
   const root=document.querySelector('.editor-view .tiptap,.editor-view .markdown-preview');
   const colors=nodes=>[...root.querySelectorAll(nodes)].map(e=>{
    const s=getComputedStyle(e),rect=e.getBoundingClientRect();
    return {name:e.getAttribute('data-rk-color')||e.getAttribute('data-rk-kind'),bg:s.backgroundColor,color:s.color,w:rect.width,h:rect.height,icon:(e.querySelector('.astryx-banner-icon')?getComputedStyle(e.querySelector('.astryx-banner-icon')).color:null)};
   });
   return {inline:colors('mark[data-rk-color]'),blocks:colors('.rk-rmd-block-mark[data-rk-color]'),callouts:colors('.rk-rmd-callout'),overflow:document.documentElement.scrollWidth-innerWidth};
  });
  await page.screenshot({path:'tmp/parity-screens/mobile-dark-'+mode+'.png',fullPage:true});
  assert.equal(output[mode].inline.length,colors.length,'must have 9 highlights '+mode);
  assert.equal(output[mode].blocks.length,colors.length,'must have 9 block highlights '+mode);
  assert.equal(output[mode].callouts.length,kinds.length,'must have 8 callouts '+mode);
  assert.ok(output[mode].overflow<2,'mobile overflow '+mode+' '+output[mode].overflow);
 }
 for(const group of ['inline','blocks']){
  const a=output.visual[group],b=output.preview[group];
  for(let i=0;i<colors.length;i++){
   assert.equal(a[i].name,colors[i]);
   assert.equal(b[i].name,colors[i]);
   assert.equal(a[i].bg,b[i].bg,'Color '+colors[i]+' mismatch '+group);
  }
  assert.equal(new Set(a.map(x=>x.bg)).size,colors.length,'all nine colors should be distinct '+group);
 }
 for(let i=0;i<kinds.length;i++){
  assert.equal(output.visual.callouts[i].name,kinds[i]);
  assert.equal(output.preview.callouts[i].name,kinds[i]);
  assert.equal(output.visual.callouts[i].icon,output.preview.callouts[i].icon,'icon color '+kinds[i]);
 }
 assert.deepEqual(errors,[]);
 const saved=await page.evaluate(async id=>(await (await fetch('/api/records/'+id)).json()).content,result.body.id);
 assert.equal(saved,source);
 writeFileSync('tmp/rmd-parity-dark-colors.json',JSON.stringify(output,null,2));
 console.log('PASS DARK PHONE nine inline highlights, nine block highlights, eight Callouts, no overflow, preview parity');
 console.log(JSON.stringify({colors:output.preview.inline.map(x=>x.name+'='+x.bg),callouts:output.preview.callouts.map(x=>x.name+'='+x.icon)},null,2));
}finally{await browser.close();}
