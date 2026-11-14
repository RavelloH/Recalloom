import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';

const executablePath=[
 process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(value=>value&&existsSync(value));
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
assert.ok(executablePath&&secretLine,'Isolated browser and local secret required');
const secret=secretLine.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Only temporary local Worker is permitted');
const browser=await chromium.launch({headless:true,executablePath});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.setDefaultTimeout(25000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 await page.goto(base+'/library');
 // The editor-author query is independent of the record timestamp. Delay it
 // to prove that no separator, dash or author label leaks during loading.
 await page.route('**/api/records/*/editors',async route=>{
  await new Promise(resolve=>setTimeout(resolve,1100));
  await route.continue();
 });
 const name='Knowledge Workbench '+Date.now();
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill(name);
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.waitForURL(/\/records\//);
 const header=page.locator('.record-page.workbench-document .workbench-header');
 await header.getByRole('heading',{name}).waitFor();
 assert.equal(await header.locator('.page-icon').count(),0,'Document header must not use Notion-like oversized icon');
 assert.equal(await header.locator('.page-properties').count(),0,'Full property table should not be permanently visible');
 await header.getByText('Markdown 文档').waitFor();
 await header.getByText('R1',{exact:true}).waitFor();
 assert.ok((await page.locator('.crumbs').innerText()).includes(name),'Keep the file hierarchy in the global breadcrumb');
 assert.equal(await header.locator('.workbench-editors').count(),0,'async editors must not show a loading placeholder');
 assert.equal(await header.locator('.workbench-meta-separator').count(),1,'loading editors must not leave a stray separator');
 await header.locator('.workbench-editors').getByText('本人（Web）').waitFor();
 assert.equal(await header.locator('.workbench-meta-separator').count(),2,'resolved editors gain their separator');
 assert.ok(await header.locator('.workbench-summary-resizer').count()>0,'metadata line must use AutoResizer');
 const metaLabels=await header.locator('.workbench-summary-details').innerText();
 assert.ok(metaLabels.indexOf(' 字')<metaLabels.indexOf('编辑者：'),'editor metadata should appear last');
 await page.unroute('**/api/records/*/editors');
 // All pages share one first-content baseline. At tablet widths editor
 // controls stay in the document flow BELOW the header, while breadcrumbs
 // stay in the anchored shell bar. Phones keep compact in-flow controls.
 for(const width of [390,768,820,1000,1280,1440]){
  await page.setViewportSize({width,height:900});
  await page.waitForTimeout(100);
  const geometry=await page.evaluate(()=>{
   const box=selector=>{const el=document.querySelector(selector);if(!el)return null;
    const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width};};
   return {header:box('.workbench-header'),topbar:box('.topbar'),
    actions:box('.editor-topline'),switcher:box('.editor-view-switcher'),
    insideTopbar:Boolean(document.querySelector('.topbar .editor-topline')),
    topbarPosition:getComputedStyle(document.querySelector('.topbar')).position};
  });
  const expectedTop=width<=720?52+20:width<=1000?92:96;
  assert.ok(Math.abs(geometry.header.top-expectedTop)<=2,
   'document header must align with the site-wide baseline: '+width+' '+JSON.stringify(geometry));
  if(width>720&&width<=1200){
   assert.equal(geometry.insideTopbar,false,'tablet editing toolbar must remain in flow');
   assert.ok(geometry.actions.top>=geometry.header.bottom,'tablet toolbar must not overlap sticky topbar or header');
   assert.equal(geometry.topbarPosition,'absolute','tablet breadcrumb shell stays anchored');
  }else if(width>1200){
   assert.equal(geometry.insideTopbar,true,'wide desktop actions stay in shell topbar');
  }else{
   assert.equal(geometry.insideTopbar,false);
   assert.ok(geometry.switcher.width<=244,'phone mode switcher must have a bounded natural width');
  }
  if(width===768||width===1280){
   const movement=await page.evaluate(async()=>{
    const viewport=document.querySelector('.main-scroll');
    const documentPage=document.querySelector('.record-page');
    const topbar=document.querySelector('.topbar');
    const header=document.querySelector('.workbench-header');
    const beforeBar=topbar.getBoundingClientRect().top;
    const beforeTitle=header.getBoundingClientRect().top;
    const original=documentPage.style.minHeight;
    documentPage.style.minHeight='1600px';
    viewport.scrollTop=80;
    await new Promise(requestAnimationFrame);
    const barTravel=topbar.getBoundingClientRect().top-beforeBar;
    const titleTravel=header.getBoundingClientRect().top-beforeTitle;
    viewport.scrollTop=0;documentPage.style.minHeight=original;
    await new Promise(requestAnimationFrame);
    return {barTravel,titleTravel};
   });
   assert.ok(Math.abs(movement.barTravel)<=1,'contentful topbar must stay anchored while scrolling: '+JSON.stringify(movement));
   assert.ok(Math.abs(movement.titleTravel+80)<=2,'document content must scroll independently: '+JSON.stringify(movement));
  }
 }
 await page.setViewportSize({width:1440,height:900});
 await header.getByRole('button',{name:'详细信息'}).click();
 const inspector=page.getByRole('dialog',{name:'文档检查器'});
 await inspector.waitFor();
 const verifyPropertyLayout=async()=>{
  const layout=await inspector.locator('.workbench-inspector-details .page-properties').evaluate(el=>({
   display:getComputedStyle(el).display,
   rows:[...el.querySelectorAll('.property-row')].map(row=>({
    label:row.querySelector('dt')?.getBoundingClientRect().toJSON(),
    value:row.querySelector('dd')?.getBoundingClientRect().toJSON()
   }))
  }));
  assert.equal(layout.display,'flex','Every property must receive its own row');
  assert.equal(layout.rows.length,9,'The filename is edited at the page title, not duplicated in the inspector');
  assert.ok(layout.rows.every(({label,value})=>label&&value&&label.right<=value.left+2),
   'Property values must not overlap labels: '+JSON.stringify(layout));
  return layout;
 };
 await verifyPropertyLayout();
 assert.equal(await inspector.getByRole('tab',{name:'信息'}).getAttribute('aria-selected'),'true');
 assert.equal(await inspector.getByRole('textbox',{name:'文件名'}).count(),0,'Inspector must not duplicate the filename editor');
 await inspector.getByRole('button',{name:'添加标签'}).click();
 await inspector.getByRole('textbox',{name:'新标签'}).fill('Workbench');
 await page.keyboard.press('Enter');
 await header.getByText('workbench',{exact:true}).waitFor();
 const tagStyle=await header.locator('.workbench-summary-tag').first().evaluate(el=>{
  const swatch=document.createElement('span');swatch.style.background='var(--rk-canvas)';document.body.appendChild(swatch);
  const result={background:getComputedStyle(el).backgroundColor,canvas:getComputedStyle(swatch).backgroundColor,
   radius:parseFloat(getComputedStyle(el).borderTopLeftRadius),border:parseFloat(getComputedStyle(el).borderTopWidth)};
  swatch.remove();return result;
 });
 const channels=color=>{
  if(color.startsWith('color(srgb '))return color.slice('color(srgb '.length).split(/[ )/]/).filter(Boolean).slice(0,3).map(v=>Number(v)*255);
  return color.replace(/^rgba?\(/,'').split(',').slice(0,3).map(v=>parseFloat(v));
 };
 const contrast=Math.max(...channels(tagStyle.background).map((v,i)=>Math.abs(v-channels(tagStyle.canvas)[i])));
 assert.ok(tagStyle.background!=='rgba(0, 0, 0, 0)'&&tagStyle.radius>=6&&tagStyle.border>=1&&contrast>=10,
  'Tags must have a visibly distinct filled background: '+JSON.stringify({...tagStyle,contrast}));
 assert.equal(await header.locator('.workbench-tag-line').count(),1,'Tags should occupy their own optional row');
 assert.equal(await header.locator('.workbench-summary').evaluate(el=>getComputedStyle(el).display),'grid','Metadata details button should align at the far right');
 await inspector.getByRole('tab',{name:'关联'}).click();
 assert.equal(await inspector.getByRole('tab',{name:'关联'}).getAttribute('aria-selected'),'true');
 await inspector.getByRole('tab',{name:'信息'}).click();
 await inspector.getByRole('tab',{name:'目录'}).click();
 await inspector.getByText('暂无 Markdown 标题').waitFor();
 await inspector.getByRole('button',{name:'关闭'}).click();
 await inspector.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').fill('# Workbench heading\n\nVersioned content.');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await header.getByText('R2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'历史',exact:true}).click();
 await inspector.waitFor();
 await inspector.getByRole('tab',{name:'版本'}).waitFor();
 await inspector.getByText('Revision 1').waitFor();
 assert.equal(await page.getByRole('dialog',{name:'版本历史'}).count(),0,'Do not open a second, separate history drawer');
 const revision=inspector.locator('.history-row').filter({hasText:'Revision 1'});
 await revision.getByRole('button',{name:'比较'}).click();
 const comparison=page.getByRole('dialog',{name:'版本对比'});
 await comparison.locator('.revision-diff-block').first().waitFor();
 await comparison.getByRole('button',{name:'关闭版本对比'}).click();
 await comparison.waitFor({state:'hidden'});
 await inspector.getByRole('tab',{name:'目录'}).click();
 await inspector.getByRole('button',{name:'Workbench heading'}).waitFor();
 await inspector.getByRole('button',{name:'Workbench heading'}).click();
 await inspector.waitFor({state:'hidden'});
 await page.locator('.cm-content').waitFor();
 await page.screenshot({path:'tmp/workbench-desktop.png'});
 console.log('PASS Workbench header, metadata summary, single four-tab inspector and history compare');
 await page.setViewportSize({width:390,height:844});
 await page.reload();
 await header.waitFor();
 const measure=await page.evaluate(()=>({
  width:document.documentElement.scrollWidth,
  viewport:innerWidth,
  header:(document.querySelector('.workbench-header')?.getBoundingClientRect().height??0),
  hasIcon:!!document.querySelector('.workbench-header .page-icon')
 }));
 assert.ok(measure.width<=measure.viewport+1,'Mobile horizontal overflow '+JSON.stringify(measure));
 assert.ok(measure.header<225,'Mobile header should remain compact '+JSON.stringify(measure));
 assert.equal(measure.hasIcon,false);
 await header.getByRole('button',{name:'详细信息'}).click();
 await inspector.waitFor();
 await verifyPropertyLayout();
 await page.screenshot({path:'tmp/workbench-mobile-details.png'});
 const box=await inspector.boundingBox();
 assert.ok(box&&box.width>=385,'Touch inspector must remain a bottom sheet');
 await inspector.getByRole('tab',{name:'版本'}).click();
 await inspector.getByText('Revision 1').waitFor();
 await page.screenshot({path:'tmp/workbench-mobile-inspector.png'});
 await inspector.getByRole('button',{name:'关闭'}).click();
 await inspector.waitFor({state:'hidden'});
 await page.waitForTimeout(420); // allow the exit transition to finish before capturing the document
 await page.screenshot({path:'tmp/workbench-mobile.png'});
 console.log('PASS 390px mobile layout, bottom-sheet tabs and version history');
 await page.emulateMedia({colorScheme:'dark'});
 await page.setViewportSize({width:320,height:740});
 await page.reload();
 await header.waitFor();
 await page.waitForFunction(()=>document.documentElement.dataset.effectiveTheme==='dark');
 const narrow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,
  height:document.querySelector('.workbench-header')?.getBoundingClientRect().height??0}));
 assert.ok(narrow.width<=narrow.viewport+1,'Dark 320px document overflows: '+JSON.stringify(narrow));
 assert.ok(narrow.height<245,'Narrow document header occupies too much space: '+JSON.stringify(narrow));
 const darkTag=await header.locator('.workbench-summary-tag').first().evaluate(el=>{
  const swatch=document.createElement('span');swatch.style.background='var(--rk-canvas)';document.body.appendChild(swatch);
  const result={background:getComputedStyle(el).backgroundColor,canvas:getComputedStyle(swatch).backgroundColor};
  swatch.remove();return result;
 });
 const darkContrast=Math.max(...channels(darkTag.background).map((v,i)=>Math.abs(v-channels(darkTag.canvas)[i])));
 assert.ok(darkContrast>=10,'Dark-mode tag must have an evident background: '+JSON.stringify({...darkTag,darkContrast}));
 await page.screenshot({path:'tmp/workbench-dark-320.png'});
 console.log('PASS 320px dark-mode Workbench, no horizontal overflow');
 assert.deepEqual(errors,[],'Browser runtime errors');
}finally{await browser.close();}
