import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8807';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Only isolated localhost tests are allowed');
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(browserPath,'Edge or Chrome is required');
const secret=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^MCP_AUTH_SECRET\s*=/.test(line))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const kinds=['note','info','tip','success','warning','danger','example','question'];
const recordSource=['# Tabler 图标视觉测试',...kinds.map(kind=>'::: '+kind+' '+kind+'\n\n组件内容：检查标题颜色、图标对齐和背景。\n\n:::')].join('\n\n');
mkdirSync('tmp/icon-audit/screens',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1366,height:950},deviceScaleFactor:1});
page.setDefaultTimeout(22000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const nav=page.locator('.sidebar .nav-list .nav-link');
 assert.ok(await nav.count()>=5,'expected main sidebar navigation');
 const first=nav.first();
 const firstSvg=first.locator('svg').first();
 assert.ok((await firstSvg.getAttribute('class'))?.includes('tabler-icon'),'sidebar should use Tabler icons');
 const before=await firstSvg.evaluate(el=>el.getBoundingClientRect().width);
 await first.evaluate(el=>el.style.fontSize='20px');
 const after=await firstSvg.evaluate(el=>el.getBoundingClientRect().width);
 assert.ok(before>=18&&before<=23,'sidebar icon must be legible beside 14px text: '+before);
 assert.ok(after>before*1.25,'navigation icon must scale with nearby text '+before+' -> '+after);
 await first.evaluate(el=>el.style.removeProperty('font-size'));
 await page.goto(base+'/help');
 await page.getByRole('heading',{name:'RMD 语法参考'}).waitFor();
 assert.ok(await page.locator('.rk-help-eyebrow svg.tabler-icon').count()>=1,'help page icon family');
 await page.screenshot({path:'tmp/icon-audit/screens/help.png'});
 const created=await page.evaluate(async source=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Local icon audit '+Date.now()+'.md',kind:'document',content:source})});
  return {status:response.status,data:await response.json()};
 },recordSource);
 assert.equal(created.status,201,JSON.stringify(created).slice(0,300));
 const id=created.data.id;
 const all={};
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>localStorage.setItem('recalloom:mode',theme),theme);
  for(const mode of ['visual','preview']){
   await page.goto(base+'/records/'+id+'?mode='+mode);
   const container=page.locator(mode==='preview'?'.markdown-preview':'.tiptap');
   await container.waitFor();
   await container.locator('.rk-rmd-callout').first().waitFor();
   const rows=await container.locator('.rk-rmd-callout').evaluateAll(elements=>elements.map(el=>{
    const banner=el.querySelector('.astryx-banner');
    const icon=el.querySelector('.astryx-banner-icon svg');
    const title=banner?.querySelector(':scope > div:nth-child(2) > div');
    const iconStyle=icon?getComputedStyle(icon):null;
    const titleStyle=title?getComputedStyle(title):null;
    const bannerStyle=banner?getComputedStyle(banner):null;
    const a=icon?.getBoundingClientRect(),b=title?.getBoundingClientRect();
    return {kind:el.getAttribute('data-rk-kind'),tabler:icon?.classList.contains('tabler-icon'),
      size:iconStyle?.width,color:iconStyle?.color,titleColor:titleStyle?.color,
      font:titleStyle?.fontSize,centerDelta:a&&b?+(a.y+a.height/2-b.y-b.height/2).toFixed(2):null,
      background:bannerStyle?.backgroundColor,border:bannerStyle?.borderLeftWidth};
   }));
   assert.equal(rows.length,8,theme+' '+mode+' must render all variants');
   assert.deepEqual(rows.map(r=>r.kind),kinds);
   for(const row of rows){
    assert.equal(row.tabler,true,row.kind+' rendered non-Tabler icon');
    assert.equal(row.color,row.titleColor,row.kind+' icon/title mismatch');
    assert.equal(row.border,'0px',row.kind+' still has left stripe');
    assert.ok(Math.abs(row.centerDelta)<2,row.kind+' vertically misaligned');
    assert.ok(Math.abs(parseFloat(row.size)-parseFloat(row.font))<2,row.kind+' icon does not follow text size');
   }
   all[theme+'-'+mode]=rows;
   if(mode==='preview'){
    await page.screenshot({path:'tmp/icon-audit/screens/'+theme+'-callout.png',fullPage:true});
   }
  }
  assert.deepEqual(all[theme+'-visual'].map(r=>[r.color,r.background]),all[theme+'-preview'].map(r=>[r.color,r.background]),theme+' visual/preview mismatch');
 }
 await page.setViewportSize({width:320,height:720});
 await page.goto(base+'/records/'+id+'?mode=preview');
 await page.locator('.markdown-preview .rk-rmd-callout').first().waitFor();
 const mobile=await page.evaluate(()=>({
  viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
  icons:[...document.querySelectorAll('.bottom-link svg')].map(el=>{
   const icon=el.getBoundingClientRect(),parent=el.closest('.bottom-link').getBoundingClientRect();
   return {tabler:el.classList.contains('tabler-icon'),width:icon.width,height:icon.height,centerOffset:+(icon.left+icon.width/2-parent.left-parent.width/2).toFixed(2)};
  })
 }));
 assert.ok(mobile.scrollWidth<=mobile.viewport+1,'mobile horizontal overflow '+JSON.stringify(mobile));
 assert.equal(mobile.icons.length,4,'four bottom navigation entries');
 assert.ok(mobile.icons.every(x=>x.tabler&&x.width>=19&&x.width<=24&&x.height===x.width),'bottom icons should be ~20px: '+JSON.stringify(mobile));
 assert.ok(mobile.icons.every(x=>Math.abs(x.centerOffset)<1),'bottom icons must be centered');
 await page.screenshot({path:'tmp/icon-audit/screens/mobile.png'});
 await page.getByRole('button',{name:'打开导航'}).click();
 const mobileSidebar=await page.locator('.sidebar .nav-list .nav-link svg').first().evaluate(el=>{
  const icon=el.getBoundingClientRect(),link=el.closest('.nav-link').getBoundingClientRect();
  return {width:icon.width,height:icon.height,centerOffsetY:+(icon.top+icon.height/2-link.top-link.height/2).toFixed(2)};
 });
 assert.ok(mobileSidebar.width>=18&&mobileSidebar.width<=23,'mobile sidebar icons should be ~19px: '+JSON.stringify(mobileSidebar));
 assert.ok(Math.abs(mobileSidebar.centerOffsetY)<2,'mobile sidebar icon should be vertically centered: '+JSON.stringify(mobileSidebar));
 await page.screenshot({path:'tmp/icon-audit/screens/mobile-sidebar.png'});
 await page.getByRole('button',{name:'关闭侧栏'}).click();
 await page.goto(base+'/records/'+id+'?mode=visual');
 await page.locator('.wysiwyg-tools button svg.tabler-icon').first().waitFor();
 const toolbar=await page.locator('.wysiwyg-tools button:has(svg.tabler-icon)').first().evaluate(btn=>{
  const icon=btn.querySelector('svg.tabler-icon').getBoundingClientRect(),box=btn.getBoundingClientRect();
  return {width:icon.width,centerOffsetY:+(icon.top+icon.height/2-box.top-box.height/2).toFixed(2)};
 });
 assert.ok(toolbar.width>=18&&toolbar.width<=24,'editor toolbar icon should be ~20px: '+JSON.stringify(toolbar));
 assert.ok(Math.abs(toolbar.centerOffsetY)<2,'editor toolbar icon should be centered: '+JSON.stringify(toolbar));
 await page.screenshot({path:'tmp/icon-audit/screens/mobile-toolbar.png'});
 assert.deepEqual(errors,[],'browser JS errors');
 console.log('PASS TABLER ICON SYSTEM',JSON.stringify({navigationEm:{before,after},callouts:kinds,previewVisual:'matched in light and dark',mobile,mobileSidebar,toolbar}));
}finally{await browser.close();}
