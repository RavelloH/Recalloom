import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Only isolated loopback E2E is permitted');
const browserPath=[process.env.RECALLOOM_BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(file=>file&&existsSync(file));
assert.ok(browserPath,'Chromium/Edge required for bundle-loading E2E');
const raw=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET??raw?.slice(raw.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'Local test secret is required');
const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-first-run','--disable-extensions']});
const requested=(page)=>{
 const urls=[];
 page.on('request',request=>{
  const pathname=new URL(request.url()).pathname;
  if(pathname.startsWith('/assets/')&&pathname.endsWith('.js'))urls.push(pathname);
 });
 return urls;
};
const has=(urls,name)=>urls.some(url=>url.includes('/'+name+'-'));
const login=async page=>{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 await page.getByRole('heading',{name:'概览'}).waitFor();
};
try{
 const context=await browser.newContext({viewport:{width:1320,height:860}});
 const page=await context.newPage();page.setDefaultTimeout(22000);
 const urls=requested(page),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').waitFor();
 for(const name of ['home','library','record','settings','command-palette','motion-primitives','overlayscrollbars','visual-editor'])
  assert.ok(!has(urls,name),'Lazy '+name+' unexpectedly loaded on login screen: '+JSON.stringify(urls));
 console.log('PASS login only fetches the shell and login route, no editor/graph/palette/scrollbar engine');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 await page.getByRole('heading',{name:'概览'}).waitFor();
 // Prewarm the command palette after first paint so the first click doesn't
 // block on its JS chunk. Login remains lean and editors still stay deferred.
 await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>e.name.includes('/command-palette-')),{timeout:5000});
 assert.ok(has(urls,'command-palette'),'Palette must prewarm after the authenticated shell paints');
 assert.ok(!has(urls,'visual-editor'),'Visual editor downloaded on overview');
 const paletteRequests=urls.filter(url=>url.includes('/command-palette-')).length;
 await page.keyboard.press('Control+k');
 const dialog=page.getByRole('dialog',{name:'快速导航'});
 await dialog.waitFor();
 assert.equal(urls.filter(url=>url.includes('/command-palette-')).length,paletteRequests,
  'Opening the palette must not initiate a cold chunk download');
 await page.keyboard.press('Escape');
 await page.waitForTimeout(240);
 await page.keyboard.press('Control+k');
 await dialog.waitFor();
 assert.equal(urls.filter(url=>url.includes('/command-palette-')).length,1,'Palette must remain mounted and not redownload');
 await page.keyboard.press('Escape');
 await page.goto(base+'/library');
 await page.getByRole('heading',{name:'知识库'}).waitFor();
 assert.ok(has(urls,'library'),'Library route chunk did not lazy-load when navigated');
 assert.equal(errors.length,0,'Browser page errors: '+JSON.stringify(errors));
 console.log('PASS route-level lazy chunk, deferred quick switcher and repeat-open keyboard behavior');
 // WebKit policy is intentionally inferred from user agent: Chrome's mobile
 // emulation validates the policy path without pretending to be real Safari.
 const ios=await browser.newContext({
  viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
 });
 await ios.addCookies(await context.cookies());
 const phone=await ios.newPage();const iosUrls=requested(phone);
 await phone.goto(base+'/',{waitUntil:'networkidle'});
 await phone.getByRole('heading',{name:'概览'}).waitFor();
 assert.equal(await phone.evaluate(()=>document.documentElement.dataset.scrollbarMode),'native');
 assert.ok(!has(iosUrls,'overlayscrollbars'),'Native WebKit path must not download custom scrollbar engine');
 await ios.close();
 await context.close();
 console.log('PASS native scrollbar mode avoids OverlayScrollbars JavaScript on an emulated WebKit user agent');
}finally{await browser.close();}
