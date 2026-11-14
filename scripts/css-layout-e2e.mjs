import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Only isolated localhost tests are allowed');
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(browserPath,'Edge or Chrome must be installed');
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
assert.ok(secretLine,'MCP_AUTH_SECRET is required');
const secret=secretLine.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const cases=[
 {name:'desktop',width:1440,height:900,hasTouch:false,isMobile:false},
 {name:'desktop-wide',width:1920,height:1080,hasTouch:false,isMobile:false},
 {name:'touch-pad',width:1024,height:768,hasTouch:true,isMobile:false},
 {name:'touch-phone',width:390,height:844,hasTouch:true,isMobile:true}
];
mkdirSync('tmp/css-layout-snapshots',{recursive:true});
try{
 for(const mode of cases){
  const context=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:mode.hasTouch,isMobile:mode.isMobile});
  const page=await context.newPage();
  await page.goto(base+'/login');
  await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL(base+'/',{timeout:30000});
  await page.goto(base+'/library');
  const add=page.locator('.file-new');
  await add.waitFor({state:'visible',timeout:25000});
  const measurements=await page.evaluate(()=>{
   const bounds=(e)=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
   const q=(selector)=>document.querySelector(selector);
   const navigation=[...document.querySelectorAll('.sidebar .nav-list .nav-link')].map(el=>{
    const icon=el.querySelector('svg'),a=el.getBoundingClientRect(),b=icon?.getBoundingClientRect();
    return {width:a.width,height:a.height,icon:b?{w:b.width,h:b.height,dy:(b.top+b.height/2)-(a.top+a.height/2)}:null};
   });
   return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    fine:matchMedia('(hover: hover) and (pointer: fine)').matches,
    coarse:matchMedia('(pointer: coarse)').matches,
    nav:navigation,sidebar:bounds(q('.sidebar')),add:bounds(q('.file-new')),
    bottom:bounds(q('.bottom-nav')),topbar:bounds(q('.topbar')),
    scroll:bounds(q('.main-scroll')),main:bounds(q('.main-content')),
    scrollContentPadding:parseFloat(getComputedStyle(q('.route-stage')).paddingBottom),
    bottomShadow:getComputedStyle(q('.bottom-nav')).boxShadow};
  });
  assert.ok(measurements.scrollWidth<=measurements.viewport+1,mode.name+' page horizontal overflow '+JSON.stringify(measurements));
  assert.ok(measurements.add&&measurements.add.h>=30&&measurements.add.w>=100,mode.name+' add button collapsed '+JSON.stringify(measurements.add));
  assert.equal(measurements.fine,!mode.hasTouch,mode.name+' input media query mismatch');
  assert.equal(measurements.coarse,mode.hasTouch,mode.name+' input media query mismatch');
  if(mode.width>720){
   assert.ok(measurements.nav.length>=5,mode.name+' missing sidebar nav');
   for(const item of measurements.nav){
    assert.ok(item.icon&&item.icon.w>=16&&item.icon.w<=26,mode.name+' nav icon width '+JSON.stringify(item));
    assert.ok(Math.abs(item.icon.dy)<3,mode.name+' nav icon vertical alignment '+JSON.stringify(item));
   }
  }else{
   await page.getByRole('button',{name:'打开导航'}).click();
   await page.locator('.sidebar.mobile-open').waitFor();
   await page.getByRole('button',{name:'关闭导航'}).click();
   await page.locator('.sidebar.mobile-open').waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.querySelector('.sidebar')?.getBoundingClientRect().right<=1,{timeout:5000});
   assert.ok(measurements.bottom&&measurements.bottom.h>=45,mode.name+' missing mobile bottom navigation');
   assert.ok(Math.abs(measurements.scroll.y+measurements.scroll.h-measurements.bottom.y)<=1,
    mode.name+' route snapshot viewport stops exactly above tab bar: '+JSON.stringify(measurements));
   assert.equal(measurements.scrollContentPadding,16,mode.name+' retains natural content end inset without duplicating reserved tab height');
   assert.notEqual(measurements.bottomShadow,'none',mode.name+' bottom nav has no overlay shadow');
  }
  await page.screenshot({path:'tmp/css-layout-snapshots/'+mode.name+'.png'});
  if(mode.name==='desktop'){
   await Promise.all([page.waitForURL(/\/records\/[^/]+/,{timeout:20000}),add.click()]);
   const tag=page.getByRole('button',{name:'添加标签'});
   if(await tag.count()>0){
    await tag.first().click();
    await page.getByPlaceholder('输入后回车').waitFor({state:'visible'});
   }
  }
  await page.goto(base+'/graph');
  await page.locator('.knowledge-graph-page').waitFor({state:'visible'});
  await page.locator('.graph-workspace').waitFor({state:'visible',timeout:20000});
  const graph=await page.evaluate(()=>{
   const box=(selector)=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,w:r.width,right:r.right}};
   return {page:box('.knowledge-graph-page'),workspace:box('.workspace'),graph:box('.graph-workspace'),stage:box('.graph-stage'),controls:box('.graph-controls'),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,paddingInline:getComputedStyle(document.querySelector('.knowledge-graph-page')).paddingLeft};
  });
  assert.ok(graph.page&&graph.workspace&&graph.graph&&graph.stage,mode.name+' graph workspace did not render');
  assert.ok(graph.graph.w>0&&graph.stage.w>0,mode.name+' graph stage collapsed '+JSON.stringify(graph));
  assert.ok(graph.graph.right<=graph.page.right+1,mode.name+' graph stage exceeds page width '+JSON.stringify(graph));
  assert.ok(graph.page.w>=graph.workspace.w-2,mode.name+' graph page is incorrectly constrained '+JSON.stringify(graph));
  assert.ok(graph.scrollWidth<=graph.viewport+1,mode.name+' graph page horizontal overflow '+JSON.stringify(graph));
  if(mode.width<=720)assert.ok(parseFloat(graph.paddingInline)>=15,mode.name+' graph lost mobile page gutters');
  await page.screenshot({path:'tmp/css-layout-snapshots/'+mode.name+'-graph.png'});
  console.log('PASS CSS layout '+mode.name,JSON.stringify({library:measurements,graph}));
  await context.close();
 }
}finally{await browser.close()}
