/** Regression for 390px / 320px visual editor: nested directives, inline CriticMarkup, real Wiki embedding. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base='http://127.0.0.1:8788';
const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const entry=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(entry&&bin);
const secret=entry.slice(entry.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const create=async(content,name)=>{const r=await page.evaluate(async({content,name})=>{const res=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'document',name,content})});return {status:res.status,data:await res.json()}},{content,name});assert.equal(r.status,201,JSON.stringify(r));return r.data.id};
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded',timeout:22000});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:18000});
 const id=await create('# QA WIKI 目标\n\n## 独立目标\n\nQA_WIKI_TARGET：这是可以嵌入的真实正文。\n\n另一段。','Wiki test target '+Date.now()+'.md');
 const source=[
 '# iPhone Layout Reproduction','','## Nested details (old same-width fences)','',
 ':::details[更多细节]','','折叠区域内部有文本。','',':::warning[嵌套提示]','','QA_NESTED_BODY：折叠容器中的提示框。','',':::','',':::','',
 '## Nested details (safe wide outer fence)','','::::details[更多细节]','','折叠区域内部有文本。','',':::warning[嵌套提示]','','QA_NESTED_SAFE：可见的嵌套提示正文。','',':::','','::::','',
 '## CriticMarkup','',
 '删除：{--建议删除的内容--}。','','替换：{~~旧方案~>新方案~~}。','','强调：{==需要检查的依据==}。','',
 '批注：{>>请核对该结论的来源<<}。','','## Wiki Embed',
 '',
 '{{embed:id:'+id+'#独立目标}}','',''
 ].join('\n');
 const src=await create(source,'Mobile layout reproduction '+Date.now()+'.md');
 await page.goto(base+'/records/'+src,{waitUntil:'domcontentloaded',timeout:22000});
 await page.locator('.tiptap').waitFor({timeout:22000});
 await page.waitForTimeout(1000);
 // A malformed same-length outer/inner directive must remain verbatim,
 // not render an empty warning card or silently drop its body.
 const fallback=page.locator('.tiptap [data-raw-markdown]').filter({hasText:'QA_NESTED_BODY'});
 assert.equal(await fallback.count(),1,'ambiguous ::: nesting must be preserved as source');
 assert.ok((await fallback.textContent())?.includes('折叠容器中的提示框'));
 const warning=page.locator('.tiptap [data-rk-kind="details"] [data-rk-kind="warning"]');
 assert.equal(await warning.count(),1,'correctly fenced outer details should contain one editable warning');
 assert.ok((await warning.textContent())?.includes('QA_NESTED_SAFE'));
 await warning.getByText(/QA_NESTED_SAFE/).waitFor({state:'visible'});
 // Both CriticMarkup SVG icons must share a visual line with their text.
 const layout=async()=>page.locator('.tiptap').evaluate(root=>{
  const xy=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,middle:r.y+r.height/2};};
  const sub=root.querySelector('[data-rk-critic="substitution"]');
  const com=root.querySelector('[data-rk-critic="comment"]');
  if(!sub||!com)throw Error('missing CriticMarkup nodes');
  const old=sub.querySelector('.rk-critic-before'),arrow=sub.querySelector('svg'),proposal=sub.querySelector('.rk-critic-content');
  const icon=com.querySelector('svg'),comment=com.querySelector('.rk-critic-content');
  if(!old||!arrow||!proposal||!icon||!comment)throw Error('missing CriticMarkup segments');
  return {sub:[xy(old),xy(arrow),xy(proposal)],comment:[xy(icon),xy(comment)],scrollWidth:root.scrollWidth,clientWidth:root.clientWidth};
 });
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  const m=await layout();
  assert.ok(Math.abs(m.sub[0].middle-m.sub[1].middle)<14,'replacement arrow broke line at '+width+': '+JSON.stringify(m));
  assert.ok(Math.abs(m.sub[0].middle-m.sub[2].middle)<14,'replacement text broke line at '+width+': '+JSON.stringify(m));
  assert.ok(Math.abs(m.comment[0].middle-m.comment[1].middle)<14,'comment icon broke line at '+width+': '+JSON.stringify(m));
  assert.ok(m.scrollWidth<=m.clientWidth+2,'horizontal overflow at '+width+': '+JSON.stringify(m));
 }
 // A non-fenced real embed of ANOTHER record resolves to rendered Markdown.
 const embedded=page.locator('.tiptap .wiki-embed-body');
 await embedded.getByText(/QA_WIKI_TARGET/).waitFor({state:'visible',timeout:22000});
 assert.ok((await embedded.textContent())?.includes('QA_WIKI_TARGET'));
 assert.equal(await page.locator('.tiptap .wiki-editor-embed').count(),1);
 assert.equal(await page.locator('.tiptap [data-rk-critic="substitution"]').count(),1);
 assert.ok(await page.getByRole('button',{name:'保存'}).isDisabled(),'display and async embedding must not edit document');
 const original=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,src);
 assert.equal(original,source,'viewing must not alter the original Markdown');
 assert.deepEqual(errors,[]);
 console.log('PASS MOBILE_RICH_LAYOUT 390/320: non-lossy nested fences, proper warning content, inline review icons, live Wiki embed, no phantom writes');
}finally{await browser.close().catch(()=>{});}
