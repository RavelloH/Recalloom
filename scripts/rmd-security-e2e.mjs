import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8799';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(v=>/^MCP_AUTH_SECRET\s*=/.test(v));
assert.ok(executablePath&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const html=[
 '# RMD 审计示例 @ attrs audit-doc @','',
 '<script>window.__rmdAuditExecution=(window.__rmdAuditExecution||0)+1</script>','',
 '<img src="x" onerror="window.__rmdAuditExecution=1">','',
 '<svg onload="window.__rmdAuditExecution=1"><script>window.__rmdAuditExecution=1</script></svg>','',
 '<iframe srcdoc="<script>parent.__rmdAuditExecution=1</script>"></iframe>','',
 '<a href="javascript:window.__rmdAuditExecution=1" onclick="window.__rmdAuditExecution=1">恶意链接</a>','',
 '::: link-card javascript:window.__rmdAuditExecution=1 :::','',
 '::: link-card http://localhost/ :::','',
 '普通合法内容 :: mark **加粗安全高亮** ::，状态 :: badge 已完成 | success ::。','',
 '公式 $\\text{verbatim {++math++}}$ 与审阅 {++未批准++}。','',
 '%%','这段注释不显示。','%%','',
 '::: warning 安全边界','','未经验证的数据不会执行。','',':::'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:320,height:750}});
page.setDefaultTimeout(25000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=(endpoint,payload,method='GET')=>page.evaluate(async({endpoint,payload,method})=>{
 const response=await fetch('/api'+endpoint,{method,headers:payload?{'content-type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});
 return {status:response.status,body:await response.json().catch(()=>({}))};
},{endpoint,payload,method});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 try{await page.waitForURL(url=>url.pathname==='/',{timeout:12000});}catch(error){console.log('LOGIN_DEBUG',page.url(),(await page.locator('body').innerText()).slice(0,1050));throw error;}
 const created=await api('/records',{kind:'document',name:'RMD-security-'+Date.now()+'.md',content:html},'POST');
 assert.equal(created.status,201,JSON.stringify(created).slice(0,350));
 const id=created.body.id;
 await page.goto(base+'/records/'+id+'?mode=preview',{waitUntil:'domcontentloaded'});
 const preview=page.locator('.markdown-preview').first();
 await preview.waitFor();
 const check=await preview.evaluate(el=>({
  script:el.querySelectorAll('script,iframe,svg[onload],[onclick],[onerror],[onload]').length,
  unsafe:Array.from(el.querySelectorAll('a')).filter(x=>(x.getAttribute('href')||'').toLowerCase().startsWith('javascript:')).length,
  imgHandlers:Array.from(el.querySelectorAll('img')).filter(x=>x.hasAttribute('onerror')).length
 }));
 assert.equal(check.script,0,'all active HTML elements and event handlers must be removed '+JSON.stringify(check));
 assert.equal(check.unsafe,0,'javascript: links must not survive sanitize');
 assert.equal(check.imgHandlers,0);
 assert.equal(await page.evaluate(()=>window.__rmdAuditExecution??0),0,'no injected Javascript must execute');
 assert.ok(await preview.getByText('未经验证的数据不会执行。').count()>=1,'valid callouts remain');
 assert.ok(await preview.getByText('加粗安全高亮').count()>=1,'safe RMD Mark content renders');
 assert.ok((await preview.textContent()).includes('{++math++}'),'LaTeX Critic markup preserved');
 assert.ok(!(await preview.textContent()).includes('未批准'),'unaccepted review hidden: '+(await preview.textContent()).slice(-680));
 assert.ok(!(await preview.textContent()).includes('这段注释不显示'),'valid comment hidden');
 assert.equal(await preview.locator('.rk-link-card-open[href*="localhost"]').count(),0,'private loopback link cards must not be active');
 const width=await page.evaluate(()=>({
  viewport:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth
 }));
 console.log('MOBILE_WIDTH_AUDIT',width);
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await page.locator('.tiptap').waitFor();
 assert.ok(await page.locator('.tiptap').getByText('加粗安全高亮').count()>=1);
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true,'render must not dirty');
 assert.equal((await api('/records/'+id)).body.content,html,'unsafe HTML remains literal source, never silently modified');
 assert.deepEqual(errors,[]);
 console.log('PASS isolated RMD browser security: sanitize, invalid URL, math/comment, 320px, read-only, no writes');
}finally{await browser.close().catch(()=>{});}
