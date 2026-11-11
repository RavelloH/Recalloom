import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8799';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'isolation requires local dev server');
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(v=>/^MCP_AUTH_SECRET\s*=/.test(v));
assert.ok(browserPath&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const source=[
 'RMD 锚点及语法回归：这一段先于 H1，确保后续标题属于正文。',
 '',
 '# RMD QA @ attrs stable-heading @',
 '',
 '正文 :: mark **重要** ::，彩色 :: highlight 注意 | yellow ::，状态 :: badge 完成 | success ::。',
 '',
 '行内公式 :: mark $E=mc^2$ ::。',
 '',
 '有效注释 %%不要出现在预览%%，正常文字可见。',
 '',
 '%%',
 '隐藏的多行注释第一行',
 '隐藏的多行注释第二行',
 '%%',
 '',
 '无效 %%没有闭合',
 '',
 '审阅 A{++新增不批准++}B{--保留基线--}C{~~旧文本~>新文本~~}D{>>内部批注<<}。',
 '',
 '![实验](device.png) @ attrs fig-device | width=480 | caption=实验装置 @',
 '',
 '$$',
 'P=UI',
 '$$',
 '@ attrs eq-power @',
 '',
 '::: mark',
 '',
 '$$',
 'P=UI',
 '$$',
 '',
 ':::',
 '',
 '::: highlight | yellow',
 '',
 '这段内容是彩色强调。',
 '',
 ':::',
 '',
 '| 名称 | 状态 |',
 '| --- | --- |',
 '| 部署 | :: badge 已完成 | success :: |',
 '@ attrs tbl-parameters | caption=实验参数 @',
 '',
 '参见 [[#fig-device]]、[[#eq-power]]、[[#tbl-parameters]]。'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1250,height:900}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const json=async(endpoint,options)=>page.evaluate(async({endpoint,options})=>{
 const r=await fetch('/api'+endpoint,options);
 return {status:r.status,body:await r.json().catch(()=>({}))};
},{endpoint,options});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const created=await json('/records',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({kind:'document',name:'RMD-v1-local-'+Date.now()+'.md',content:source})});
 assert.equal(created.status,201,JSON.stringify(created).slice(0,500));
 const id=created.body.id;
 await page.goto(base+'/records/'+id+'?mode=preview',{waitUntil:'domcontentloaded'});
 await page.locator('.markdown-preview').first().waitFor({timeout:20000});
 assert.equal(await page.getByRole('button',{name:'预览',exact:true}).count(),1);
 const preview=page.locator('.markdown-preview').first();
 const html=await preview.innerHTML();
 assert.ok(html.includes('data-rk-sketch-kind="highlight"')&&html.includes('data-rk-sketch-color="yellow"'),'static sketch highlight actual DOM: '+html.slice(0,850));
 assert.ok(await preview.locator('mark:not([data-rk-color])').count()>=2,'default mark present');
 assert.ok(await preview.locator('.rk-rmd-block-mark').count()>=1,'semantic block mark rendered');
 assert.ok(await preview.locator('.rk-sketch-block[data-rk-sketch-kind="highlight"]').count()>=1,'hand-drawn block highlight rendered');
 assert.ok(await preview.locator('table tbody tr').count()===1,'valid GFM row');
 assert.equal(await preview.locator('table tbody tr td').count(),2,'component | is not GFM separator');
 assert.equal(await preview.locator('.rk-inline-badge').count(),0,'preview badge uses Astryx component, not edit NodeView');
 assert.ok(await preview.getByText('完成',{exact:true}).count()>=1,'badge label rendered');
 assert.ok(!(await preview.textContent()).includes('不要出现在预览'),'inline comment removed');
 assert.ok(!(await preview.textContent()).includes('隐藏的多行注释'),'block comment removed');
 assert.ok((await preview.textContent()).includes('%%没有闭合'),'invalid comment survives as prose');
 assert.ok(!(await preview.textContent()).includes('新增不批准'),'pending addition not autoaccepted');
 assert.ok((await preview.textContent()).includes('保留基线'),'pending deletion still visible');
 assert.ok((await preview.textContent()).includes('旧文本'),'pending replacement shows old');
 assert.ok(!(await preview.textContent()).includes('新文本'),'pending replacement new is hidden');
 assert.equal((await preview.getByText('RMD QA').count()),1);
 assert.equal(await preview.locator('h1').first().getAttribute('id'),'user-content-stable-heading');
 assert.equal(await preview.locator('.rk-cross-reference-read').count(),3,'three resolved RMD cross references');
 assert.ok((await preview.locator('.rk-cross-reference-read').allTextContents()).some(t=>t.includes('公式')));
 assert.ok((await preview.locator('.rk-table-caption-read').allTextContents()).some(t=>t.includes('实验参数')));
 assert.ok((await preview.locator('.rk-rich-figcaption').allTextContents()).some(t=>t.includes('图 1')));
 const markColor=await preview.locator('mark:not([data-rk-color])').first().evaluate(node=>getComputedStyle(node).backgroundColor);
 const blockColor=await preview.locator('.rk-rmd-block-mark:not([data-rk-color])').first().evaluate(node=>getComputedStyle(node).backgroundColor);
 console.log('MARK_BASELINE_COLORS',markColor,blockColor);
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 assert.ok((await page.locator('.cm-content').innerText()).includes('%%不要出现在预览%%'));
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await preview.waitFor();
 assert.equal((await json('/records/'+id)).body.content,source,'mode changes never write to D1');
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'preview does not create dirty state');
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(260);
 const width=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
 assert.ok(width.page<=width.viewport+2,'mobile root horizontal overflow '+JSON.stringify(width));
 assert.deepEqual(errors,[],'React browser exceptions');
 console.log('PASS three-mode preview, comments, reviews, GFM badge, mark/highlight, math, attrs, mobile, no D1 writes');
}finally{await browser.close().catch(()=>{});}
