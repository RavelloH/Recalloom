import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:8805';
const secret=readFileSync('.dev.vars','utf8').match(/MCP_AUTH_SECRET=([^\r\n]+)/)[1];
const report=JSON.parse(readFileSync('tmp/rmd-parity-audit.json'));
const exe='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({headless:true,executablePath:exe});
const page=await browser.newPage();
const output={};
await page.goto(base+'/login');await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/');
for(const [name,obj] of Object.entries(report.results)){
 output[name]={};
 for(const mode of ['visual','preview']){
  await page.goto(base+'/records/'+obj.id+'?mode='+mode);
  await page.locator(mode==='visual'?'.tiptap':'.markdown-preview').waitFor();
  output[name][mode]=await page.evaluate(()=>{
   const root=document.querySelector('.editor-view .tiptap,.editor-view .markdown-preview');
   const selector='mark,.rk-rmd-block-mark,.rk-rmd-callout,.rk-critic,.rk-inline-tooltip,.rk-tooltip-inline,.rk-flashcard,.rk-flashcard-read,.rk-tabs-preview,.rk-tabs-edit,.rk-rich-figure,.rk-table-caption,.rk-table-caption-read,.rk-numbered-math-projection,.katex-display';
   return [...root.querySelectorAll(selector)].slice(0,38).map(e=>{
    const css=getComputedStyle(e),r=e.getBoundingClientRect();
    return {tag:e.tagName,cls:typeof e.className==='string'?e.className:'',dataColor:e.getAttribute('data-rk-color'),text:(e.innerText||e.textContent||'').slice(0,60),bg:css.backgroundColor,font:css.fontSize,pad:css.padding,w:+r.width.toFixed(1),h:+r.height.toFixed(1)};
   });
  });
 }
}
writeFileSync('tmp/rmd-parity-elements.json',JSON.stringify(output,null,2));
for(const [name,value] of Object.entries(output)){console.log('GROUP',name);for(const mode of ['visual','preview']){console.log(mode,JSON.stringify(value[mode].filter(x=>['MARK'].includes(x.tag)||x.cls.includes('rk-tabs')).slice(0,8))) }}
await browser.close();
