import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const bin=[
 process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(v=>v&&existsSync(v));
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(v=>/^\s*MCP_AUTH_SECRET\s*=/.test(v));
const secret=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE??'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(bin&&secret);
const browser=await chromium.launch({headless:true,executablePath:bin});
const order=['标题','粗体','斜体','删除线','下划线','高亮','荧光笔与手绘标记',
 '对齐方式','列表','引用','行内代码','插入行内公式','插入或编辑链接','更多'];
const checkOrder=async(toolbar,expected)=>{
 const labels=await toolbar.locator('button').evaluateAll(btns=>btns.map(b=>b.getAttribute('aria-label')||''));
 assert.deepEqual(labels,expected);
};
const login=async(page)=>{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
};
const make=async(page)=>{
 return page.evaluate(async()=>{
  const r=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Toolbar layout audit',kind:'document',content:'Test toolbar layout and touch menu behavior.\n\nAnother paragraph.'})});
  if(r.status!==201)throw Error(await r.text());
  return (await r.json()).id;
 });
};
const errors=[];
const desktop=await browser.newContext({viewport:{width:1440,height:900}});
const p=await desktop.newPage();p.setDefaultTimeout(20000);
p.on('pageerror',e=>errors.push(e.message));
try{
 await login(p);
 const id=await make(p);
 await p.goto(base+'/records/'+id+'?mode=visual');
 const line=p.locator('.tiptap p').filter({hasText:'Test toolbar layout'}).first();
 await line.click();await p.keyboard.press('End');await p.keyboard.press('Shift+Home');
 const bubble=p.getByRole('toolbar',{name:'文本格式'});
 await bubble.waitFor();
 await checkOrder(bubble,order);
 const align=await bubble.locator('.rk-format-group').evaluateAll(groups=>groups.map(g=>{
  const gr=g.getBoundingClientRect(),parent=g.closest('.bubble-menu-inner').getBoundingClientRect();
  const before=getComputedStyle(g,'::before');
  const buttons=[...g.querySelectorAll('button')];
  return {name:g.dataset.formatGroup,separator:before.content,
   sepHeight:before.content==='none'?0:(gr.height-parseFloat(before.top)-parseFloat(before.bottom)),
   height:parent.height,
   glyphOffsets:buttons.flatMap(btn=>{
    const box=btn.getBoundingClientRect();
    return [...btn.querySelectorAll('svg.rk-icon')].filter(svg=>getComputedStyle(svg).visibility!=='hidden').map(svg=>{
     const r=svg.getBoundingClientRect();
     return {button:btn.getAttribute('aria-label'),x:+(r.x+r.width/2-box.x-box.width/2).toFixed(2),
      y:+(r.y+r.height/2-box.y-box.height/2).toFixed(2)};
    });
   })
  };
 }));
 assert.deepEqual(align.map(x=>x.name),['heading','text','layout','insert-inline','more']);
 assert.ok(align.slice(1).every(x=>x.separator!=='none'&&x.sepHeight>=x.height-2),
  'Desktop dividers must extend over the full toolbar height '+JSON.stringify(align));
 assert.ok(align.every(x=>x.glyphOffsets.filter(v=>!['标题','列表','对齐方式','荧光笔与手绘标记','更多'].includes(v.button)).every(v=>Math.abs(v.y)<=1)),
  'Visible glyphs must be centered vertically '+JSON.stringify(align));
 const mark=bubble.getByRole('button',{name:'高亮'});
 const yellow=await mark.locator('.toolbar-highlight').first().evaluate(el=>({background:getComputedStyle(el).backgroundColor,height:el.getBoundingClientRect().height}));
 assert.ok(yellow.height>=16&&yellow.background.startsWith('rgb('));
 await p.screenshot({path:'tmp/editor-toolbar-new-desktop.png'});
 await bubble.getByRole('button',{name:'标题'}).hover();
 const menu=p.getByRole('menu',{name:'标题'});
 await menu.waitFor();
 const openMotion=await menu.evaluate(el=>({state:el.dataset.state,animation:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration}));
 assert.equal(openMotion.state,'open');
 assert.ok(openMotion.animation.includes('rk-inline-menu-enter')&&openMotion.duration!=='0s','Desktop menu should animate opening '+JSON.stringify(openMotion));
 const menuWidth=await menu.evaluate(el=>el.getBoundingClientRect().width);
 assert.ok(menuWidth<=219,'Popup should not be excessively wide: '+menuWidth);
 await p.keyboard.press('Escape'); // deterministic close while the hover menu is mounted
 const desktopClosing=p.locator('.rk-inline-popover[data-state="closing"]');
 await desktopClosing.waitFor({state:'attached'});
 const closeMotion=await desktopClosing.evaluate(el=>({animation:getComputedStyle(el).animationName,pointer:getComputedStyle(el).pointerEvents}));
 assert.ok(closeMotion.animation.includes('rk-inline-menu-exit')&&closeMotion.pointer==='none','Desktop menu must animate a pointer-inert exit '+JSON.stringify(closeMotion));
 await desktopClosing.waitFor({state:'detached'});
 console.log('PASS desktop: exact order, full-height group separators, centered icons, animated hover dropdown');

 for(const width of [390,320,1024]){
  const ctx=await browser.newContext({viewport:{width,height:width===1024?768:844},isMobile:true,hasTouch:true});
  const page=await ctx.newPage();page.setDefaultTimeout(24000);
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await login(page);await page.goto(base+'/records/'+id+'?mode=visual');
   const toolbar=page.getByRole('toolbar',{name:'格式工具栏'});
   await toolbar.waitFor();
   await checkOrder(toolbar.locator('.wysiwyg-tools-primary'),[...order,'撤销','重做']);
   const host=page.locator('.rk-editor-format-scroll');
   await page.waitForFunction(()=>document.querySelector('.rk-editor-format-scroll')?.hasAttribute('data-edge-end'));
   const first=await host.evaluate(el=>{
    const viewport=el.querySelector('.rk-scroll-viewport');
    return {start:el.hasAttribute('data-edge-start'),end:el.hasAttribute('data-edge-end'),
     overflowing:viewport.scrollWidth>viewport.clientWidth,
     left:viewport.scrollLeft,engine:!!el.querySelector('.os-scrollbar-horizontal'),
     mask:getComputedStyle(viewport).maskImage};
   });
   assert.ok(first.overflowing&&first.end&&!first.start,'Expected right-side scroll hint on touch '+JSON.stringify(first));
   if(width<=390){
    const edges=await host.evaluate(el=>{
     const host=el.getBoundingClientRect();
     const viewport=el.querySelector('.rk-scroll-viewport').getBoundingClientRect();
     return {hostLeft:host.left,hostRight:host.right,viewportRight:viewport.right,
      screenWidth:innerWidth,fadeStart:getComputedStyle(el,'::after').right};
    });
    assert.ok(Math.abs(edges.hostLeft)<=1&&Math.abs(edges.hostRight-edges.screenWidth)<=1&&
     Math.abs(edges.viewportRight-edges.screenWidth)<=1,
     'touch formatting toolbar fade must sit at the REAL screen edge: '+JSON.stringify(edges));
   }
   const surface=await host.evaluate(el=>({
    background:getComputedStyle(el).backgroundColor,
    toolbar:getComputedStyle(el.querySelector('.wysiwyg-toolbar')).backgroundColor,
    start:getComputedStyle(el,'::before').backgroundImage,
    end:getComputedStyle(el,'::after').backgroundImage
   }));
   assert.equal(surface.background,surface.toolbar,'Scroll fades must sit on the exact toolbar background');
   assert.ok(surface.start.includes(surface.background)&&surface.end.includes(surface.background),
    'Both fade gradients must start with the exact toolbar surface color '+JSON.stringify(surface));
   await toolbar.evaluate(el=>{el.scrollLeft=el.scrollWidth;el.dispatchEvent(new Event('scroll'));});
   await page.waitForFunction(()=>document.querySelector('.rk-editor-format-scroll')?.hasAttribute('data-edge-start'));
   const last=await host.evaluate(el=>({
    start:el.hasAttribute('data-edge-start'),end:el.hasAttribute('data-edge-end'),
    scrolled:el.querySelector('.rk-scroll-viewport').scrollLeft
   }));
   assert.ok(last.start&&!last.end&&last.scrolled>20,'Expected left-side scroll hint at end '+JSON.stringify(last));
   await toolbar.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event('scroll'));});
   await page.waitForFunction(()=>!document.querySelector('.rk-editor-format-scroll')?.hasAttribute('data-edge-start'));
   const head=toolbar.getByRole('button',{name:'标题'});
   await head.tap();
   const menu=page.getByRole('menu',{name:'标题'});
   await menu.waitFor();
   const bounds=await page.evaluate(()=>({head:document.querySelector('.wysiwyg-toolbar [aria-label="标题"]')?.getBoundingClientRect().toJSON(),popup:document.querySelector('.rk-inline-popover')?.getBoundingClientRect().toJSON(),innerHeight,visualHeight:visualViewport?.height,scrollY}));
   assert.ok(bounds.head&&bounds.popup&&(
    bounds.popup.top>=bounds.head.bottom+3||bounds.popup.bottom<=bounds.head.top-3),
    'Touch popup must not overlap its trigger '+JSON.stringify(bounds));
   await head.tap();
   const touchClosing=page.locator('.rk-inline-popover[data-state="closing"]');
   await touchClosing.waitFor({state:'attached'});
   const touchMotion=await touchClosing.evaluate(el=>({animation:getComputedStyle(el).animationName,pointer:getComputedStyle(el).pointerEvents}));
   assert.ok(touchMotion.animation.includes('rk-inline-menu-exit')&&touchMotion.pointer==='none',
    'Touch menu should animate out without intercepting taps '+JSON.stringify(touchMotion));
   await touchClosing.waitFor({state:'detached'});
   await head.tap();await menu.waitFor();
   await page.locator('.workbench-header').tap();await menu.waitFor({state:'hidden'});
   const metrics=await page.evaluate(()=>({
    viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    actions:document.querySelector('.record-main .editor-topline')?.getBoundingClientRect().toJSON(),
    group:document.querySelector('.record-main .editor-view-switcher')?.getBoundingClientRect().toJSON(),
    icons:document.querySelector('.record-main .editor-view-actions')?.getBoundingClientRect().toJSON(),
    switcherStyle:(()=>{const el=document.querySelector('.record-main .editor-view-switcher');if(!el)return null;
     const group=el.querySelector('[role="group"]');const s=getComputedStyle(group??el);
     return {padding:s.paddingTop,border:s.borderTopWidth,outline:s.outlineWidth,offset:s.outlineOffset};})()
   }));
   if(width<=390){
    const modeSizing=await page.evaluate(()=>{
     const group=document.querySelector('.record-main .editor-view-switcher [role="group"]');
     return {buttons:[...group.querySelectorAll('button')].map(el=>{
      const css=getComputedStyle(el);const r=el.getBoundingClientRect();
      return {label:el.textContent.trim(),width:r.width,padLeft:css.paddingLeft,padRight:css.paddingRight,fontSize:css.fontSize};
     }),container:document.querySelector('.record-main .editor-topline').getBoundingClientRect().width};
    });
    assert.ok(modeSizing.buttons.every(button=>
     parseFloat(button.padLeft)>=8&&parseFloat(button.padRight)>=8&&parseFloat(button.fontSize)>=13),
     'mobile editor modes need readable text and consistent inner breathing room: '+JSON.stringify(modeSizing));
   }
   if(width<=390)assert.ok(metrics.switcherStyle?.outline==='1px'&&metrics.switcherStyle?.offset==='0px'&&metrics.switcherStyle.padding==='0px',
    'Mode switcher must ring the actual button group with no internal gap '+JSON.stringify(metrics));
   assert.ok(metrics.scrollWidth<=metrics.viewport+1,'Mobile root overflow '+JSON.stringify(metrics));
   if(width===1024){
    const tablet=await page.evaluate(()=>{
     const bounds=selector=>document.querySelector(selector)?.getBoundingClientRect().toJSON();
     return {header:bounds('.workbench-header'),actions:bounds('.editor-topline'),
      inShell:Boolean(document.querySelector('.topbar .editor-topline'))};
    });
    assert.equal(tablet.inShell,false,'iPad edit controls must not overlap the anchored topbar');
    assert.ok(tablet.actions.top>=tablet.header.bottom,'iPad editor controls belong below document header');
   }
   if(width<=390){
    assert.ok(metrics.group&&metrics.icons&&metrics.group.width<=280,
     'phone mode switcher must keep a natural, bounded width: '+JSON.stringify(metrics));
    assert.ok(metrics.group&&metrics.icons&&metrics.group.right<=metrics.icons.left+2,
      'View modes and compact action icons must not overlap '+JSON.stringify(metrics));
    assert.ok(metrics.group.width>metrics.icons.width,'Mode switcher must be wider than 3 icon controls '+JSON.stringify(metrics));
   }
   await page.waitForTimeout(900); // auto-hide must settle after touch/scroll
   await page.waitForFunction(()=>document.querySelector('.rk-editor-format-scroll .os-scrollbar-horizontal'));
   const scrollbar=await host.evaluate(el=>[...el.querySelectorAll('.os-scrollbar-horizontal')].map(bar=>({
    hidden:bar.classList.contains('os-scrollbar-auto-hide-hidden'),opacity:getComputedStyle(bar).opacity
   })));
   assert.ok(scrollbar.length>0&&scrollbar.every(bar=>bar.hidden||Number(bar.opacity)<0.15),
    'JS scrollbar must auto-hide at rest '+JSON.stringify(scrollbar));
   await page.screenshot({path:'tmp/editor-toolbar-new-'+width+'.png'});
   if(width===390){
    await page.emulateMedia({colorScheme:'dark'});
    await page.waitForFunction(()=>document.documentElement.dataset.effectiveTheme==='dark');
    const darkSurface=await host.evaluate(el=>{
     const target=el.querySelector('.wysiwyg-toolbar');
     return {
      host:getComputedStyle(el).backgroundColor,
      toolbar:getComputedStyle(target).backgroundColor,
      start:getComputedStyle(el,'::before').backgroundImage,
      end:getComputedStyle(el,'::after').backgroundImage
     };
    });
    assert.ok(darkSurface.host===darkSurface.toolbar&&darkSurface.start.includes(darkSurface.toolbar)&&darkSurface.end.includes(darkSurface.toolbar),
     'Dark toolbar fades must match the actual dark canvas '+JSON.stringify(darkSurface));
    await page.screenshot({path:'tmp/editor-toolbar-dark-390.png'});
   }
   console.log('PASS touch '+width+': OverlayScroll, edge hints, dark/light fades, auto-hide, animated click dropdown, compact modes');
  }finally{await ctx.close();}
 }
 assert.deepEqual(errors,[],'No browser runtime errors');
}finally{await browser.close();}
