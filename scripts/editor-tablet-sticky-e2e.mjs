/** Touch formatting toolbar must stick BELOW the desktop shell header.
 * Cross-browser regression using isolated Worker/D1; each viewport has its
 * OWN touch context (WebKit mobile contexts must not resize across breakpoints).
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const engine=process.env.RECALLOOM_TEST_ENGINE==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'
 ?[process.env.RECALLOOM_BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x)):undefined;
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const browser=await (engine==='webkit'?webkit:chromium).launch({
 headless:true,...(executable?{executablePath:executable}:{})
});
const paragraphs=Array.from({length:65},(_,i)=>
 '第 '+(i+1)+' 段：触屏平板滚动时，格式工具栏应该停留在面包屑 header 下方，不遮挡按钮。');
try{
 for(const [name,width,height] of [
  ['phone-390',390,844],['tablet-820',820,768],['tablet-1024',1024,768],
  ['tablet-1194',1194,834],['tablet-1280',1280,900]
 ]){
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.setDefaultTimeout(25000);
  const faults=[];
  page.on('pageerror',error=>faults.push(error.message));
  if(engine==='webkit'){
   let sessionCookie='';
   await page.route('**/api/**',async route=>{
    const request=route.request();
    if(request.url().endsWith('/api/auth/login')){
     const response=await route.fetch();
     const match=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'');
     if(match)sessionCookie=match[1];
     await route.fulfill({response});return;
    }
    if(!sessionCookie){await route.continue();return;}
    const response=await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}});
    await route.fulfill({response});
   });
  }
  try{
   await page.goto(base+'/login');
   await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
   await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.waitForURL(base+'/');
   const record=await page.evaluate(async content=>{
    const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({name:'Tablet sticky regression '+Date.now()+'-'+Math.random().toString(36).slice(2)+'.md',kind:'document',content})});
    if(!response.ok)throw Error('Cannot create test record: '+await response.text());
    return response.json();
   },'# Tablet sticky header\n\n'+paragraphs.join('\n\n'));
   await page.goto(base+'/records/'+record.id+'?mode=visual');
   await page.locator('.tiptap').waitFor();
   await page.locator('.rk-editor-format-scroll').waitFor();
   await page.waitForFunction(()=>document.querySelector('.topbar')?.getBoundingClientRect().height>0);
   const geometry=await page.evaluate(async()=>{
    const scroll=document.querySelector('.main-scroll');
    const rail=document.querySelector('.rk-editor-format-scroll');
    const header=document.querySelector('.topbar');
    scroll.scrollTop=650;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const rect=rail.getBoundingClientRect(),headerRect=header.getBoundingClientRect(),
     scrollRect=scroll.getBoundingClientRect(),css=getComputedStyle(rail);
    return {
     scrollTop:scroll.scrollTop,railTop:rect.top,railBottom:rect.bottom,
     headerTop:headerRect.top,headerBottom:headerRect.bottom,headerHeight:headerRect.height,
     viewportTop:scrollRect.top,stickyTop:css.top,position:css.position,
     pointer:matchMedia('(pointer:coarse)').matches,
     hoverNone:matchMedia('(hover:none)').matches
    };
   });
   assert.ok(geometry.scrollTop>=500,name+' requires a real long-document scroll: '+JSON.stringify(geometry));
   assert.equal(geometry.position,'sticky');
   assert.ok(geometry.pointer||geometry.hoverNone,'must emulate touch capability');
   const expected=name.startsWith('tablet')?geometry.headerBottom:geometry.viewportTop;
   assert.ok(Math.abs(geometry.railTop-expected)<=2,
    name+' toolbar should stick beneath header, never inside it: '+JSON.stringify(geometry));
   assert.ok(geometry.railTop>=geometry.headerBottom-2,
    name+' button row must be visible below header: '+JSON.stringify(geometry));
   if(name==='tablet-1024')await page.screenshot({path:'tmp/tablet-header-sticky-'+engine+'.png'});
   // Check actual input dispatch, not just computed geometry/z-index.
   await page.getByRole('toolbar',{name:'格式工具栏'}).getByRole('button',{name:'插入内容'}).tap();
   await page.getByRole('listbox',{name:'插入内容'}).waitFor();
   await page.keyboard.press('Escape');
   assert.deepEqual(faults,[],'no runtime errors in touch editor');
   console.log('PASS '+engine+' '+name+' formatting toolbar sticky '+geometry.stickyTop+' and touch menu');
  }finally{
   await context.close();
  }
 }
}finally{
 await browser.close();
}
