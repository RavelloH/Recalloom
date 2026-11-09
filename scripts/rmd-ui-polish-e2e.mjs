import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8799';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(browserPath&&line);const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(16000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://meta.ravelloh.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
 url:'https://github.com/RavelloH/Recalloom',finalUrl:'https://github.com/RavelloH/Recalloom',title:'Recalloom',siteName:'GitHub',image:'https://github.com/example.png',description:'A self-hosted knowledge library'
})}));
await page.route('**/api/link-image?**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Uoe2GsAAAAASUVORK5CYII=','base64')}));
const api=(endpoint,body,method='GET')=>page.evaluate(async({endpoint,body,method})=>{
 const r=await fetch('/api'+endpoint,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json().catch(()=>({}))}
},{endpoint,body,method});
const metrics=async()=>page.evaluate(()=>{
 const sel=s=>document.querySelector(s);
 const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
 const box=sel('.tiptap .rk-rmd-block-mark'),paragraph=box?.querySelector('p'),table=sel('.tiptap .tableWrapper[data-rk-table-id]'),tbl=table?.querySelector('table'),caption=table?.querySelector('.rk-table-caption');
 const linkImage=sel('.tiptap .rk-link-card-image'),linkCard=sel('.tiptap .rk-link-card');
 const note=sel('.tiptap .rk-directive-note');
 return {
  html:{u:document.querySelectorAll('.tiptap u').length,sup:document.querySelectorAll('.tiptap sup').length,sub:document.querySelectorAll('.tiptap sub').length},
  mark:{container:rect(box),bg:box?getComputedStyle(box).backgroundColor:null,paragraph:rect(paragraph),paragraphColor:paragraph?getComputedStyle(paragraph).color:null},
  caption:{host:rect(table),table:rect(tbl),caption:rect(caption),direction:table?getComputedStyle(table).flexDirection:null},
  card:{host:rect(linkCard),image:rect(linkImage),cssWidth:linkImage?getComputedStyle(linkImage).width:null,margin:linkImage?getComputedStyle(linkImage).margin:null},
  note:{icons:note?.querySelectorAll('.astryx-banner-icon svg').length,titleTriggers:note?.querySelectorAll('.rk-directive-title-hit').length,pencilButtons:note?.querySelectorAll('.rk-directive-title button').length},
  page:{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}
 };
});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:24000});
 const source=readFileSync('docs/rmd-1.0-syntax-showcase.md','utf8');
 const created=await api('/records',{name:'RMD-visual-polish-'+Date.now()+'.md',kind:'document',content:source},'POST');
 assert.equal(created.status,201,JSON.stringify(created).slice(0,440));
 const id=created.body.id;
 await page.goto(base+'/records/'+id+'?mode=visual',{waitUntil:'domcontentloaded'});
 await page.locator('.tiptap').waitFor();
 await page.locator('.tiptap .rk-directive-note').first().waitFor();
 await page.locator('.tiptap .rk-table-caption:not([hidden])').first().waitFor();
 await page.locator('.tiptap .rk-link-card-image').first().waitFor({timeout:17000}).catch(()=>{});
 const out=await metrics();
 assert.ok(out.html.u>=1&&out.html.sup>=1&&out.html.sub>=1,'safe HTML formatting must create editable nodes: '+JSON.stringify(out.html));
 assert.equal(out.mark.bg,'rgb(245, 216, 112)','Mark background unchanged');
 assert.equal(out.mark.paragraphColor,'rgb(37, 30, 14)','Mark text contrast in dark mode');
 assert.equal(out.note.icons,1,'only one Banner semantic icon');
 assert.equal(out.note.titleTriggers,1,'structural title is directly editable on click');
 assert.equal(out.note.pencilButtons,0,'no separate pencil icon or hover-only edit control');
 assert.equal(out.caption.direction,'column','captioned table must stack rows');
 assert.ok(out.caption.caption&&out.caption.table&&out.caption.caption.y>=out.caption.table.y+out.caption.table.h-2,'table caption must follow the table, never be to the left');
 assert.ok(out.caption.caption.w>0&&out.caption.caption.w<=out.caption.host.w+1,'caption must stay inside table wrapper');
 assert.ok(out.card.image&&out.card.image.w<=170&&out.card.image.h<=130,'link card image must stay a bounded thumbnail');
 const picture=page.locator('img[src="/examples/device.svg"]').first();
 await picture.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const el=document.querySelector('img[src="/examples/device.svg"]');return !!el&&el.complete&&el.naturalWidth>0;});
 await page.setViewportSize({width:320,height:700});
 const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 assert.ok(mobile.scrollWidth<=mobile.width+1,'no full-page horizontal overflow at 320px: '+JSON.stringify(mobile));
 console.log('PASS RMD visual polish',JSON.stringify({mark:out.mark,caption:out.caption,link:out.card,icon:out.note,mobile}));
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.locator('.markdown-preview').first().waitFor();
 assert.ok(await page.locator('.markdown-preview u').count()>=1);
 assert.ok(await page.locator('.markdown-preview sup').count()>=1);
 assert.ok(await page.locator('.markdown-preview sub').count()>=1);
 assert.equal(await page.locator('.markdown-preview .astryx-banner-icon svg').first().count(),1);
 assert.ok(await page.locator('.markdown-preview .rk-table-caption-read').count()>=1);
 assert.ok(await page.locator('.markdown-preview .rk-cloze-reveal').count()>=1,'Cloze renders a reveal action rather than leaking the answer');
 assert.equal((await api('/records/'+id)).body.content,source,'view switching never changes database source');
 console.log('PASS RMD preview HTML, single Banner icon, caption and unchanged D1 body');
 assert.deepEqual(errors,[]);
}finally{await browser.close().catch(()=>{});}
