import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8788';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const secretLine=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(secretLine);
const secret=secretLine.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const bin=[process.env.CHROMIUM_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(bin);
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox','--disable-dev-shm-usage']});
const fixture=[
 '# 高对比代码与 Mermaid 主题验收',
 '',
 '~~~typescript [src/demo.ts]',
 'interface Example { name: string; value: number }',
 'const item: Example = {name:"Recalloom",value:42};',
 '// Check text contrast on both themes',
 '~~~','',
 '~~~json',
 '{"mode":"visual","rawFallback":true,"supported":["gfm","math","wiki"]}',
 '~~~','',
 '~~~mermaid',
 'flowchart LR',
 '  A[Markdown Source] --> B[Visual Editor]',
 '  B --> C[Markdown Source]',
 '~~~','',
 '[GitHub 站点](https://github.com/RavelloH/Recalloom)'
].join('\n');
const errors=[];
const hexToRgb=hex=>{
 const normalized=hex.trim().replace('#','');
 if(!/^[a-f0-9]{6}$/i.test(normalized))return null;
 const parts=[0,2,4].map(i=>parseInt(normalized.slice(i,i+2),16));
 return 'rgb('+parts.join(', ')+')';
};
try{
 for(const mode of ['dark','light']){
  const context=await browser.newContext({viewport:{width:1300,height:850}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(mode+': '+e.message));
  await page.addInitScript(theme=>localStorage.setItem('recalloom:mode',theme),mode);
  // Metadata is deliberately stubbed here; the separate private proxy tests
  // validate upstream fetching/authentication. This test validates CSS only.
  await page.route('https://meta.ravelloh.com/**',async route=>route.fulfill({
   status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},
   body:JSON.stringify({title:'Recalloom repository',siteName:'GitHub',icon:'https://github.com/favicon.ico'})
  }));
  await page.goto(base+'/login',{waitUntil:'domcontentloaded',timeout:25000});
  await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL(base+'/',{timeout:19000});
  const created=await page.evaluate(async content=>{
   const result=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Contrast regression '+Date.now()+'.md',kind:'document',content})});
   return {status:result.status,data:await result.json()};
  },fixture);
  assert.equal(created.status,201);
  await page.goto(base+'/records/'+created.data.id,{waitUntil:'domcontentloaded',timeout:20000});
  await page.locator('.tiptap .rk-code-block').first().waitFor({timeout:30000});
  await page.locator('[data-rk-mermaid] img').waitFor({timeout:45000});
  const result=await page.evaluate(()=>{
   const code=document.querySelector('.tiptap .rk-code-block');
   const token=code?.querySelector('span[style*="--shiki-dark"]');
   const pre=code?.querySelector('pre');
   const viewport=code?.querySelector('.rk-code-viewport');
   const shikiWrapper=code?.parentElement;
   const image=document.querySelector('[data-rk-mermaid] img');
   const svg=decodeURIComponent(image?.getAttribute('src')?.split(',').slice(1).join(',')??'');
   return {
    theme:document.documentElement.dataset.effectiveTheme,
    codeBackground:code&&getComputedStyle(code).backgroundColor,
    shikiWrapperBackground:shikiWrapper&&getComputedStyle(shikiWrapper).backgroundColor,
    viewportBackground:viewport&&getComputedStyle(viewport).backgroundColor,
    tokenColor:token&&getComputedStyle(token).color,
    lightToken:token?.style.getPropertyValue('--shiki-light'),
    inlineTokenColor:token?.style.color,
    darkToken:token?.style.getPropertyValue('--shiki-dark'),
    diagramTheme:image?.closest('[data-rk-diagram-theme]')?.getAttribute('data-rk-diagram-theme'),
    diagramMarkup:svg,
    saveDisabled:document.querySelector('button[aria-label="保存"]')?.disabled
   };
  });
  assert.equal(result.theme,mode,'App must use requested effective theme');
  assert.equal(result.diagramTheme,mode,'Mermaid must match app theme');
  assert.equal(result.tokenColor,mode==='dark'?hexToRgb(result.darkToken):result.inlineTokenColor,'Shiki token must use effective theme');
  assert.equal(result.viewportBackground,result.codeBackground,'All code block layers must have the same opaque surface');
  assert.equal(result.shikiWrapperBackground,'rgba(0, 0, 0, 0)','Shiki outer NodeView wrapper must not paint white behind rounded code corners');
  assert.ok((result.diagramMarkup.match(/<text[\s>]/g)??[]).length>=3,'Mermaid must retain label text nodes');
  assert.ok(result.diagramMarkup.includes('Markdown')&&result.diagramMarkup.includes('Source'),'Mermaid labels must survive SVG purification even when nested in tspan text nodes');
  assert.ok(result.diagramMarkup.includes(mode==='dark'?'#eef2f7':'#1c2835'),'Mermaid must use high contrast color palette');
  // The generated image is isolated; do not insert SVG/styles into editable content.
  assert.equal(await page.locator('.tiptap [data-rk-mermaid] svg').count(),0,'Mermaid SVG must not execute inside document DOM');
  console.log('THEME',mode,JSON.stringify({
   codeBackground:result.codeBackground,tokenColor:result.tokenColor,diagramTheme:result.diagramTheme,
   labels:(result.diagramMarkup.match(/<text[\s>]/g)??[]).length
  }));
  const link=page.locator('.tiptap a[href^="https://github.com/RavelloH/Recalloom"]');
  await link.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{
   return [...document.querySelectorAll('style[data-rk-editor-link-styles]')]
    .some(sheet=>[...(sheet.sheet?.cssRules??[])].some(rule=>rule.cssText.includes('github.com')&&rule.cssText.includes('linear-gradient')));
  },null,{timeout:25000});
  const favicon=await link.evaluate(node=>({
   css:getComputedStyle(node,'::before').backgroundImage,
   attributes:[...node.attributes].filter(a=>a.name.startsWith('data-rk-site-')).length,
   inlineStyle:node.getAttribute('style')
  }));
  assert.ok(favicon.css.includes('linear-gradient'),'Favicon tile should offer both light and dark contrast');
  assert.equal(favicon.attributes,0,'Never mutate ProseMirror-owned link attributes');
  assert.equal(favicon.inlineStyle,null,'Never mutate ProseMirror-owned link style');
  assert.ok(!(await page.getByRole('button',{name:'保存'}).isEnabled()),'Async syntax/mermaid/favicon must not mark document dirty');
  // Simulate a live ThemeProvider theme update without changing Markdown.
  const opposite=mode==='dark'?'light':'dark';
  await page.evaluate(theme=>{document.documentElement.dataset.effectiveTheme=theme;},opposite);
  await page.waitForFunction(theme=>document.querySelector('[data-rk-mermaid]')?.getAttribute('data-rk-diagram-theme')===theme,opposite,{timeout:20000});
  assert.ok(!(await page.getByRole('button',{name:'保存'}).isEnabled()),'Switching theme should not edit Markdown');
  await context.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS theme regression: Shiki contrast, Mermaid SVG labels, favicon tile and editor no-dirty/no-DOM-mutation');
}finally{await browser.close().catch(()=>{});}
