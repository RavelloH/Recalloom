import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const origin=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const bin=[process.env.CHROMIUM_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(bin&&line,'Local test browser and .dev.vars are required');
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');

const sections=Array.from({length:125},(_,i)=>[
 '## 性能检查章节 '+(i+1),
 '',
 ...Array.from({length:4},(_,j)=>'- 栏目 '+(i+1)+'-'+(j+1)+'：这是用于测试长文档渲染稳定性的内容。'.repeat(5)),
 '',
 '这一段用于测试 Tiptap 的正常段落与 inline **加粗**，页面加载后不应持续更新 DOM。',
 '',
 ...(i===0?['[GitHub 项目](https://github.com/RavelloH/Recalloom?tab=readme#readme)',''] :[])
].join('\n')).join('\n');
assert.ok(sections.length>60000,'test document must be representative of long records');
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage({viewport:{width:1320,height:890}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://meta.ravelloh.com/**',async route=>{
 await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({
  title:'Recalloom repository',siteName:'GitHub',description:'A Markdown knowledge base',
  icon:'https://github.com/favicon.ico',image:null
 })});
});
const cdp=await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const getMetrics=async()=>{
 const {metrics}=await cdp.send('Performance.getMetrics');
 return Object.fromEntries(metrics.filter(x=>['Nodes','LayoutCount','RecalcStyleCount','JSHeapUsedSize'].includes(x.name)).map(x=>[x.name,x.name==='JSHeapUsedSize'?Math.round(x.value/1024/1024):Math.round(x.value)]));
};
try{
 await page.goto(origin+'/login',{waitUntil:'domcontentloaded',timeout:25000});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/',{timeout:15000});
 const created=await page.evaluate(async content=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Favicon OOM regression '+Date.now()+'.md',kind:'document',content})});
  return {status:r.status,body:await r.json()};
 },sections);
 assert.equal(created.status,201,'Local fixture creation failed');
 await page.goto(origin+'/records/'+created.body.id,{waitUntil:'domcontentloaded',timeout:20000});
 await page.waitForFunction(()=>document.querySelectorAll('.tiptap h2').length>=120,null,{timeout:25000});
 const anchor=page.locator('.tiptap a[href^="https://github.com/RavelloH/Recalloom"]').first();
 await anchor.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('style[data-rk-editor-link-styles]')].some(x=>x.sheet?.cssRules.length),null,{timeout:12000});
 const icon=await anchor.evaluate(node=>({
  dataAttributes:[...node.attributes].filter(a=>a.name.startsWith('data-rk-site-')).map(x=>x.name),
  styleAttribute:node.getAttribute('style'),
  background:getComputedStyle(node,'::before').backgroundImage
 }));
 assert.deepEqual(icon.dataAttributes,[],'Never mutate ProseMirror-owned anchor attributes');
 assert.equal(icon.styleAttribute,null,'Never write inline styles to editor links');
 assert.ok(icon.background.includes('/api/link-image?'),'Icon should still use authenticated proxy CSS background');
 const before=await getMetrics();
 await page.waitForTimeout(4500);
 const after=await getMetrics();
 const delta={layout:after.LayoutCount-before.LayoutCount,style:after.RecalcStyleCount-before.RecalcStyleCount,nodes:after.Nodes-before.Nodes};
 console.log('LONG_DOC_METRICS',JSON.stringify({size:sections.length,before,after,delta,background:icon.background.slice(0,130)}));
 assert.ok(delta.layout<65,'Layout loop detected: '+JSON.stringify(delta));
 assert.ok(delta.style<130,'Continuous stylesheet reconciliation detected: '+JSON.stringify(delta));
 assert.ok(delta.nodes<2000,'Detached DOM nodes are continually increasing: '+JSON.stringify(delta));
 assert.ok(after.JSHeapUsedSize<200,'Unexpectedly high JS heap in editor');
 assert.ok(!errors.some(x=>/Maximum update depth|out of memory|RangeError/i.test(x)),errors.join('; '));
 assert.equal(await page.getByText('已保存',{exact:false}).count()>0,true,'Opening document must not mark it dirty');
 await page.getByRole('group',{name:'内容视图'}).getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-line').first().waitFor();
 await page.waitForFunction(()=>!document.querySelector('style[data-rk-editor-link-styles]'),null,{timeout:12000});
 console.log('PASS long document editor remains responsive, favicon is visible, private proxy is used, no DOM mutation or runaway layouts');
}finally{
 await browser.close().catch(()=>{});
}
