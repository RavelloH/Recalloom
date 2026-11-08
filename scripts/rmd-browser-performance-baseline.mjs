import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright-core';
const origin='http://127.0.0.1:8788';
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(browserPath,'local Edge or Chrome required');
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^MCP_AUTH_SECRET\s*=/.test(line));
assert.ok(secretLine,'local development secret required');
const secret=secretLine.slice(secretLine.indexOf('=')+1).trim().replace(/^[\"']|[\"']$/g,'');
const calc=samples=>{const sorted=[...samples].sort((a,b)=>a-b); const pick=p=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]??null;return {count:sorted.length,medianMs:pick(.5),p95Ms:pick(.95),maxMs:sorted.at(-1)??null};};
const template=i=>[
 '## 测试章节 '+i,'',
 '这一段包含 **加粗**、*斜体*、 :: badge OK | success :: 和普通链接 [参考](https://example.org)。',
 '第二段是用于模拟真实编辑的文本。用户会在这里不断输入内容。','','::: warning 注意事项','','保存不意味着自动提交修改，应保证草稿可以恢复。','',':::','',
 '~~~ts','const index'+i+'='+i+';','~~~',
 '@ attrs code-'+i+' | file=example'+i+'.ts @','',''
].join('\n');
function createFixture(bytes){let s='# 编辑器性能基线\n\n';let n=0;while(Buffer.byteLength(s,'utf8')<bytes){s+=template(n++);}return {content:s,sections:n,bytes:Buffer.byteLength(s,'utf8')};}
const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1250,height:900}});
page.setDefaultTimeout(60000);
await page.addInitScript(()=>{
 window.__rmdBaseline={frames:[],longTasks:[]};
 const baseline=window.__rmdBaseline;
 try{const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())baseline.longTasks.push({duration:Math.round(e.duration*100)/100,startTime:Math.round(e.startTime)});}); observer.observe({type:'longtask',buffered:true});}catch{}
 document.addEventListener('keydown',event=>{if(event.key!=='x'||!event.target?.closest?.('.tiptap'))return;const start=performance.now();requestAnimationFrame(()=>baseline.frames.push(Math.round((performance.now()-start)*100)/100));},true);
});
const json=async(endpoint,options)=>page.evaluate(async({endpoint,options})=>{const r=await fetch('/api'+endpoint,options);return {status:r.status,body:await r.json().catch(()=>({}))};},{endpoint,options});
const result={createdAt:new Date().toISOString(),commit:process.env.RMD_BASELINE_COMMIT??'',browser:await browser.version(),browserPath,origin,method:{environment:'127.0.0.1 local Wrangler isolated D1, cached JS assets',input:'12 keydown x events, 40ms delay; time to next animation frame is input responsiveness proxy, not pure handler CPU',measurements:'navigation to visible, mode switch to visible, long tasks >=50ms, DOM editor key-to-RAF',repetitions:1},cases:[]};
try{
 await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/',{timeout:35000});
 for(const size of [10,50]){
  const f=createFixture(size*1024);
  const response=await json('/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'RMD-Baseline-'+size+'KB-'+Date.now()+'.md',kind:'document',content:f.content})});
  assert.equal(response.status,201,'local record creation failed '+JSON.stringify(response.body).slice(0,500));
  const recordId=response.body.id;
  const link=origin+'/records/'+recordId+'?mode=visual';
  const start=performance.now();
  await page.goto(link,{waitUntil:'domcontentloaded'});
  await page.locator('.tiptap').waitFor();
  const visualReadyMs=Math.round((performance.now()-start)*100)/100;
  const initial=await page.evaluate(()=>({heap:performance.memory?.usedJSHeapSize??null,longtasks:window.__rmdBaseline?.longTasks??[]}));
  await page.locator('.tiptap p').first().click();
  await page.keyboard.press('End');
  await page.evaluate(()=>{window.__rmdBaseline.frames=[];window.__rmdBaseline.longTasks=[];});
  const typingStart=performance.now();
  await page.keyboard.type('xxxxxxxxxxxx',{delay:40});
  await page.waitForTimeout(500);
  const typedMs=Math.round((performance.now()-typingStart)*100)/100;
  const input=await page.evaluate(()=>({frames:window.__rmdBaseline.frames,longTasks:window.__rmdBaseline.longTasks,heap:performance.memory?.usedJSHeapSize??null}));
  assert.ok(input.frames.length>=10,'keydown timings missing '+JSON.stringify(input.frames));
  const modes={};for(const [mode,selector]of [['source','.cm-content'],['preview','.markdown-preview'],['visual','.tiptap']]){
   const start=performance.now();
   await page.getByRole('button',{name:mode==='source'?'源码':mode==='preview'?'预览':'可视化',exact:true}).click();
   await page.locator(selector).first().waitFor();
   modes[mode]=Math.round((performance.now()-start)*100)/100;
  }
  const data={sizeKb:size,bytes:f.bytes,sections:f.sections,visualReadyMs,initialLongTasks:initial.longtasks.length,input:{totalTypingMs:typedMs,frameLatency:calc(input.frames),frameSamples:input.frames,longTaskCount:input.longTasks.length,longTaskMaxMs:Math.max(0,...input.longTasks.map(x=>x.duration)),longTaskTotalMs:Math.round(input.longTasks.reduce((sum,x)=>sum+x.duration,0)*100)/100,heapBeforeBytes:initial.heap,heapAfterBytes:input.heap},modeSwitchMs:modes};
  result.cases.push(data);
  console.log(JSON.stringify({sizeKb:size,bytes:f.bytes,sections:f.sections,visualReadyMs,input:data.input.frameLatency,longTasks:data.input.longTaskCount,modeSwitchMs:modes}));
 }
}finally{await browser.close().catch(()=>{});}
mkdirSync('tmp',{recursive:true});
writeFileSync('tmp/rmd-performance-baseline-browser.json',JSON.stringify(result,null,2)+'\n');
console.log('BROWSER_JSON_SAVED=tmp/rmd-performance-baseline-browser.json');
