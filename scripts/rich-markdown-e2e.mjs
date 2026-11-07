import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';
const executables=[
 process.env.CHROMIUM_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);
const executablePath=executables.find(existsSync);
const match=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
const secret=match?.slice(match.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(executablePath&&secret);
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const lines=[
'---','title: Rich Markdown browser test','tags: [rich, qa]','# user comment','status: draft','---','','# Rich Markdown browser test','',
':::warning[安全提示]','','正文 **重要**，需要备份。','','- 第一步','- 第二步','',':::','',
':::details[补充说明]','','该内容应当可折叠。','',':::','',
'状态 :badge[已验证]{variant=success}，缩写 :abbr[DO]{title="Durable Objects"}，提示 :tip[点击]{content="额外内容"}。','',
'用户注释：%%暂不部署%%，应当可见且变小。','',
'多色 :highlight[危险]{color=red}。','',
'[GitHub](https://github.com/RavelloH/Recalloom)','',
'~~~typescript [src/sample.ts] wrap',
'const answer: number = 42;',
'console.log(answer);',
'~~~','',
':::future[暂不支持]','','QA_UNKNOWN_DIRECTIVE_KEEP','',':::','',
'## 锚点标题 {#qa-stable-heading}','','可引用的段落 **重要内容** ^qa-stable-block','',
'::::tabs','',':::tab[概览]','','QA_TABS_SUMMARY **加粗**。','',':::','',':::tab[源码]','','QA_TABS_CODE `render`。','',':::','','::::','',
'::::chat','',':::message[Agent A]{sender=assistant}','','Agent 回复 **保留源文件**。','',':::','',':::message[User]{sender=user}','','用户回复 *继续开发*。','',':::','','::::','',
'::link-card[项目主页]{url="https://github.com/RavelloH/Recalloom?tab=readme#readme"}','',
'脚注引用[^qa-rich]。','','[^qa-rich]: QA_RICH_FOOTNOTE_21 **验证脚注**。','',
'~~~mermaid','flowchart LR','  A[开始] --> B[完成]','~~~','','## 正常正文','','在这里修改并验证保存。'
];
const input=lines.join('\n');
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1400,height:950}});
const pageErrors=[];
const metadataRequests=[];
const thirdPartyImageRequests=[];
page.on('pageerror',e=>pageErrors.push(e.message));
page.on('request',r=>{
 if(r.url().startsWith('https://meta.ravelloh.com/'))metadataRequests.push(r.url());
 if(r.url().startsWith('https://github.githubassets.com/favicons/'))thirdPartyImageRequests.push(r.url());
});
const request=async(path,method='GET',payload)=>page.evaluate(async({path,method,payload})=>{
 const response=await fetch('/api'+path,{method,headers:payload?{'content-type':'application/json'}:{},
 body:payload?JSON.stringify(payload):undefined});
 return {status:response.status,body:await response.json().catch(()=>({}))};
},{path,method,payload});
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const created=await request('/records','POST',{name:'Rich-markdown-browser-'+Date.now()+'.md',kind:'document',content:input});
 assert.equal(created.status,201,JSON.stringify(created).slice(0,400));
 const id=created.body.id;
 await page.goto(base+'/records/'+id,{waitUntil:'networkidle'});
 await page.locator('.tiptap').waitFor({timeout:25000});
 const selectors={
  frontmatter:'.tiptap [data-rk-frontmatter]',
  warning:'.tiptap [data-rk-kind="warning"]',
  details:'.tiptap [data-rk-kind="details"]',
  badge:'.tiptap .rk-inline-badge',
  abbr:'.tiptap .rk-inline-abbr',
  tip:'.tiptap .rk-inline-tip',
  comment:'.tiptap [data-rk-comment]',
  red:'.tiptap mark[data-rk-color="red"]',
  brand:'.tiptap a[href^="https://github.com"]',
  code:'.tiptap [data-rk-code]',
  raw:'.tiptap [data-raw-markdown]',
  explicitHeading:'.tiptap h2#user-content-qa-stable-heading',
  explicitBlock:'.tiptap p#user-content-qa-stable-block',
  tabs:'.tiptap [data-rk-kind="tabs"]',
  tab:'.tiptap [data-rk-kind="tab"]',
  chat:'.tiptap [data-rk-kind="chat"]',
  message:'.tiptap [data-rk-kind="message"]',
  linkCard:'.tiptap [data-rk-link-card]',
  footnoteRef:'.tiptap [data-rk-footnote-ref]',
  footnoteDef:'.tiptap [data-rk-footnote-definition]',
  mermaid:'.tiptap [data-rk-mermaid]'
 };
 const fullLink='https://github.com/RavelloH/Recalloom';
 const metaDirect=await page.evaluate(async target=>{
  const r=await fetch('https://meta.ravelloh.com/?url='+encodeURIComponent(target),{credentials:'omit'});
  const j=await r.json();
  return {status:r.status,title:j.title,icon:j.icon};
 },fullLink);
 console.log('DIRECT_META',JSON.stringify(metaDirect).slice(0,450));
 assert.equal(metaDirect.status,200,'browser should query meta service directly');
 assert.ok(metaDirect.title,'full URL metadata title should exist');
 assert.ok(metadataRequests.some(url=>new URL(url).searchParams.get('url')===fullLink),'metadata service must receive complete link not just domain');
 const iconUrl=String(metaDirect.icon??'');
 assert.ok(iconUrl.startsWith('http'),'meta service should return remote icon URL');
 const imageResult=await page.evaluate(async img=>{
  const r=await fetch('/api/link-image?url='+encodeURIComponent(img)+'&site='+encodeURIComponent('https://github.com/'));
  const bytes=await r.arrayBuffer();
  return {status:r.status,type:r.headers.get('content-type'),cache:r.headers.get('cache-control'),len:bytes.byteLength};
 },iconUrl);
 console.log('AUTH_IMAGE_PROXY',JSON.stringify(imageResult));
 assert.equal(imageResult.status,200,'authenticated image proxy should return bytes');
 assert.ok(imageResult.type?.startsWith('image/'));
 assert.ok(imageResult.len>12);
 assert.equal(imageResult.cache,'private, no-store');
 const anonymous=await page.evaluate(async img=>(await fetch('/api/link-image?url='+encodeURIComponent(img)+'&site='+encodeURIComponent('https://github.com/'),{credentials:'omit'})).status,iconUrl);
 assert.equal(anonymous,401,'image proxy must reject requests without a session');
 const httpImage=await page.evaluate(async img=>{
  const r=await fetch('/api/link-image?url='+encodeURIComponent(img));
  return {status:r.status,type:r.headers.get('content-type'),size:(await r.arrayBuffer()).byteLength};
 },'http://ravelloh.com/icon/16x');
 console.log('HTTP_IMAGE_PROXY',JSON.stringify(httpImage));
 // External HTTP origin is not a deterministic fixture: it can be temporarily
 // unreachable to the local Cloudflare Worker, although the fake-fetch unit
 // test verifies HTTP origin bytes and private session policy.
 if(httpImage.status===200)assert.ok(httpImage.type?.startsWith('image/'));
 else console.log('EXTERNAL_HTTP_IMAGE_UNAVAILABLE',httpImage.status,'(upstream integration only; unit test remains authoritative)');
 assert.deepEqual(thirdPartyImageRequests,[],'browser must not request original icon CDN directly');
 const counts={};
 for(const [name,selector] of Object.entries(selectors))counts[name]=await page.locator(selector).count();
 console.log('RICH_COMPONENT_COUNTS',JSON.stringify(counts));
 const visible=await page.locator('.tiptap').textContent();
 console.log('VISIBLE_TEXT',JSON.stringify(visible?.slice(0,700)));
 assert.equal(counts.frontmatter,1,'YAML front matter should appear as Astryx metadata card');
 assert.equal(counts.warning,1,'warning container must render');
 assert.equal(counts.details,1,'folding container must render');
 assert.equal(counts.badge,1,'Badge must render');
 assert.equal(counts.abbr,1,'abbreviation must render');
 assert.equal(counts.tip,1,'Tooltip must render');
 assert.equal(counts.comment,1,'comment must render');
 assert.equal(counts.red,1,'colored highlight must render');
 assert.ok(counts.brand>=1,'external link must be present');
 assert.ok(counts.code>=2,'Shiki and Mermaid fenced code blocks should render');
 assert.ok(counts.raw>=1,'unknown directive still raw');
 assert.equal(counts.explicitHeading,1,'explicit heading ID should be used as a stable HTML anchor');
 assert.equal(counts.explicitBlock,1,'paragraph block ID should be used as a stable HTML anchor');
 assert.ok(!(await page.locator(selectors.explicitHeading).textContent())?.includes('{#'), 'explicit heading marker is only source syntax');
 assert.ok(!(await page.locator(selectors.explicitBlock).textContent())?.includes('^qa-stable-block'), 'explicit block ID should not leak into visible paragraph');
 assert.equal(counts.tabs,1,'Astryx Tabs should render');
 assert.equal(counts.tab,2,'both editable tab panels must remain mounted');
 const tabsRoot=page.locator('.tiptap [data-rk-kind="tabs"]');
 const tabsBefore=await tabsRoot.textContent();
 const tabButtons=tabsRoot.locator('[data-tab-value]');
 assert.ok(await tabButtons.count()>=2,'Astryx TabList controls must render');
 await tabButtons.nth(1).click();
 const tabsAfter=await tabsRoot.textContent();
 assert.ok(tabsBefore?.includes('QA_TABS_SUMMARY')&&tabsAfter?.includes('QA_TABS_CODE'),'switching tabs must not discard hidden editable content');
 assert.equal(counts.chat,1,'Astryx Chat should render');
 assert.equal(counts.message,2,'two role-based messages should render');
 assert.equal(counts.linkCard,1,'LinkCard should render');
 assert.equal(counts.footnoteRef,1,'GFM footnote reference should render');
 assert.equal(counts.footnoteDef,1,'GFM footnote definition should render');
 assert.equal(counts.mermaid,1,'Mermaid should mount');
 await page.locator('.tiptap [data-rk-mermaid] img').waitFor({timeout:28000});
 const cleanRequested=metadataRequests.some(url=>new URL(url).searchParams.get('url')==='https://github.com/RavelloH/Recalloom');
 assert.ok(cleanRequested,'Meta should receive the clean page URL');
 assert.equal(metadataRequests.some(url=>url.includes('tab%3Dreadme')),false,'Meta must not receive tracking/query params');
 console.log('NEW_RICH_NODES',JSON.stringify({chat:counts.chat,message:counts.message,linkCard:counts.linkCard,footnotes:counts.footnoteDef,mermaid:counts.mermaid}));
 const commentFont=await page.locator(selectors.comment).first().evaluate(el=>({
  font:getComputedStyle(el).fontSize,
  opacity:getComputedStyle(el).opacity,
  display:getComputedStyle(el).display,
  text:el.textContent
 }));
 console.log('COMMENT_STYLE',JSON.stringify(commentFont));
 assert.ok(commentFont.text?.includes('暂不部署'));
 const dirty=await page.getByRole('button',{name:'保存'}).isEnabled();
 console.log('DIRTY_AFTER_OPEN',dirty,'ICON_STATE',await page.locator(selectors.brand).first().getAttribute('data-rk-site-icon'));

 assert.ok(!dirty,'open does not change Markdown');
 const initial=await request('/records/'+id);
 assert.equal(initial.body.content,input,'open must not rewrite Markdown');
 await page.locator('.tiptap h2').last().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' 浏览器验证已完成');
 assert.ok(await page.getByRole('button',{name:'保存'}).isEnabled());
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>(await(await fetch('/api/records/'+id)).json()).content.includes('浏览器验证已完成'),id,{timeout:22000});
 const saved=(await request('/records/'+id)).body.content;
 assert.ok(saved.startsWith('---\ntitle: Rich Markdown browser test\ntags: [rich, qa]\n# user comment\nstatus: draft\n---'));
 assert.match(saved,/:::warning/);
 assert.match(saved,/:abbr\[DO\]/);
 assert.match(saved,/%%暂不部署%%/);
 assert.match(saved,/QA_UNKNOWN_DIRECTIVE_KEEP/);
 assert.match(saved,/src\/sample\.ts/);
 assert.match(saved,/## 锚点标题 \{#qa-stable-heading\}/);
 assert.match(saved,/重要内容\*\* \^qa-stable-block/);
 assert.match(saved,/::::tabs/);
 assert.match(saved,/:::tab\[概览\]/);
 assert.ok(saved.replaceAll('\\_','_').includes('QA_TABS_SUMMARY'),'Tabs content should be retained after Markdown-safe escaping');
 assert.ok(saved.replaceAll('\\_','_').includes('QA_TABS_CODE'),'Second tab content should be retained after Markdown-safe escaping');
 assert.match(saved,/::::chat/);
 assert.match(saved,/:::message\[Agent A\]\{sender=assistant\}/);
 assert.ok(saved.replaceAll('\\_','_').includes('QA_RICH_FOOTNOTE_21'),'normalized Markdown escapes in footnote must preserve semantics');
 assert.match(saved,/\[\^qa-rich\]/);
 assert.match(saved,/::link-card\[项目主页\]\{url="https:\/\/github.com\/RavelloH\/Recalloom\?tab=readme#readme"\}/);
 assert.ok(saved.includes('mermaid')&&saved.includes('flowchart LR'));
 console.log('SAVED_CONTENT_MARKERS',JSON.stringify({chars:saved.length,preview:saved.slice(0,500)}));
 await page.getByRole('group',{name:'内容视图'}).getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 await page.getByRole('group',{name:'内容视图'}).getByRole('button',{name:'可视化'}).click();
 await page.locator(selectors.warning).waitFor();
 assert.deepEqual(pageErrors,[],'no browser JS errors');
 console.log('PASS Rich Markdown browser: AST, Astryx nodes, direct full-URL metadata, private HTTP/HTTPS image proxy and real edits');
}finally{await browser.close();}
