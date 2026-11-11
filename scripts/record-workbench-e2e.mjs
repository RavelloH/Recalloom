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
  assert.equal(layout.rows.length,7,'Expected complete metadata inspector');
  assert.ok(layout.rows.every(({label,value})=>label&&value&&label.right<=value.left+2),
   'Property values must not overlap labels: '+JSON.stringify(layout));
  return layout;
 };
 await verifyPropertyLayout();
 assert.equal(await inspector.getByRole('tab',{name:'信息'}).getAttribute('aria-selected'),'true');
 await inspector.getByRole('button',{name:'添加标签'}).click();
 await inspector.getByRole('textbox',{name:'新标签'}).fill('Workbench');
 await page.keyboard.press('Enter');
 await header.getByText('workbench',{exact:true}).waitFor();
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
 await inspector.locator('.diff-output').waitFor();
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
 await page.screenshot({path:'tmp/workbench-dark-320.png'});
 console.log('PASS 320px dark-mode Workbench, no horizontal overflow');
 assert.deepEqual(errors,[],'Browser runtime errors');
}finally{await browser.close();}
