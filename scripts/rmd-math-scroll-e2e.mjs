import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const origin=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'test only the isolated local server');
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(executablePath&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const slash=String.fromCharCode(92);
const small=slash+'frac{1}{2}+'+slash+'sum_{i=1}^{n}x_i';
const intermediate=Array.from({length:14},(_,i)=>'a_{'+i+'}').join('+');
const wide=Array.from({length:24},(_,i)=>slash+'frac{x_{'+i+'}^2+y_{'+i+'}^2}{'+slash+'sqrt{a_{'+i+'}+b_{'+i+'}}}').join('+');
const markdown=[
 '# Math horizontal overflow and wheel chaining',
 ...Array.from({length:18},(_,i)=>'Before paragraph '+i+'.'),
 '$$',small,'$$','',
 '$$',wide,'$$','',
 '$$',intermediate,'$$','',
 '::: mark','', '$$',small,'$$','',':::','',
 '::: mark','', '$$',wide,'$$','',':::','',
 ...Array.from({length:40},(_,i)=>'After paragraph '+i+'.')
].join('\n');
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1250,height:860}});
page.setDefaultTimeout(60000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const wait=ms=>page.waitForTimeout(ms);
try{
 await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(origin+'/',{timeout:35000});
 const created=await page.evaluate(async content=>{
  const res=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'document',name:'Math-scroll-regression-'+Date.now()+'.md',content})});
  return {status:res.status,body:await res.json()};
 },markdown);
 assert.equal(created.status,201,JSON.stringify(created));
 await page.goto(origin+'/records/'+created.body.id+'?mode=visual',{waitUntil:'domcontentloaded'});
 for(const mode of ['visual','preview']){
  if(mode==='preview')await page.getByRole('button',{name:'预览',exact:true}).click();
  const selector=mode==='visual'?'.tiptap [data-type="block-math"]':'.markdown-preview .katex-display';
  const targets=page.locator(selector);
  await targets.nth(2).waitFor();
  const short=targets.nth(0),long=targets.nth(1),mid=targets.nth(2);
  await page.waitForFunction(sel=>{
   const el=document.querySelectorAll(sel)[1];
   return el?.classList.contains('rk-math-scroll-active');
  },selector);
  const shortState=await short.evaluate(el=>({x:getComputedStyle(el).overflowX,y:getComputedStyle(el).overflowY,active:el.classList.contains('rk-math-scroll-active'),width:el.clientWidth,scrollWidth:el.scrollWidth}));
  const longState=await long.evaluate(el=>({x:getComputedStyle(el).overflowX,y:getComputedStyle(el).overflowY,active:el.classList.contains('rk-math-scroll-active'),width:el.clientWidth,scrollWidth:el.scrollWidth}));
  assert.equal(shortState.x,'clip',mode+' short formula must not be a scroll container');
  assert.equal(shortState.y,'visible');
  assert.equal(shortState.active,false);
  assert.equal(longState.x,'auto',mode+' wide formula must retain scrolling');
  assert.equal(longState.active,true);
  assert.ok(longState.scrollWidth>longState.width+50);
  await long.evaluate(el=>{el.scrollLeft=160;});
  assert.ok(await long.evaluate(el=>el.scrollLeft)>=100,mode+' long formula scrolls horizontally');

  for(const [name,target] of [['short',short],['wide',long]]){
   await target.scrollIntoViewIfNeeded();
   await wait(110);
   const rect=await target.boundingBox();assert.ok(rect);
   const scroll=await page.locator('.main-scroll').evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
   const direction=scroll.max-scroll.top>300?1:-1;
   const x=rect.x+Math.min(rect.width/2,80),y=rect.y+rect.height/2;
   await page.mouse.move(x,y);
   await page.mouse.wheel(0,270*direction);
   await wait(220);
   const current=await page.locator('.main-scroll').evaluate(el=>el.scrollTop);
   console.log('MATH_WHEEL_SAMPLE '+JSON.stringify({mode,name,direction,x,y,...scroll,current,delta:current-scroll.top}));
   assert.ok((current-scroll.top)*direction>100,mode+' '+name+' must chain wheel to document');
  }
  const measuredBefore=await mid.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,active:el.classList.contains('rk-math-scroll-active')}));
  assert.equal(measuredBefore.active,false,mode+' medium formula should fit desktop and avoid scrolling');
  await page.setViewportSize({width:390,height:860});
  await page.waitForFunction(sel=>{
   const el=document.querySelectorAll(sel)[2];
   return el&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+1&&el.classList.contains('rk-math-scroll-active');
  },selector,{timeout:18000});
  const narrowed=await mid.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,active:el.classList.contains('rk-math-scroll-active')}));
  assert.ok(narrowed.active&&narrowed.scrollWidth>narrowed.width);
  await page.setViewportSize({width:1250,height:860});
  await wait(250);
  const restored=await mid.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,active:el.classList.contains('rk-math-scroll-active')}));
  assert.equal(restored.active,false,mode+' medium formula must return to non-scroll state after expanding');
  const marked=page.locator((mode==='visual'?'.tiptap ':'.markdown-preview ')+'.rk-rmd-block-mark.rk-rmd-mark-math-only').first();
  await marked.waitFor();
  const markedStyle=await marked.evaluate(el=>({x:getComputedStyle(el).overflowX,y:getComputedStyle(el).overflowY,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
  assert.equal(markedStyle.x,'clip',mode+' short highlighted math must avoid a nested scroll container');
  assert.equal(markedStyle.y,'visible');
  const wideMark=page.locator((mode==='visual'?'.tiptap ':'.markdown-preview ')+'.rk-rmd-block-mark.rk-rmd-mark-math-only').nth(1);
  await wideMark.waitFor();
  const markInfo=await wideMark.evaluate(el=>({outer:{cw:el.clientWidth,sw:el.scrollWidth,x:getComputedStyle(el).overflowX},children:[...el.querySelectorAll('.rk-directive-body,[data-type="block-math"],.block-math-inner,.katex-display')].slice(0,5).map(n=>({className:n.className,cw:n.clientWidth,sw:n.scrollWidth,x:getComputedStyle(n).overflowX}))}));
  console.log('MATH_WIDE_MARK_METRICS '+JSON.stringify({mode,...markInfo}));
  await page.waitForFunction(sel=>document.querySelectorAll(sel)[1]?.classList.contains('rk-math-scroll-active'),
   (mode==='visual'?'.tiptap ':'.markdown-preview ')+'.rk-rmd-block-mark.rk-rmd-mark-math-only',{timeout:12000});
  const wideMarkMetric=await wideMark.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,x:getComputedStyle(el).overflowX}));
  assert.equal(wideMarkMetric.x,'auto',mode+' wide marked formula needs horizontal scrolling');
  assert.ok(wideMarkMetric.scrollWidth>wideMarkMetric.width+30);
  await wideMark.evaluate(el=>{el.scrollLeft=110;});
  assert.ok(await wideMark.evaluate(el=>el.scrollLeft)>40,'wide marked formula must scroll horizontally');
  console.log('PASS MATH_'+mode.toUpperCase()+' '+JSON.stringify({shortState,longState,midBefore:measuredBefore,midNarrowed:narrowed,midRestored:restored}));
 }
 assert.deepEqual(errors,[]);
 console.log('PASS MATH_WHEEL_CHAIN_AND_RESIZE '+JSON.stringify({pageErrors:errors.length}));
}finally{await browser.close();}
