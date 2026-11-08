import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8801';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'never test against production');
const executablePath=[
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(existsSync);
const envLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^MCP_AUTH_SECRET\s*=/.test(line));
assert.ok(executablePath&&envLine,'local browser and isolated test secret required');
const secret=envLine.slice(envLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1250,height:880}});
page.setDefaultTimeout(19000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const expectHelpContent=async text=>assert.ok((await page.locator('.rk-help-prose').innerText()).includes(text),'missing '+text);

try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});

 await page.goto(base+'/help',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'RMD 语法参考'}).waitFor();
 await expectHelpContent('RMD 1.0 语法帮助');
 const nav=page.getByRole('navigation',{name:'RMD 组件导航'});
 assert.ok(await nav.getByRole('button',{name:/badge/}).count());
 assert.ok(await nav.getByRole('button',{name:/mark/}).count()>=2);
 assert.ok(await nav.getByRole('button',{name:/图片/}).count());

 await nav.getByRole('button',{name:/badge/}).click();
 await expectHelpContent('RMD 组件：badge');
 await expectHelpContent('variant');
 await expectHelpContent('neutral');
 await expectHelpContent(':: badge 已完成 | success ::');
 const badges=page.locator('.rk-help-live-example');
 assert.equal(await badges.count(),1,'single component example has one matching rendered preview');
 const badgePreview=badges.first().locator('.markdown-preview');
 await badgePreview.waitFor();
 assert.ok((await badgePreview.innerText()).includes('已完成'),'Badge visual preview must render from source');
 assert.ok(await page.getByText('实际渲染效果').count(),'live preview has a visible label');
 const badgeRendered=await page.locator('.rk-help-prose table').count();
 assert.ok(badgeRendered>=1,'generated schema tables should be readable');

 await nav.getByRole('button',{name:/图片/}).click();
 await expectHelpContent('RMD 块属性：图片');
 await expectHelpContent('40–1800');
 await expectHelpContent('width');
 await expectHelpContent('caption');
 const figurePreview=page.locator('.rk-help-live-example .markdown-preview');
 await figurePreview.waitFor();
 assert.ok(await figurePreview.locator('figure.rk-rich-figure').count(),'image attributes render a real figure');
 assert.ok(await figurePreview.locator('figcaption').count(),'figure caption is visible');
 assert.ok(await page.locator('.rk-help-prose pre').count(),'Markdown examples should render as literal code');
 await nav.getByRole('button',{name:/mark/}).first().click();
 assert.equal(await page.locator('.rk-help-live-example').count(),2,'Mark shows both inline and block forms');
 await nav.getByRole('button',{name:/tabs/}).click();
 const tabExample=page.locator('.rk-help-live-example .markdown-preview');
 await tabExample.waitFor();
 assert.ok(await tabExample.getByText('第一项。').count(),'nested child component renders inside tabs');

 await nav.getByRole('button',{name:'完整参考手册'}).click();
 await expectHelpContent('RMD 1.0 完整语法参考（自动生成）');
 await expectHelpContent('29 种语法形式');
 await expectHelpContent('flashcard');
 assert.equal(await page.locator('.rk-help-live-example').count(),35,'every registered syntax form and @ attrs node shows a live example');
 assert.equal(await page.locator('.rk-help-prose script').count(),0,'help may not execute script tags');

 const search=nav.getByRole('searchbox',{name:'搜索 RMD 语法'});
 await search.fill('glossary');
 assert.equal(await nav.getByRole('button',{name:/badge/}).count(),0,'search should filter by schema');
 assert.ok(await nav.getByRole('button',{name:/glossary/}).count());
 await nav.getByRole('button',{name:/glossary/}).click();
 await expectHelpContent('合法子容器');
 await search.fill('no-such-rmd-component');
 await nav.getByText('没有符合条件的语法。').waitFor();
 await nav.getByRole('button',{name:'清空搜索'}).click();

 await page.setViewportSize({width:320,height:720});
 const mobile=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(mobile.scroll<=mobile.viewport+1,'RMD help page overflows at 320px: '+JSON.stringify(mobile));
 await nav.getByRole('button',{name:'使用说明'}).click();
 await expectHelpContent('页面仅展示语法说明');

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
}finally{
 await browser.close();
}
