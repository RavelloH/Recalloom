import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8799';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(executablePath&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const source=[
'RMD 完整属性验收：以下 H1 位于正文中，用于检查标题属性和 Drawer。',
'',
'# 视觉一致性 @ attrs parity-heading @',
'',
'属性所在段落。 @ attrs parity-paragraph @',
'',
'::: mark',
'',
'$$',
'E=mc^2',
'$$',
'@ attrs eq-marked @',
'',
':::',
'',
'::: mark',
'',
'正文与公式同处一个标记。',
'',
'$$',
'U=IR',
'$$',
'',
':::',
'',
'$$',
'P=UI',
'$$',
'@ attrs eq-sample @',
'',
'| 项目 | 数值 |',
'| :--- | ---: |',
'| 电阻 | 10 Ω |',
'| 电压 | 220 V |',
'@ attrs tbl-sample | caption=系统参数 @',
'',
'::: note 观察',
'',
'带有唯一语义图标。',
'',
':::',
'',
'::: success 完成',
'',
'已经通过测试。',
'',
':::',
'',
...['info','tip','warning','danger','example','question'].flatMap(kind=>['::: '+kind+' '+kind,'','语义色标题测试。','',':::','']),
'::: link-card https://github.com/RavelloH/Recalloom?tab=readme#section | title=Recalloom :::',
'',
'~~~typescript',
'const pi = 3.14;',
'~~~',
'@ attrs code-main | file=sample.ts | wrap=true @',
'',
'![实验装置](/examples/device.svg "示意图片") @ attrs fig-example | width=420 | caption=实验设备 @'
].join('\n');
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1180,height:850}});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
// Deterministic public metadata fixture: visual and preview must use the
// same compact card, including its optional, real image-proxy thumbnail.
await page.route('https://meta.ravelloh.com/**',route=>route.fulfill({status:200,
 contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({
 title:'Recalloom · 知识库',description:'多端知识管理与 Markdown 可视化编辑。',siteName:'GitHub',
 finalUrl:'https://github.com/RavelloH/Recalloom',icon:'https://github.com/favicon.ico',image:'https://github.com/example-og.png'})}));
await page.route('**/api/link-image?**',route=>route.fulfill({status:200,contentType:'image/png',
 body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Uoe2GsAAAAASUVORK5CYII=','base64')}));
const api=(endpoint,data,method='GET')=>page.evaluate(async({endpoint,data,method})=>{
 const response=await fetch('/api'+endpoint,{method,headers:data?{'content-type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});
 return {status:response.status,body:await response.json().catch(()=>({}))};
},{endpoint,data,method});
const measure=()=>page.evaluate(()=>{
 const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)};};
 const root=document.querySelector('.tiptap')??document.querySelector('.markdown-preview');
 const marks=Array.from(root?.querySelectorAll('.rk-rmd-block-mark')??[]);
 const tables=Array.from(root?.querySelectorAll('table')??[]);
 const calls=Array.from(root?.querySelectorAll('.rk-rmd-callout')??[]);
 return {
  root:root?.className,
  marks:marks.map(el=>({rect:rect(el),children:el.children.length})),
  tables:tables.map(el=>({rect:rect(el),parent:rect(el.parentElement),display:getComputedStyle(el).display,margin:getComputedStyle(el).marginInlineStart})),
  maths:Array.from(root?.querySelectorAll('.katex-display')??[]).map(el=>rect(el)),
  attrs:Array.from(root?.querySelectorAll('.rk-rmd-attrs-decoration')??[]).map(el=>({name:el.getAttribute('aria-label'),kind:el.getAttribute('data-rk-attrs-kind'),rect:rect(el)})),
  callouts:calls.map(el=>{
   const banner=el.querySelector('.astryx-banner');
   const icon=el.querySelector('.astryx-banner-icon');
   const title=banner?.querySelector(':scope > div:nth-child(2) > div');
   const bannerStyle=banner?getComputedStyle(banner):null;
   return {
    kind:el.getAttribute('data-rk-kind'),size:rect(icon),iconSvg:rect(icon?.querySelector('svg')),
    color:icon?getComputedStyle(icon).color:null,titleColor:title?getComputedStyle(title).color:null,
    titleRect:rect(title),titleFontSize:title?Number.parseFloat(getComputedStyle(title).fontSize):null,
    headerBg:bannerStyle?.backgroundColor,borderLeft:bannerStyle?.borderLeftWidth,
    rect:rect(el)
   };
  }),
  link:(()=>{const card=root?.querySelector('.rk-link-card');return {box:rect(card),image:rect(card?.querySelector('.rk-link-card-image')),text:rect(card?.querySelector('.rk-link-card-text'))};})(),
  scrollWidth:document.documentElement.scrollWidth
 };
});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const created=await api('/records',{kind:'document',name:'RMD-parity-'+Date.now()+'.md',content:source},'POST');
 assert.equal(created.status,201,JSON.stringify(created));
 const id=created.body.id;
 await page.goto(base+'/records/'+id+'?mode=visual',{waitUntil:'domcontentloaded'});
 await page.locator('.tiptap .rk-rmd-block-mark').first().waitFor();
 await page.locator('.tiptap .rk-link-card-image').first().waitFor();
 const visual=await measure();
 assert.equal(visual.marks.length,2);
 assert.ok(visual.marks[0].rect.w<200,'formula-only Mark must hug the formula: '+JSON.stringify(visual.marks));
 assert.ok(visual.marks[1].rect.w>visual.marks[0].rect.w*3,'mixed Mark retains full measure');
 assert.ok(visual.tables[0].rect.w<visual.tables[0].parent.w);
 assert.ok(Math.abs((visual.tables[0].rect.x+visual.tables[0].rect.w/2)-(visual.tables[0].parent.x+visual.tables[0].parent.w/2))<2,'table centered in visual');
 assert.equal(visual.callouts.length,8,'all eight Callout variants render in visual mode');
 assert.ok(visual.callouts.every(x=>x.size.w===16&&x.size.h===16&&x.iconSvg.w===16&&x.iconSvg.h===16&&x.titleFontSize===14),'callout icon is a centered 16px control glyph beside 14px title');
 assert.ok(visual.callouts.every(x=>x.color===x.titleColor&&x.borderLeft==='0px'),'callout icon/title use one semantic color with no left stripe');
 assert.ok(visual.callouts.every(x=>Math.abs(x.size.y+x.size.h/2-x.titleRect.y-x.titleRect.h/2)<2),'callout icon vertically aligns with title');
 assert.ok(visual.callouts.every(x=>x.headerBg&&x.headerBg!=='rgb(185, 215, 255)'),'callout header must use semantic tint, not shared blue');
 assert.notEqual(visual.callouts[0].color,visual.callouts[1].color,'callout kinds have distinct colors');
 assert.ok(visual.link.box&&visual.link.text,'link-card must render in visual mode');
 const bookmark=page.locator('.tiptap .rk-link-card-open').first();
 assert.ok((await bookmark.getAttribute('href'))?.includes('?tab=readme#section'),'link card must retain the exact navigational query and anchor');
 if(visual.link.image)assert.ok(visual.link.image.x>visual.link.text.x,'image is on the right of compact bookmark text');
 const eqHint=visual.attrs.find(x=>x.kind==='blockMath');
 assert.ok(eqHint&&Math.abs(eqHint.rect.x+eqHint.rect.w/2-(visual.tables[0].parent.x+visual.tables[0].parent.w/2))<10,'centered formula attr is centered');
 console.log('PASS VISUAL_LAYOUT',JSON.stringify({marks:visual.marks.map(x=>x.rect.w),table:visual.tables[0].rect,icons:visual.callouts.map(x=>[x.kind,x.color,x.size.w]),link:visual.link,eqHint:eqHint.rect}));
 const control=page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="heading"]').first();
 const panel=page.getByRole('complementary',{name:'块编辑面板'});
 const close=async()=>{await panel.getByRole('button',{name:'关闭块编辑'}).click();await panel.waitFor({state:'hidden'});};
 await control.waitFor();await control.focus();await control.press('Enter');
 await panel.waitFor();
 assert.equal(await panel.getByRole('region',{name:'标题 Markdown 属性'}).count(),1,'attribute badge uses shared sidebar');
 await close();
 assert.equal((await api('/records/'+id)).body.content,source,'closing shared sidebar never writes to D1');
 await control.click();
 await panel.waitFor();
 console.log('ATTRS_OPEN',await panel.innerText());
 await panel.getByRole('textbox',{name:'稳定 ID（可选）'}).fill('9invalid');
 await panel.getByRole('alert').waitFor();
 assert.ok((await panel.getByRole('alert').textContent()).includes('ID'));
 assert.equal((await api('/records/'+id)).body.content,source,'invalid changes never touch D1');
 await panel.getByRole('textbox',{name:'稳定 ID（可选）'}).fill('parity-renamed');
 await page.locator('.tiptap button[data-rk-attrs-kind="heading"]').first().getByText('@ attrs parity-renamed @').waitFor();
 await close();
 const edit=async(kind,idValue,fields={})=>{
  await page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="'+kind+'"]').first().click();
  await panel.waitFor();
  await panel.getByRole('textbox',{name:'稳定 ID（可选）'}).fill(idValue);
  for(const [name,value] of Object.entries(fields)){
   if(typeof value==='boolean'){const check=panel.getByRole('checkbox',{name});if(await check.isChecked()!==value)await check.click();}
   else await panel.getByRole('textbox',{name}).fill(value);
  }
  await close();
 };
 await edit('paragraph','parity-text');
 await edit('blockMath','eq-edited');
 await edit('table','tbl-edited',{'图注':'更新后的图注'});
 await edit('codeBlock','code-edited',{'文件名':'edited.ts','默认展开':true});
 await edit('image','fig-edited',{'宽度 px':'480','图注':'新插图说明'});
 // Mapped widgets must use the live position after text is inserted before them.
 await page.locator('.tiptap > p').first().click();
 await page.keyboard.press('Home');
 await page.keyboard.type('移动前文位置 ');
 await page.locator('.tiptap button.rk-rmd-attrs-decoration[data-rk-attrs-kind="codeBlock"]').first().click();
 await panel.waitFor();
 assert.equal(await panel.getByRole('textbox',{name:'文件名'}).inputValue(),'edited.ts','mapped attrs marker must still edit its own block');
 await close();
 assert.equal((await api('/records/'+id)).body.content,source,'all live sidebar edits remain unsaved until explicit save');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.locator('.markdown-preview').waitFor();
 const preview=await measure();
 assert.ok(preview.marks[0].rect.w<200,'preview formula Mark must be content width');
 assert.ok(Math.abs(preview.marks[0].rect.w-visual.marks[0].rect.w)<8,'formula Mark width should agree between modes');
 assert.ok(Math.abs(preview.tables[0].rect.w-visual.tables[0].rect.w)<5,'tables are consistent between modes');
 assert.equal(preview.callouts.length,8,'all eight Callout variants render in preview mode');
 assert.ok(preview.callouts.every(x=>x.size.w===16&&x.size.h===16&&x.iconSvg.w===16&&x.iconSvg.h===16&&x.titleFontSize===14),'preview has the same 16px icon slot and 14px title');
 assert.ok(preview.callouts.every(x=>x.color===x.titleColor&&x.borderLeft==='0px'),'preview icon/title match with no left stripe');
 assert.ok(preview.callouts.every(x=>Math.abs(x.size.y+x.size.h/2-x.titleRect.y-x.titleRect.h/2)<2),'preview icon vertically aligns with title');
 assert.deepEqual(preview.callouts.map(x=>x.headerBg),visual.callouts.map(x=>x.headerBg),'visual and preview semantic header backgrounds match');
 assert.deepEqual(preview.callouts.map(x=>x.color),visual.callouts.map(x=>x.color));
 assert.ok(preview.link.box&&preview.link.text,'link-card must render in preview');
 assert.ok((await page.locator('.markdown-preview .rk-link-card-open').first().getAttribute('href'))?.includes('?tab=readme#section'),'preview link retains query/anchor');
 assert.ok(preview.link.image&&visual.link.image,'both views display the thumbnail');
 assert.ok(Math.abs(preview.link.image.w-visual.link.image.w)<2&&Math.abs(preview.link.image.h-visual.link.image.h)<2,'shared link-card thumbnail sizing');
 await page.setViewportSize({width:320,height:700});
 const small=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 assert.ok(small.scrollWidth<=small.width+1,'preview must not overflow at 320px '+JSON.stringify(small));
 await page.setViewportSize({width:1180,height:850});
 console.log('PASS PREVIEW_PARITY',JSON.stringify({marks:preview.marks.map(x=>x.rect.w),table:preview.tables[0].rect,icons:preview.callouts.map(x=>x.color)}));
 assert.equal((await api('/records/'+id)).body.content,source,'editing attrs should only affect unsaved draft');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForTimeout(450);
 const persisted=(await api('/records/'+id)).body.content;
 for(const expected of ['@ attrs parity-renamed @','@ attrs parity-text @','@ attrs eq-edited @','@ attrs tbl-edited | caption=更新后的图注 @','@ attrs code-edited | file=edited.ts | wrap=true | expand=true @','@ attrs fig-edited | width=480 | caption=新插图说明 @'])assert.ok(persisted.includes(expected),'missing persisted '+expected+'\n'+persisted.slice(0,1600));
 console.log('PASS attributes edit via visual & explicit persistence, no premature writes');
 assert.deepEqual(errors,[]);
}finally{await browser.close().catch(()=>{});}
