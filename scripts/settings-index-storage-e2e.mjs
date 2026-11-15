/** Settings indexing/storage browser regression; isolated local D1 only. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE;assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const engine=process.env.RECALLOOM_E2E_BROWSER==='webkit'?'webkit':'chromium';
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(s=>s.startsWith('MCP_AUTH_SECRET='));
const secret=process.env.RECALLOOM_TEST_SECRET||line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath:bin}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark'});page.setDefaultTimeout(20000);
const faults=[];page.on('pageerror',e=>faults.push(e.message));let session='';
if(engine==='webkit')await page.route('**/api/**',async route=>{const request=route.request();const response=await route.fetch(session?{headers:{...await request.allHeaders(),cookie:session}}:undefined);if(new URL(request.url()).pathname==='/api/auth/login')session=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';await route.fulfill({response});});
const call=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch('/api'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};},{path,body});
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/');
 const one=(await call('/records',{name:'索引状态测试 · 长标题需要在移动端正常排列.md',content:'# Test\n\nIndex data',kind:'document'})).data;
 const two=(await call('/records',{name:'另一篇索引任务.md',content:'# Another',kind:'document'})).data;
 const summary=await call('/index?days=7');assert.equal(summary.status,200);assert.ok(summary.data.coverage.total>=2);
 const tasks=await call('/index/tasks');assert.equal(tasks.status,200);assert.ok(tasks.data.items.some(t=>t.record_id===one.id));
 const capacity=await call('/storage');assert.equal(capacity.status,200);assert.ok(capacity.data.documents.bytes>0);assert.equal(capacity.data.remote.count,null,'Unavailable remote metrics are not zero');
 // A bounded fixture gives native charts multi-point history without inventing
 // any application data or writing fake telemetry to the database.
 await page.route('**/api/index?**',async route=>{const request=route.request(),response=await route.fetch(session?{headers:{...await request.allHeaders(),cookie:session}}:undefined),data=await response.json();data.runs=[{time:'2026-11-15',completed:2,failed:1},{time:'2026-11-16',completed:3,failed:0}];data.samples=[{time:'2026-11-15T00:00:00Z',pending:3,running:1},{time:'2026-11-16T00:00:00Z',pending:1,running:0}];await route.fulfill({response,json:data});});
 await page.goto(base+'/settings/indexing',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'索引运行情况',exact:true}).waitFor();
 assert.equal(await page.locator('.settings-nav a.active').count(),1);
 await page.getByRole('button',{name:'诊断与维护',exact:true}).click();
 await page.getByRole('button',{name:'重新索引全部有效文稿',exact:true}).click();
 const rebuildDialog=page.getByRole('alertdialog',{name:'重新索引全部有效文稿？',exact:true});await rebuildDialog.waitFor();
 await rebuildDialog.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'诊断与维护',exact:true}).click();
 await page.locator('.index-chart-card svg').first().waitFor();assert.equal(await page.locator('.index-chart-card svg').count(),2);
 await page.getByRole('button',{name:one.name,exact:true}).waitFor();await page.screenshot({path:'tmp/settings-index-list-'+engine+'.png'});
 await page.getByRole('button',{name:one.name,exact:true}).click();await page.getByRole('complementary',{name:'索引详情：'+one.name,exact:true}).waitFor();
 await page.getByRole('button',{name:two.name,exact:true}).click();await page.getByRole('complementary',{name:'索引详情：'+two.name,exact:true}).waitFor();
 assert.equal(await page.locator('[data-workspace-panel^="index-"]:not([data-closing])').count(),2);
 await page.screenshot({path:'tmp/settings-index-desktop-'+engine+'.png'});
 await page.getByRole('complementary',{name:'索引详情：'+two.name,exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('complementary',{name:'索引详情：'+one.name,exact:true}).getByRole('button',{name:'重试任务',exact:true}).click();
 await page.getByRole('complementary',{name:'索引详情：'+one.name,exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('navigation',{name:'设置页面'}).getByRole('link',{name:'存储',exact:true}).click();await page.waitForURL(base+'/settings/storage');
 await page.getByRole('heading',{name:'存储容量',exact:true}).waitFor();await page.getByText('逻辑数据量',{exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.index-workspace').getAnimations({subtree:true}).some(a=>a.playState==='running'));
 await page.screenshot({path:'tmp/settings-storage-desktop-'+engine+'.png'});
 await page.goto('about:blank');await page.setViewportSize({width:390,height:844});await page.goto(base+'/settings/indexing',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:one.name,exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile horizontal overflow');
 await page.screenshot({path:'tmp/settings-index-mobile-'+engine+'.png'});
 await page.getByRole('button',{name:one.name,exact:true}).click();await page.getByRole('dialog',{name:'索引详情：'+one.name,exact:true}).waitFor();
 assert.deepEqual(faults,[]);console.log('PASS indexing/storage: live API, native charts, exact tabs, independent panels, retry, capacity and mobile',engine);
}catch(e){await page.screenshot({path:'tmp/settings-index-failure-'+engine+'.png'}).catch(()=>{});throw e;}finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
