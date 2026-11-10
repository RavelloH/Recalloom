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
 const rows=await page.locator('.sidebar .rk-nav-row').evaluateAll(items=>items.map(el=>({icon:el.querySelector('svg.rk-icon')?.getBoundingClientRect().x,label:el.querySelector('.rk-nav-row-label')?.getBoundingClientRect().x})));
 assert.ok(rows.length>=9,'navigation, search and footer must share NavRow');
 assert.ok(rows.every(p=>Math.abs(p.icon-rows[0].icon)<1&&Math.abs(p.label-rows[0].label)<1),'NavRow alignment mismatch: '+JSON.stringify(rows));
 const first=nav.first();
 const firstSvg=first.locator('svg').first();
 assert.ok((await firstSvg.getAttribute('class'))?.includes('tabler-icon'),'sidebar should use Tabler icons');
 const before=await firstSvg.evaluate(el=>el.getBoundingClientRect().width);
 await first.evaluate(el=>el.style.fontSize='20px');
 const after=await firstSvg.evaluate(el=>el.getBoundingClientRect().width);
 assert.ok(before>=18&&before<=23,'sidebar icon must be legible beside 14px text: '+before);
 assert.ok(Math.abs(after-before)<0.5,'navigation icon must retain its control size when label font changes '+before+' -> '+after);
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
    assert.ok(Math.abs(parseFloat(row.size)-16)<0.5&&Math.abs(parseFloat(row.font)-14)<0.5,row.kind+' uses 16px semantic icon aligned with 14px title');
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
 // Mobile view switcher must keep all icons. A legacy CSS rule hid every
 // ButtonGroup SVG even though the underlying React icons were present.
 const viewModes=await page.getByRole('group',{name:'内容视图'}).locator('button').evaluateAll(buttons=>buttons.map(button=>{
  const svg=button.querySelector('svg.rk-icon');
  const rect=svg?.getBoundingClientRect();
  const style=svg?getComputedStyle(svg):null;
  return {label:button.getAttribute('aria-label')??button.textContent?.trim(),present:!!svg,
   width:rect?.width,height:rect?.height,display:style?.display,visibility:style?.visibility};
 }));
 assert.equal(viewModes.length,3,'all content view mode buttons should exist on phones');
 assert.ok(viewModes.every(item=>item.present&&item.width>=16&&item.height>=16&&item.display!=='none'&&item.visibility!=='hidden'),
  'visual/source/preview icons must be visible on phones: '+JSON.stringify(viewModes));
 const mobile=await page.evaluate(()=>({
  viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
  icons:[...document.querySelectorAll('.bottom-link svg')].map(el=>{
   const icon=el.getBoundingClientRect(),parent=el.closest('.bottom-link').getBoundingClientRect();
   return {tabler:el.classList.contains('tabler-icon'),width:icon.width,height:icon.height,centerOffset:+(icon.left+icon.width/2-parent.left-parent.width/2).toFixed(2)};
  })
 }));
 assert.ok(mobile.scrollWidth<=mobile.viewport+1,'mobile horizontal overflow '+JSON.stringify(mobile));
 assert.equal(mobile.icons.length,4,'four bottom navigation entries');
 assert.ok(mobile.icons.every(x=>x.tabler&&x.width>=23&&x.width<=25&&x.height===x.width),'bottom icons should use the 24px large size: '+JSON.stringify(mobile));
 assert.ok(mobile.icons.every(x=>Math.abs(x.centerOffset)<1),'bottom icons must be centered');
 await page.screenshot({path:'tmp/icon-audit/screens/mobile.png'});
 await page.getByRole('button',{name:'打开导航'}).click();
 await page.locator('.sidebar.mobile-open').waitFor();
 await page.waitForFunction(()=>{
  const sidebar=document.querySelector('.sidebar.mobile-open');
  return sidebar&&sidebar.getBoundingClientRect().left>=-1;
 },null,{timeout:7000});
 const sidebarBounds=await page.locator('.sidebar.mobile-open').evaluate(el=>{
  const r=el.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth};
 });
 assert.ok(sidebarBounds.left>=-1&&sidebarBounds.left<sidebarBounds.viewport&&sidebarBounds.right>0,'sidebar should be visible before measuring icons: '+JSON.stringify(sidebarBounds));
 const mobileSidebar=await page.locator('.sidebar .nav-list .nav-link svg').first().evaluate(el=>{
  const icon=el.getBoundingClientRect(),link=el.closest('.nav-link').getBoundingClientRect();
  return {width:icon.width,height:icon.height,centerOffsetY:+(icon.top+icon.height/2-link.top-link.height/2).toFixed(2)};
 });
 assert.ok(mobileSidebar.width>=19&&mobileSidebar.width<=21,'mobile sidebar icons should be 20px: '+JSON.stringify(mobileSidebar));
 assert.ok(Math.abs(mobileSidebar.centerOffsetY)<2,'mobile sidebar icon should be vertically centered: '+JSON.stringify(mobileSidebar));
 const tree=await page.locator('.page-tree svg.tree-icon').first().evaluate(frame=>{
  const a=frame.getBoundingClientRect(),b=a,row=frame.closest('.tree-row').getBoundingClientRect();
  return {frame:a.width,icon:b.width,centerOffsetY:+(b.y+b.height/2-row.y-row.height/2).toFixed(2)};
 });
 assert.ok(tree.frame>=19&&tree.frame<=21&&tree.icon===tree.frame,'file tree icon uses its 20px slot: '+JSON.stringify(tree));
 assert.ok(Math.abs(tree.centerOffsetY)<2,'file tree icon vertically centered: '+JSON.stringify(tree));
 await page.screenshot({path:'tmp/icon-audit/screens/mobile-sidebar.png'});
 await page.getByRole('button',{name:'关闭侧栏'}).click();
 await page.goto(base+'/records/'+id+'?mode=visual');
 const textLine=page.locator('.tiptap p').filter({hasText:'组件内容'}).first();
 await textLine.click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
 const textToolbar=page.getByRole('toolbar',{name:'文本格式'});await textToolbar.waitFor();
 const toolbar=await textToolbar.locator('button:has(svg.tabler-icon)').first().evaluate(btn=>{
  const icon=btn.querySelector('svg.tabler-icon').getBoundingClientRect(),box=btn.getBoundingClientRect();
  return {width:icon.width,centerOffsetY:+(icon.top+icon.height/2-box.top-box.height/2).toFixed(2)};
 });
 assert.ok(toolbar.width>=15&&toolbar.width<=21,'editor toolbar icon should be 16px or 20px: '+JSON.stringify(toolbar));
 assert.ok(Math.abs(toolbar.centerOffsetY)<2,'editor toolbar icon should be centered: '+JSON.stringify(toolbar));
 const topbar=await page.locator('.topbar .mobile-menu').evaluate(btn=>{
  const icon=btn.querySelector('svg.tabler-icon').getBoundingClientRect(),box=btn.getBoundingClientRect();
  return {width:icon.width,height:icon.height,centerOffsetX:+(icon.x+icon.width/2-box.x-box.width/2).toFixed(2),
   centerOffsetY:+(icon.y+icon.height/2-box.y-box.height/2).toFixed(2)};
 });
 assert.ok(topbar.width>=15&&topbar.width<=21,'topbar icon uses a stable control size: '+JSON.stringify(topbar));
 assert.ok(Math.abs(topbar.centerOffsetX)<2&&Math.abs(topbar.centerOffsetY)<2,'topbar icon centered in its button: '+JSON.stringify(topbar));
 const save=await page.locator('.topbar .page-actions-pinned button:has(svg.tabler-icon)').last().evaluate(btn=>{
  const icon=btn.querySelector('svg.tabler-icon'),r=icon.getBoundingClientRect();return {width:r.width,height:r.height,display:getComputedStyle(icon).display};
 });
 assert.ok(save.width>=15&&save.width<=21&&save.height===save.width&&save.display==='block',
  'save icon follows the shared 16/20px size: '+JSON.stringify(save));
 await page.screenshot({path:'tmp/icon-audit/screens/mobile-toolbar.png'});
 await page.setViewportSize({width:390,height:844});
 await page.reload();
 await page.locator('.bottom-link svg.tabler-icon').first().waitFor();
 const wide=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
  bottom:[...document.querySelectorAll('.bottom-link svg.tabler-icon')].map(el=>el.getBoundingClientRect().width)}));
 assert.ok(wide.scroll<=wide.width+1,'390px mobile width overflow: '+JSON.stringify(wide));
 assert.deepEqual(wide.bottom,[24,24,24,24],'bottom navigation dimensions remain stable at 390px');
 assert.deepEqual(errors,[],'browser JS errors');
 console.log('PASS TABLER ICON SYSTEM',JSON.stringify({navigation:{before,after},callouts:kinds,previewVisual:'matched in light and dark',mobile,mobileSidebar,tree,toolbar,topbar,save,wide}));
}finally{await browser.close();}
