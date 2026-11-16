import {readLocalAuthVars} from './local-auth-config.mjs';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8801';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'never test against production');
const executablePath=[
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
const envLine=readLocalAuthVars().split(/\r?\n/).find(line=>/^MCP_AUTH_SECRET\s*=/.test(line));
assert.ok(executablePath&&envLine,'local browser and isolated test secret required');
const secret=envLine.slice(envLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const engine=process.env.RECALLOOM_E2E_BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath}:{})});
const page=await browser.newPage({viewport:{width:1250,height:880}});
if(engine==='webkit'){
 let cookie='';
 await page.route('**/api/**',async route=>{
  const request=route.request();
  const response=await route.fetch(cookie?{headers:{...await request.allHeaders(),cookie}}:undefined);
  if(new URL(request.url()).pathname==='/api/auth/login')cookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});
 });
}
page.setDefaultTimeout(19000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const expectHelpContent=text=>page.waitForFunction(text=>document.querySelector('.rk-help-prose')?.textContent.includes(text),text);
const expectTitle=title=>page.locator('.rk-help-title').filter({hasText:new RegExp('^'+title+'$')}).waitFor();
const mutations=[];
page.on('request',request=>{if(/\/api\/records/.test(request.url())&&['POST','PATCH','PUT','DELETE'].includes(request.method()))mutations.push(request.url());});

try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});

 await page.goto(base+'/help',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'RMD 语法帮助',exact:true}).waitFor();
 await expectHelpContent('Markdown 与 RMD 入门');
 const nav=page.getByRole('navigation',{name:'RMD 组件导航'});
 assert.ok(await nav.getByRole('button',{name:/badge/}).count());
 assert.equal(await nav.getByRole('button',{name:/^mark/}).count(),1,'multi-form components have one navigation entry');
 assert.ok(await nav.getByRole('button',{name:/图片/}).count());

 const outgoing=await page.evaluate(()=>{
  [...document.querySelectorAll('.rk-help-navigation button')].find(button=>button.textContent.trim()==='badge').click();
  return document.querySelector('.rk-help-title')?.textContent;
 });
 assert.equal(outgoing,'Markdown 与 RMD 入门','Outgoing help remains intact when the fade begins');
 await expectTitle('badge');
 await expectHelpContent('variant');
 await expectHelpContent('neutral');
 await expectHelpContent(':: badge 已完成 | success ::');
 const badges=page.locator('.rk-help-live-example');
 assert.equal(await badges.count(),1,'single component example has one matching rendered preview');
 await badges.first().scrollIntoViewIfNeeded();
 const badgePreview=badges.first().locator('.markdown-preview');
 await badgePreview.waitFor();
 assert.ok((await badgePreview.innerText()).includes('已完成'),'Badge visual preview must render from source');
 assert.ok(await page.getByText('实际渲染效果').count(),'live preview has a visible label');
 const badgeRendered=await page.locator('.rk-help-prose table').count();
 assert.ok(badgeRendered>=1,'generated schema tables should be readable');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__helpCopied=text;}}}));
 await page.locator('.rk-help-code').filter({hasText:':: badge 已完成 | success ::'}).getByRole('button',{name:'复制代码',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__helpCopied),':: badge 已完成 | success ::');

 await nav.getByRole('button',{name:/图片/}).click();
 await expectTitle('图片属性');
 await expectHelpContent('40–1800');
 await expectHelpContent('width');
 await expectHelpContent('caption');
 const figureExample=page.locator('.rk-help-live-example').first();
 await figureExample.scrollIntoViewIfNeeded();
 const figurePreview=figureExample.locator('.markdown-preview');
 await figurePreview.waitFor();
 assert.ok(await figurePreview.locator('figure.rk-rich-figure').count(),'image attributes render a real figure');
 assert.ok(await figurePreview.locator('figcaption').count(),'figure caption is visible');
 assert.ok(await page.locator('.rk-help-prose pre').count(),'Markdown examples should render as literal code');
 await nav.getByRole('button',{name:/mark/}).first().click();
 await expectTitle('mark');
 assert.equal(await page.locator('.rk-help-live-example').count(),2,'Mark shows both inline and block forms');
 await nav.getByRole('button',{name:/tabs/}).click();
 await expectTitle('tabs');
 const tabsExample=page.locator('.rk-help-live-example').first();
 await tabsExample.scrollIntoViewIfNeeded();
 const tabExample=tabsExample.locator('.markdown-preview');
 await tabExample.waitFor();
 assert.ok(await tabExample.getByText('第一项。').count(),'nested child component renders inside tabs');

 await nav.getByRole('button',{name:'完整参考手册'}).click();
 await expectTitle('RMD 1.0 完整语法参考');
 const registry=JSON.parse(readFileSync('src/rmd/registry.json','utf8'));
 await expectHelpContent(registry.components.length+' 种语法形式');
 await expectHelpContent('flashcard');
 assert.equal(await page.locator('.rk-help-live-example').count(),registry.components.length+registry.nodes.length,'every registered syntax form and @ attrs node shows a live example');
 assert.equal(await page.locator('.rk-help-prose script').count(),0,'help may not execute script tags');

 const search=nav.getByRole('searchbox',{name:'搜索 RMD 语法'});
 await search.fill('glossary');
 await nav.getByRole('button',{name:/badge/}).waitFor({state:'detached'});
 await nav.getByRole('button',{name:/glossary/}).click();
 await expectTitle('glossary');
 await expectHelpContent('definition');
 await search.fill('no-such-rmd-component');
 await nav.getByText('没有符合条件的语法。').waitFor();
 await nav.getByRole('button',{name:'清空搜索'}).click();
 await nav.getByRole('button',{name:'数学公式',exact:true}).click();
 await expectTitle('数学公式');
 await page.getByRole('button',{name:/^本页目录/}).click();
 await page.getByRole('option',{name:'给公式添加引用',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.rk-help-document-scroll .rk-scroll-viewport')?.scrollTop>100);
 assert.ok(!(await page.locator('.rk-help-prose').innerText()).includes('用户确认'));
 await page.screenshot({path:'tmp/help-desktop-'+engine+'.png'});

 await page.setViewportSize({width:320,height:720});
 const mobile=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(mobile.scroll<=mobile.viewport+1,'RMD help page overflows at 320px: '+JSON.stringify(mobile));
 await page.waitForTimeout(350);
 await nav.locator('.rk-help-mobile-toggle').click();
 await nav.getByRole('button',{name:'使用说明'}).click();
 await expectTitle('Markdown 与 RMD 入门');
 await page.emulateMedia({colorScheme:'dark'});
 await page.waitForTimeout(400);
 assert.equal(await nav.locator('.rk-help-mobile-toggle').getAttribute('aria-expanded'),'false','Mobile navigation collapses after choosing a page');
 await page.screenshot({path:'tmp/help-mobile-'+engine+'.png'});
 assert.deepEqual(mutations,[],'Reading help and trying examples does not edit records');

 // Source-mode autocomplete must work in a real CodeMirror editor,
 // not merely produce candidate arrays in unit tests.
 await page.setViewportSize({width:1250,height:880});
 const created=await page.evaluate(async()=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'RMD-auto-complete-qa-'+Date.now()+'.md',kind:'document',content:'源码补全测试。'})});
  return {status:r.status,body:await r.json()};
 });
 assert.equal(created.status,201,JSON.stringify(created));
 await page.goto(base+'/records/'+created.body.id+'?mode=source',{waitUntil:'domcontentloaded'});
 const cm=page.locator('.cm-content').first();
 await cm.waitFor();await cm.click();
 await page.keyboard.press('Control+End');
 await page.keyboard.press('Enter');
 await page.keyboard.type(':: ba',{delay:85});
 const popup=page.locator('.cm-tooltip-autocomplete').first();
 await popup.waitFor({timeout:12000});
 assert.match(await popup.innerText(),/badge/,'source editor should suggest registered component');
 console.log('PASS RMD CodeMirror live completion: :: ba → badge');
 const home=await page.goto(base+'/library',{waitUntil:'domcontentloaded'});
 assert.ok(home?.ok(),'navigation away from help should work');
 assert.deepEqual(errors,[],'browser runtime exceptions');
 console.log('PASS RMD WEB HELP: navigation, generated parameter tables, schema search, 320px, safe read-only help');
}catch(error){
 await page.screenshot({path:'tmp/help-failure-'+engine+'.png'}).catch(()=>{});throw error;
}finally{
 await page.unrouteAll({behavior:'ignoreErrors'});
 await browser.close();
}
