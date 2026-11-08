import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const origin='http://127.0.0.1:8788';
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(executablePath&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const chunk=i=>[
 '## 测试章节 '+i,'','这一段包含 **加粗**、*斜体*、 :: badge OK | success :: 和普通链接 [参考](https://example.org)。',
 '第二段是用于模拟真实编辑的文本。用户会在这里不断输入内容。','','::: warning 注意事项','','保存不意味着自动提交修改，应保证草稿可以恢复。','',':::','',
 '~~~ts','const index'+i+'='+i+';','~~~','@ attrs code-'+i+' | file=example'+i+'.ts @','',''
].join('\n');
const fixture=size=>{let s='# CPU Profile\n\n',i=0;while(Buffer.byteLength(s,'utf8')<size*1024)s+=chunk(i++);return {content:s,sections:i,bytes:Buffer.byteLength(s,'utf8')}};
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1250,height:900}});
page.setDefaultTimeout(90000);
const api=(endpoint,data)=>page.evaluate(async({endpoint,data})=>{
 const r=await fetch('/api'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 return {status:r.status,body:await r.json().catch(()=>({}))};
},{endpoint,data});
const out=[];
try{
 await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/',{timeout:35000});
 for(const size of [10,50]){
  const f=fixture(size);
  const r=await api('/records',{name:'CPU-'+size+'KB-'+Date.now()+'.md',kind:'document',content:f.content});
  assert.equal(r.status,201);
  await page.goto(origin+'/records/'+r.body.id+'?mode=source',{waitUntil:'domcontentloaded'});
  await page.locator('.cm-content').waitFor();
  const session=await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval',{interval:1000});
  await session.send('Profiler.start');
  const t=Date.now();
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  await page.locator('.tiptap').waitFor();
  await page.waitForFunction(expected=>document.querySelectorAll('.tiptap .rk-code-block').length>=expected,f.sections,{timeout:100000});
  await page.waitForTimeout(250);
  const elapsed=Date.now()-t;
  const {profile}=await session.send('Profiler.stop');
  await session.detach();
  const ids=new Map(profile.nodes.map(n=>[n.id,n]));
  const samples=new Map();
  for(const id of profile.samples??[])samples.set(id,(samples.get(id)??0)+1);
  const inclusive=new Map();
  const parent=new Map();
  for(const n of profile.nodes)for(const child of n.children??[])parent.set(child,n.id);
  for(const [nodeId,count] of samples){
   let at=nodeId,depth=0;
   while(at&&depth++<100){inclusive.set(at,(inclusive.get(at)??0)+count);at=parent.get(at);}
  }
  const names=[...samples].map(([id,count])=>({id,count,name:ids.get(id)?.callFrame?.functionName||'(anonymous)',url:ids.get(id)?.callFrame?.url||'',line:ids.get(id)?.callFrame?.lineNumber??0,inclusive:inclusive.get(id)??0}))
   .sort((a,b)=>b.count-a.count).slice(0,40);
  const topInclusive=[...inclusive].map(([id,count])=>({id,count,name:ids.get(id)?.callFrame?.functionName||'(anonymous)',url:ids.get(id)?.callFrame?.url||'',line:ids.get(id)?.callFrame?.lineNumber??0}))
   .filter(x=>x.name!=='(root)'&&x.name!=='(program)').sort((a,b)=>b.count-a.count).slice(0,35);
  const counts=await page.evaluate(()=>({codes:document.querySelectorAll('.tiptap .rk-code-block').length,
   callouts:document.querySelectorAll('.tiptap [data-rk-kind],.tiptap .rk-callout').length,
   badges:document.querySelectorAll('.tiptap .rk-inline-badge').length,badgeHTML:document.querySelector('.tiptap .rk-inline-badge')?.outerHTML.slice(0,1700)??'',domNodes:document.querySelectorAll('.tiptap *').length,
   heapBytes:performance.memory?.usedJSHeapSize??null}));
  const data={size,bytes:f.bytes,sections:f.sections,elapsedMs:elapsed,samplingSamples:profile.samples?.length??0,counts,topSelf:names,topInclusive};
  out.push(data);
  console.log(JSON.stringify({size,elapsedMs:elapsed,samples:data.samplingSamples,counts,topSelf:names.slice(0,16).map(x=>({count:x.count,name:x.name,url:x.url.split('/').at(-1)}))}));
  writeFileSync('tmp/rmd-visual-cpu-profile-'+size+'kb.json',JSON.stringify({meta:data,profile},null,2));
 }
}finally{await browser.close().catch(()=>{});}
writeFileSync('tmp/rmd-visual-cpu-summary.json',JSON.stringify(out,null,2));
console.log('CPU_SUMMARY_SAVED');
