/** Workspace panel stacking, persistence and editor state against isolated local D1. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright-core';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Use scripts/run-editor-e2e.mjs and its isolated local Worker');
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executablePath=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe',
 '/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path)):undefined;
const secretLine=readFileSync(join(root,'.dev.vars'),'utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local MCP_AUTH_SECRET is required');
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executablePath?{executablePath}:{})});
const context=await browser.newContext({viewport:{width:1600,height:1100},reducedMotion:'no-preference'});
const page=await context.newPage();
page.setDefaultTimeout(20000);
const faults=[];
page.on('pageerror',error=>faults.push(error.message));
const artifactDir=join(root,'tmp','record-stack-'+engine+'-'+Date.now());
mkdirSync(artifactDir,{recursive:true});
let sessionCookie='';
if(engine==='webkit')await page.route('**/api/**',async route=>{
 const request=route.request();
 if(new URL(request.url()).pathname==='/api/auth/login'){
  const response=await route.fetch();
  sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});return;
 }
 if(sessionCookie){await route.fulfill({response:await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}})});return;}
 await route.continue();
});

const card=id=>page.locator('[data-workspace-panel="'+id+'"]');
const ids={info:'document-panel-info',outline:'document-panel-outline',history:'document-panel-history',block:'block-editor'};
const settle=()=>page.waitForTimeout(500);
// Finish loopback cookie-bridge responses before a full document navigation.
// WebKit otherwise reports cancelled route.fulfill requests as CORS errors.
async function reload(){
 await page.waitForLoadState('networkidle');
 await page.reload({waitUntil:'networkidle'});
}
async function trigger(name){
 let entry=page.getByRole('button',{name,exact:true});
 if(await entry.isVisible()){await entry.click();return;}
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 const menuEntry=page.getByRole('menuitem',{name,exact:true});
 if(await menuEntry.count())await menuEntry.click();
 else await page.getByRole('button',{name,exact:true}).click();
}
async function boxes(){
 return page.locator('.workspace-panel-rail [data-workspace-panel]').evaluateAll(elements=>elements
  .filter(element=>element.getBoundingClientRect().height>0)
  .map(element=>{const r=element.getBoundingClientRect();return {id:element.dataset.workspacePanel,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,z:Number(getComputedStyle(element).zIndex),collapsed:element.dataset.collapsed==='true'};})
  .sort((a,b)=>b.z-a.z));
}
async function assertCoverage(){
 const current=await boxes();
 for(let i=0;i<current.length;i++){
  const front=current[i];
  assert.ok(Math.abs(front.bottom-current[0].bottom)<=2,'Overlaid cards share the same bottom edge: '+JSON.stringify(current));
  if(i){
   const nearer=current[i-1];
   assert.ok(front.z<nearer.z&&front.height>nearer.height,'Shorter cards must have a higher foreground layer');
   assert.ok(Math.min(front.right,nearer.right)>Math.max(front.x,nearer.x)&&Math.min(front.bottom,nearer.bottom)>Math.max(front.y,nearer.y)+2,
    'Card rectangles must actually overlap, rather than form separate rows');
   assert.ok(nearer.y-front.y>=62,'Every background card exposes at least its title and handle strip');
  }
 }
 const hits=await page.evaluate(()=>{
  const elements=[...document.querySelectorAll('.workspace-panel-rail [data-workspace-panel]')];
  const hitAt=(x,y)=>document.elementsFromPoint(x,y).find(el=>el.closest('[data-workspace-panel]'))?.closest('[data-workspace-panel]')?.getAttribute('data-workspace-panel');
  return elements.map(el=>{
   const r=el.getBoundingClientRect(),handle=el.querySelector('[data-panel-handle]').getBoundingClientRect();
   const title=el.querySelector('.workspace-panel-header h2,.panel-heading h2,.rk-block-panel-header strong');
   const titleRect=title?.getBoundingClientRect();
   return {id:el.dataset.workspacePanel,handleHit:hitAt(handle.x+handle.width/2,handle.y+handle.height/2),
    titleHit:titleRect?hitAt(titleRect.x+Math.min(10,titleRect.width/2),titleRect.y+titleRect.height/2):null,
    bottomHit:hitAt(r.x+r.width/2,r.bottom-20),collapsed:el.dataset.collapsed==='true'};
  });
 });
 for(const hit of hits){
  assert.equal(hit.handleHit,hit.id,'Each card retains a pointer-accessible handle');
  if(!hit.collapsed)assert.equal(hit.titleHit,hit.id,'Each card retains an unobscured title');
  assert.equal(hit.bottomHit,current[0].id,'Hit testing in the overlap must select the frontmost card');
 }
 return current;
}
async function assertNewFront(id,previous){
 await card(id).waitFor();await settle();
 const current=await boxes(),fresh=current.find(item=>item.id===id);
 assert.equal(current[0]?.id,id,'The new shortest panel should cover the existing stack in the foreground: '+JSON.stringify(current));
 assert.ok(fresh.height<=Math.max(160,Math.min(...previous.map(item=>item.height))-64)+2,'New panel should leave a visible header strip above its top');
 assert.equal(current.length,previous.length+1,'Opening a panel preserves its siblings');
 await assertCoverage();
}
async function drag(id,dx,dy,{sample=false}={}){
 const handle=card(id).locator('[data-panel-handle]').first();
 await handle.scrollIntoViewIfNeeded();
 const r=await handle.boundingBox();assert.ok(r,'Panel has a visible drag handle');
 const x=r.x+r.width/2,y=r.y+r.height/2;
 if(sample)await page.evaluate(()=>{
  const state=window.__stackMotion={frames:[],done:false,releasedAt:null};
  document.addEventListener('pointerup',()=>{state.releasedAt=performance.now();},{once:true});
  const frame=()=>{
   state.frames.push({time:performance.now(),cards:[...document.querySelectorAll('.workspace-panel-rail [data-workspace-panel]')].map(el=>{
    const r=el.getBoundingClientRect(),style=getComputedStyle(el);
    return {id:el.dataset.workspacePanel,y:r.y,height:r.height,z:Number(style.zIndex),opacity:Number(style.opacity),translate:style.translate};
   })});
   if(state.releasedAt===null||performance.now()-state.releasedAt<850)requestAnimationFrame(frame);else state.done=true;
  };frame();
 });
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(x+dx,y+dy,{steps:24});
 await page.mouse.up();
 if(sample)await page.waitForFunction(()=>window.__stackMotion?.done);
 await settle();
}
async function assertPointerPolish(id){
 const panel=card(id),handle=panel.locator('[data-panel-handle]');
 const grip=await handle.boundingBox(),before=await panel.boundingBox();
 assert.ok(Math.abs(grip.width-52)<=1,'Actual draggable handle is 52px wide');
 assert.ok(Math.abs(grip.x+grip.width/2-before.x-before.width/2)<=2,'Handle is centered');
 await handle.hover();assert.equal(await handle.evaluate(el=>getComputedStyle(el).cursor),'grab');
 const appearance=()=>panel.evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderColor,outline:s.outline,shadow:s.boxShadow};});
 const original=await appearance();assert.notEqual(original.shadow,'none','Every card has a layered shadow');
 await page.mouse.down();await page.mouse.move(grip.x+grip.width/2+35,grip.y+grip.height/2-45,{steps:12});
 await page.waitForTimeout(60);
 const diagonal=await panel.boundingBox();
 assert.ok(diagonal.x>before.x+25&&diagonal.y<before.y-30,'Diagonal pointer movement changes both horizontal position and height');
 assert.equal(await handle.evaluate(el=>getComputedStyle(el).cursor),'grabbing');
 const active=await appearance();assert.equal(active.border,original.border,'Dragging leaves the card border unchanged');assert.equal(active.outline,original.outline,'Dragging adds no focus outline');
 await page.mouse.up();await settle();
 const home=await panel.boundingBox(),r=await handle.boundingBox();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2-200,r.y+r.height/2,{steps:16});await page.waitForTimeout(60);
 const resisted=await panel.boundingBox();assert.ok(home.x-resisted.x>=18&&home.x-resisted.x<=24,'A raw 200px left drag is resisted to about 21px');
 await page.mouse.up();await settle();assert.ok(Math.abs((await panel.boundingBox()).x-home.x)<2,'Left release springs home');
 const blank=await panel.locator('.workspace-panel-grip-row').boundingBox(),stable=await panel.boundingBox();
 await page.mouse.move(blank.x+10,blank.y+blank.height/2);await page.mouse.down();await page.mouse.move(blank.x+70,blank.y+blank.height/2-40,{steps:10});await page.mouse.up();await settle();
 const unchanged=await panel.boundingBox();assert.ok(Math.abs(unchanged.x-stable.x)<2&&Math.abs(unchanged.height-stable.height)<2,'Blank grip row cannot drag');
 const fold=await panel.locator('.workspace-panel-fold').boundingBox(),close=await panel.getByRole('button',{name:'关闭',exact:true}).boundingBox();
 assert.ok(fold.x<close.x&&Math.abs(fold.y+fold.height/2-close.y-close.height/2)<2,'Fold sits immediately left of close on its baseline');
}
async function dragReveal(frontId,backId){
 const handle=card(frontId).getByRole('separator');
 const r=await handle.boundingBox(),coverTop=(await card(frontId).boundingBox()).y;
 assert.ok(r,'The foreground card exposes its handle');
 const x=r.x+r.width/2,y=r.y+r.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(x+240,y,{steps:20});
 const initial=await page.evaluate(({frontId,backId,coverTop})=>{
  const frontSelector='[data-workspace-panel="'+frontId+'"]',backSelector='[data-workspace-panel="'+backId+'"]';
  const read=()=>{
   const front=document.querySelector(frontSelector),back=document.querySelector(backSelector);
   if(!back)return null;
   const panel=back.getBoundingClientRect(),body=back.querySelector('.workspace-panel-body').getBoundingClientRect();
   const content=back.querySelector('.workbench-inspector-content'),frontRect=front?.getBoundingClientRect();
   const hits=[],walk=content?document.createTreeWalker(content,NodeFilter.SHOW_TEXT):null;
   let node;
   while(walk&&(node=walk.nextNode())){
    const text=node.textContent.trim();if(!text)continue;
    const range=document.createRange();range.selectNodeContents(node);
    for(const rect of range.getClientRects()){
     const px=rect.left+Math.min(6,rect.width/2),py=rect.top+rect.height/2;
     if(py<coverTop+10||py<body.top||py>=body.bottom||px<body.left||px>=body.right||py>=innerHeight)continue;
     // Sample the strip actually uncovered by the horizontal drag, rather
     // than relying on a closing card's disabled pointer events.
     if(frontRect&&px>=frontRect.left&&px<frontRect.right&&py>=frontRect.top&&py<frontRect.bottom)continue;
     const hit=document.elementsFromPoint(px,py).find(el=>el.closest('[data-workspace-panel]'));
     if(hit?.closest('[data-workspace-panel]')===back&&content.contains(hit))hits.push({text:text.slice(0,90),x:px,y:py});
    }
   }
   return {time:performance.now(),frontPresent:!!front,closing:front?.dataset.closing==='true',panelHeight:panel.height,bodyHeight:body.height,
    frontLeft:frontRect?.left,backLeft:panel.left,hits};
  };
  const state=window.__backgroundReveal={frames:[read()],done:false};
  document.addEventListener('pointerup',()=>{
   const start=performance.now();
   const frame=()=>{
    const value=read();state.frames.push(value);
    if(value?.frontPresent&&performance.now()-start<800)requestAnimationFrame(frame);else state.done=true;
   };requestAnimationFrame(frame);
  },{once:true});
  return state.frames[0];
 },{frontId,backId,coverTop});
 assert.ok(initial.bodyHeight>=initial.panelHeight-66,'The covered background retains a full-height flex body while the foreground is dragged: '+JSON.stringify(initial));
 assert.ok(initial.hits.length>0,'Moving the front card exposes real background content at text rectangles in the overlap: '+JSON.stringify(initial));
 await page.screenshot({path:join(artifactDir,'background-body-while-dragged.png'),fullPage:true});
 await page.mouse.up();
 await page.waitForFunction(()=>window.__backgroundReveal?.done);
 const frames=await page.evaluate(()=>window.__backgroundReveal.frames);
 writeFileSync(join(artifactDir,'background-reveal.json'),JSON.stringify(frames,null,2));
 assert.ok(frames.some(frame=>frame?.frontPresent&&frame.closing&&frame.bodyHeight>=frame.panelHeight-66&&frame.hits.length>0),
  'Before the exiting foreground is removed, the uncovered background still renders its full body and visible text');
 await card(frontId).waitFor({state:'hidden'});await settle();
}
async function openBlock(mobile=false){
 const node=page.locator('.tiptap .rk-directive-warning').first();
 await node.scrollIntoViewIfNeeded();
 if(mobile)await node.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});else await node.hover();
 const grip=page.getByRole('group',{name:'块把手'});
 await grip.waitFor();
 await grip.getByRole('button',{name:'块操作'}).click();
 await page.getByRole('menuitem',{name:'编辑块',exact:true}).last().click();
 await (mobile?page.getByRole('dialog',{name:'块编辑面板'}):card(ids.block)).waitFor();await settle();
}
const content='# Stack regression\n\nA stable editable paragraph.\n\n## Second heading\n\n::: warning Panel fixture\n\nWarning body remains intact.\n\n:::\n\n### Third heading\n\nLast paragraph.\n';
async function createRecord(suffix,fixtureContent=content){
 return page.evaluate(async({content,suffix})=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Panel stack '+suffix+' '+Date.now()+'.md',kind:'document',content})});
  if(!response.ok)throw Error('Cannot create stack fixture: '+await response.text());
  return response.json();
 },{content:fixtureContent,suffix});
}

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const first=await createRecord('first'),second=await createRecord('second');
 const visit=async record=>{
  await page.waitForLoadState('networkidle');
  await page.goto(base+'/records/'+record.id+'?mode=visual',{waitUntil:'networkidle'});
 };
 await visit(first);
 await page.locator('.workspace[data-panel-layout="docked"]').waitFor();
 if(!await card(ids.outline).isVisible())await trigger('目录');
 await card(ids.outline).waitFor();await settle();
 assert.equal(await card(ids.outline).getAttribute('role'),'complementary');
 const longRecord=await createRecord('long-outline',Array.from({length:100},(_,i)=>'## Outline heading '+i+'\n\nBody '+i+'.').join('\n\n'));
 await visit(longRecord);await card(ids.outline).waitFor();await settle();
 const outline=card(ids.outline),heading=outline.locator('.workspace-panel-header'),grip=outline.locator('[data-panel-handle]');
 const headingBefore=await heading.boundingBox(),gripBefore=await grip.boundingBox();
 const scroller=outline.locator('.workspace-panel-content');
 await scroller.hover();await page.mouse.wheel(0,10000);
 await page.waitForFunction(()=>{const el=document.querySelector('[data-workspace-panel="document-panel-outline"] .workspace-panel-content');return el&&el.scrollTop>0&&el.scrollHeight-el.clientHeight-el.scrollTop<3;});
 const last=await outline.locator('.outline-item').last().boundingBox(),view=await scroller.boundingBox();
 assert.ok(last.y>=view.y-1&&last.y+last.height<=view.y+view.height+1,'Long outline reaches its final heading');
 assert.ok(Math.abs((await heading.boundingBox()).y-headingBefore.y)<1&&Math.abs((await grip.boundingBox()).y-gripBefore.y)<1,'Outline header and handle remain fixed during body scrolling');
 await visit(first);await settle();

 let previous=await boxes();
 await trigger('信息');await assertNewFront(ids.info,previous);
 await card(ids.info).locator('.workspace-panel-content').hover();
 await page.mouse.wheel(0,450);
 await page.waitForFunction(()=>document.querySelector('[data-workspace-panel="document-panel-info"] .workspace-panel-content')?.scrollTop>60);
 previous=await boxes();await trigger('历史');await assertNewFront(ids.history,previous);
 assert.ok(await card(ids.info).locator('.workspace-panel-content').evaluate(el=>el.scrollTop)>60,'Opening the foreground preserves the background info scroll position');
 for(const id of [ids.info,ids.outline,ids.history])assert.equal(await card(id).getAttribute('role'),'complementary');
 const geometry=await page.evaluate(()=>{
  const rail=document.querySelector('.workspace-panel-rail').getBoundingClientRect();
  const editor=document.querySelector('.tiptap').getBoundingClientRect();
  return {railLeft:rail.left,railRight:rail.right,editorRight:editor.right,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth};
 });
 assert.ok(geometry.editorRight<=geometry.railLeft+1,'The reserved panel column must not cover document content: '+JSON.stringify(geometry));
 assert.ok(geometry.railRight<=geometry.viewport+1&&geometry.pageWidth<=geometry.viewport+1,'The docked stack must fit the viewport');
 await page.screenshot({path:join(artifactDir,'overlap-initial.png'),fullPage:true});
 console.log('PASS docked info/outline/history coexistence, new-panel placement and document clearance',engine);

 await assertPointerPolish(ids.history);

 // An exposed background handle accepts a real click without removing peers.
 await card(ids.outline).getByRole('separator').click();await settle();
 assert.equal((await boxes()).length,3,'The taller background card remains reachable through its exposed strip');
 const before=await boxes(),historyBefore=before.find(item=>item.id===ids.history);
 const infoBefore=before.find(item=>item.id===ids.info);
 await drag(ids.history,0,-(infoBefore.height-historyBefore.height+100),{sample:true});
 const after=await assertCoverage(),historyAfter=after.find(item=>item.id===ids.history);
 assert.ok(historyAfter.height>historyBefore.height+40,'Pulling the top handle upwards increases panel height');
 assert.ok(historyAfter.z<after.find(item=>item.id===ids.info).z,'Growing through another card height moves the dragged card behind that shorter card');
 const motion=await page.evaluate(()=>window.__stackMotion.frames);
 writeFileSync(join(artifactDir,'reorder-motion.json'),JSON.stringify({before,after,frames:motion},null,2));
 const intermediate=after.some(end=>{
  const points=motion.flatMap(frame=>frame.cards.filter(item=>item.id===end.id));
  const start=before.find(item=>item.id===end.id)?.y;
  return start!==undefined&&Math.abs(start-end.y)>4&&points.some(point=>point.y>Math.min(start,end.y)+1&&point.y<Math.max(start,end.y)-1);
 });
 assert.ok(intermediate,'Height crossing must show an intermediate position while the overlaid cards move');
 assert.ok(motion.some(frame=>frame.cards.find(item=>item.id===ids.history)?.z>frame.cards.find(item=>item.id===ids.info)?.z)&&
  motion.some(frame=>frame.cards.find(item=>item.id===ids.history)?.z<frame.cards.find(item=>item.id===ids.info)?.z),
  'Height crossing changes the foreground/background layer order during the sampled motion');
 assert.ok(motion.some(frame=>frame.cards.some(item=>item.opacity>.19&&item.opacity<.98&&Math.abs(parseFloat(item.translate)||0)>.5)),
  'Depth exchange must have a sampled intermediate fade and translation, rather than only an instantaneous z-index change');
 await page.screenshot({path:join(artifactDir,'overlap-after-height-crossing.png'),fullPage:true});
 await dragReveal(ids.info,ids.history);
 assert.ok(await card(ids.history).isVisible()&&await card(ids.outline).isVisible(),'Right drag closes only its target');
 console.log('PASS vertical resizing, animated reorder and individual right-drag close',engine);

 await trigger('目录');await card(ids.outline).waitFor({state:'hidden'});
 await visit(second);await settle();assert.equal(await card(ids.outline).isVisible(),false,'Explicitly closed outline stays closed on another record');
 await reload();await settle();assert.equal(await card(ids.outline).isVisible(),false,'Outline closed preference survives refresh');
 await trigger('目录');await card(ids.outline).waitFor();
 await visit(first);await card(ids.outline).waitFor();
 await reload();await card(ids.outline).waitFor();
 console.log('PASS outline explicit close/open preference across records and reload',engine);

 // Navigate through the live sidebar while the closing card still owns its
 // exit timer; a full document load would conceal a stale shared-store entry.
 await trigger('目录');await card(ids.outline).waitFor({state:'hidden'});
 await trigger('信息');await card(ids.info).waitFor();await settle();
 await card(ids.info).getByRole('button',{name:'关闭',exact:true}).click();
 assert.equal(await card(ids.info).getAttribute('data-closing'),'true','Navigate before the info exit completes');
 await page.locator('.tree-link[href="/records/'+second.id+'"]').click();
 await page.waitForURL(url=>url.pathname==='/records/'+second.id);
 await page.locator('.tiptap').waitFor();await settle();
 assert.equal(await page.locator('.workspace-panel-rail [data-workspace-panel]').count(),0,'Closing cards must be removed after a route replacement');
 assert.equal(await page.locator('.workspace').getAttribute('data-panels-open'),null,'A closed panel must not reserve an empty rail');
 const reserved=await page.locator('.workspace>.main-content').evaluate(el=>parseFloat(getComputedStyle(el).paddingInlineEnd));
 assert.equal(reserved,0,'A completed close releases the reserved document column after navigation');
 console.log('PASS closing info during client navigation leaves no transparent card or empty column',engine);
 await visit(first);await trigger('目录');await card(ids.outline).waitFor();

 await trigger('信息');await trigger('历史');await settle();
 previous=await boxes();
 await openBlock();await assertNewFront(ids.block,previous);
 const raw=card(ids.block).getByRole('textbox',{name:'块源码',includeHidden:true});
 const incomplete='# INCOMPLETE_RAW_DRAFT';
 await card(ids.block).getByRole('tab',{name:'源码',exact:true}).click();
 await raw.fill(incomplete);
 await card(ids.block).getByRole('alert').waitFor();
 await page.evaluate(()=>{
  window.__stackEditor=document.querySelector('.tiptap');
  window.__stackRaw=document.querySelector('[data-workspace-panel="block-editor"] textarea');
 });
 const paragraph=page.locator('.tiptap p').filter({hasText:'A stable editable paragraph.'}).first();
 await paragraph.click();await page.keyboard.press('End');await page.keyboard.type(' STACK_UNDO');
 await page.locator('.save-status').getByText('未保存').waitFor();
 await raw.focus();
 const blockBefore=await card(ids.block).boundingBox(),escapeGrip=await card(ids.block).locator('[data-panel-handle]').boundingBox();
 await page.mouse.move(escapeGrip.x+escapeGrip.width/2,escapeGrip.y+escapeGrip.height/2);await page.mouse.down();
 await page.mouse.move(escapeGrip.x+escapeGrip.width/2+35,escapeGrip.y+escapeGrip.height/2-50,{steps:12});
 await page.keyboard.press('Escape');await settle();
 assert.ok(await card(ids.block).isVisible(),'Escape cancels drag while the raw field retains focus');
 assert.ok(Math.abs((await card(ids.block).boundingBox()).height-blockBefore.height)<2,'Escape restores pre-drag height');
 assert.equal(await raw.inputValue(),incomplete,'Escape cancel preserves raw draft');
 await page.mouse.up();await settle();
 await drag(ids.block,40,0);
 assert.equal(await raw.inputValue(),incomplete,'Dragging a panel preserves invalid raw input');
 assert.ok(await page.evaluate(()=>window.__stackRaw===document.querySelector('[data-workspace-panel="block-editor"] textarea')&&window.__stackEditor===document.querySelector('.tiptap')),
  'Moving/resizing the panel preserves its form and visual editor instances');
 await card(ids.block).getByRole('button',{name:'折叠块编辑面板',exact:true}).click();
 assert.equal(await card(ids.block).getAttribute('data-collapsed'),'true');
 await card(ids.block).getByRole('button',{name:'展开块编辑面板',exact:true}).click();
 assert.equal(await raw.inputValue(),incomplete,'Collapsing and expanding preserve the incomplete panel draft');
 await paragraph.click();await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>!document.querySelector('.tiptap')?.textContent?.includes('STACK_UNDO'));
 assert.equal(await raw.inputValue(),incomplete,'Undo of a different block preserves the incomplete panel draft');
 await page.locator('.save-status').getByText('已保存').waitFor();
 assert.equal(await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()).content,first.id),content,'Panel actions do not implicitly save content');
 await page.screenshot({path:join(artifactDir,'desktop.png'),fullPage:true});
 await card(ids.block).getByRole('button',{name:'关闭',exact:true}).click();
 await card(ids.block).waitFor({state:'hidden'});
 console.log('PASS block raw draft, stable editor/form instances and preserved Undo',engine);

 for(const width of [390,320]){
  // Windows WebKit needs a stable height when native sheets are present.
  await page.setViewportSize({width,height:engine==='webkit'?1100:900});
  await reload();await page.locator('.tiptap').waitFor();await settle();
  assert.equal(await page.locator('dialog[open]').count(),0,'Persisted outline does not auto-open a mobile sheet');
  for(const name of ['信息','目录','历史']){
   await trigger(name);await settle();
   const dialog=page.locator('dialog[open]');
   assert.equal(await dialog.count(),1,'Only one mobile panel may be open: '+name+' at '+width);
   assert.equal(await dialog.locator('.astryx-bottom-sheet').count(),1,'Mobile panels use the native BottomSheet');
   const bounds=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth};});
   assert.ok(bounds.left>=-1&&bounds.right<=width+1&&bounds.pageWidth<=width+1,'Mobile panel fits '+width+'px: '+JSON.stringify(bounds));
   if(name==='信息')await page.screenshot({path:join(artifactDir,'mobile-sheet-'+width+'.png'),fullPage:true});
   await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});
  }
  await openBlock(true);
  const sheet=page.locator('dialog[open]');
  assert.equal(await sheet.count(),1,'Block editor shares the single mobile sheet');
  assert.equal(await sheet.locator('.astryx-bottom-sheet').count(),1);
  const mobileRaw=sheet.getByRole('textbox',{name:'块源码',includeHidden:true});
  await sheet.getByRole('tab',{name:'源码',exact:true}).click();
  await mobileRaw.fill(incomplete);
  if(width===390){
   await mobileRaw.evaluate(el=>{
    el.focus();el.setSelectionRange(2,12);
    window.__roundtripRaw=el;window.__roundtripEditor=document.querySelector('.tiptap');
   });
   const assertRoundtrip=async label=>{
    await page.waitForFunction(()=>document.activeElement===window.__roundtripRaw);
    const state=await page.evaluate(()=>{
     const raw=window.__roundtripRaw;
     return {same:raw?.isConnected&&raw===document.querySelector('#block-editor textarea'),
      sameEditor:window.__roundtripEditor===document.querySelector('.tiptap'),value:raw?.value,
      start:raw?.selectionStart,end:raw?.selectionEnd};
    });
    assert.deepEqual(state,{same:true,sameEditor:true,value:incomplete,start:2,end:12},'Block form/focus/selection survive '+label);
   };
   await page.setViewportSize({width:1600,height:engine==='webkit'?1100:900});
   await card(ids.block).waitFor();await settle();
   await assertRoundtrip('mobile to desktop');
   await page.setViewportSize({width,height:engine==='webkit'?1100:900});
   await page.getByRole('dialog',{name:'块编辑面板'}).waitFor();await settle();
   assert.equal(await page.locator('dialog[open]').count(),1,'Returning from desktop opens only the active block sheet');
   await assertRoundtrip('desktop back to mobile');
   await page.screenshot({path:join(artifactDir,'mobile-block-roundtrip.png'),fullPage:true});
   console.log('PASS mobile/desktop/mobile raw draft, focus, selection and editor/form instance retention',engine);
  }
  await sheet.getByRole('textbox',{name:'块源码',includeHidden:true}).focus();
  await page.keyboard.press('Escape');
  await sheet.waitFor({state:'hidden'});
  await page.screenshot({path:join(artifactDir,'mobile-'+width+'.png'),fullPage:true});
 }
 if(engine==='chromium'){
  // Keep the short-desktop matrix separate from the mobile drafts and from
  // Windows WebKit, whose native dialogs require a stable viewport height.
  await reload();
  await page.setViewportSize({width:1600,height:500});
  await page.locator('.workspace[data-panel-layout="docked"]').waitFor();
  if(!await card(ids.outline).isVisible())await trigger('目录');
  await trigger('信息');await trigger('历史');await settle();
  assert.equal((await boxes()).length,3,'Short desktop opens the three document panels');
  assert.equal((await boxes()).filter(item=>item.collapsed).length,0,'Overlapping cards fit a short viewport without collapsing based on their summed heights');
  await assertCoverage();
  await page.screenshot({path:join(artifactDir,'short-desktop-overlap.png'),fullPage:true});
  await card(ids.info).getByRole('button',{name:'折叠信息',exact:true}).click();await settle();
  assert.equal(await card(ids.info).getAttribute('data-collapsed'),'true','A manual collapse still works in the overlay stack');
  await card(ids.info).getByRole('button',{name:'展开信息',exact:true}).click();await settle();
  assert.notEqual(await card(ids.info).getAttribute('data-collapsed'),'true','One chevron click expands the collapsed card');
  const closedId=ids.history;
  await card(closedId).getByRole('button',{name:'关闭',exact:true}).click();
  await card(closedId).waitFor({state:'hidden'});await settle();
  const survivors=await boxes();
  assert.equal(survivors.length,2,'One close click removes only the selected overlaid card');
  assert.ok(survivors.some(item=>item.id===ids.info),'Closing history preserves the expanded info card');
  const shortGeometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,
   rail:[...document.querySelectorAll('.workspace-panel-rail [data-workspace-panel]')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})}));
  assert.ok(shortGeometry.pageWidth<=shortGeometry.width+1&&shortGeometry.rail.every(r=>r.left>=0&&r.right<=shortGeometry.width+1&&r.top>=0&&r.bottom<=shortGeometry.height+1),
   'The overlaid stack must remain inside the short viewport: '+JSON.stringify(shortGeometry));
  await page.screenshot({path:join(artifactDir,'short-desktop.png'),fullPage:true});

  // Native focus events inside the portaled content must activate the card,
  // and Escape from that body must close that card rather than its sibling.
  const focusId=survivors.find(item=>item.id!==ids.outline)?.id;
  assert.ok(focusId,'A non-outline inspector survives the overlay close');
  const focusTarget=focusId===ids.info?card(focusId).getByRole('button',{name:'添加标签',exact:true}):card(focusId).getByRole('button',{name:'比较',exact:true}).first();
  await focusTarget.focus();await page.keyboard.press('Escape');
  await card(focusId).waitFor({state:'hidden'});await settle();
  assert.ok(await card(ids.outline).isVisible(),'Escape from inspector content preserves the outline');
  const outlineHandle=card(ids.outline).getByRole('separator');
  const originalHeight=(await card(ids.outline).boundingBox()).height;
  await outlineHandle.press('ArrowDown');await settle();
  const smallerHeight=(await card(ids.outline).boundingBox()).height;
  assert.ok(smallerHeight<originalHeight-10,'Handle ArrowDown decreases panel height');
  await outlineHandle.press('ArrowUp');await settle();
  assert.ok((await card(ids.outline).boundingBox()).height>smallerHeight+10,'Handle ArrowUp increases panel height');
  await page.screenshot({path:join(artifactDir,'short-desktop-keyboard.png'),fullPage:true});
  console.log('PASS short desktop true overlap, manual collapse/expand, individual close, content Escape and handle arrow keys',engine);
 }
 assert.deepEqual(faults,[],'Browser runtime errors');
 console.log('PASS 390/320 single native mobile sheet and no automatic outline popup',engine,'artifacts:',artifactDir);
}catch(error){
 await page.screenshot({path:join(artifactDir,'failure.png'),fullPage:true}).catch(()=>undefined);
 console.error('Panel stack regression failed',JSON.stringify({engine,url:page.url(),faults,artifactDir,panels:await boxes().catch(()=>[]),
  visible:await page.locator('body').innerText().then(text=>text.slice(0,2200)).catch(()=>null)}));
 throw error;
}finally{
 if(engine==='webkit')await page.unrouteAll({behavior:'ignoreErrors'});
 await context.close();await browser.close();
}
