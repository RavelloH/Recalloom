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
  .map(element=>{const r=element.getBoundingClientRect();return {id:element.dataset.workspacePanel,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};})
  .sort((a,b)=>a.y-b.y));
}
async function assertNewTop(id,previous){
 await card(id).waitFor();await settle();
 const current=await boxes(),fresh=current.find(item=>item.id===id);
 assert.equal(current[0]?.id,id,'The new shortest panel should appear above the existing stack: '+JSON.stringify(current));
 assert.ok(fresh.height<=Math.min(...previous.map(item=>item.height))+2,'New panel must start no taller than the shortest open panel');
 assert.equal(current.length,previous.length+1,'Opening a panel preserves its siblings');
}
async function drag(id,dx,dy,{sample=false}={}){
 const handle=card(id).locator('[data-panel-handle]').first();
 await handle.scrollIntoViewIfNeeded();
 const r=await handle.boundingBox();assert.ok(r,'Panel has a visible drag handle');
 const x=r.x+r.width/2,y=r.y+r.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(x+dx,y+dy,{steps:15});
 if(sample)await page.evaluate(()=>{
  window.__stackMotion={frames:[],done:false};
  document.addEventListener('pointerup',()=>{
   const state=window.__stackMotion,start=performance.now();
   const frame=()=>{
    state.frames.push({time:performance.now(),cards:[...document.querySelectorAll('.workspace-panel-rail [data-workspace-panel]')].map(el=>({id:el.dataset.workspacePanel,y:el.getBoundingClientRect().y}))});
    if(performance.now()-start<850)requestAnimationFrame(frame);else state.done=true;
   };frame();
  },{once:true});
 });
 await page.mouse.up();
 if(sample)await page.waitForFunction(()=>window.__stackMotion?.done);
 await settle();
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
async function createRecord(suffix){
 return page.evaluate(async({content,suffix})=>{
  const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Panel stack '+suffix+' '+Date.now()+'.md',kind:'document',content})});
  if(!response.ok)throw Error('Cannot create stack fixture: '+await response.text());
  return response.json();
 },{content,suffix});
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
 let previous=await boxes();
 await trigger('信息');await assertNewTop(ids.info,previous);
 previous=await boxes();await trigger('历史');await assertNewTop(ids.history,previous);
 for(const id of [ids.info,ids.outline,ids.history])assert.equal(await card(id).getAttribute('role'),'complementary');
 const geometry=await page.evaluate(()=>{
  const rail=document.querySelector('.workspace-panel-rail').getBoundingClientRect();
  const editor=document.querySelector('.tiptap').getBoundingClientRect();
  return {railLeft:rail.left,railRight:rail.right,editorRight:editor.right,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth};
 });
 assert.ok(geometry.editorRight<=geometry.railLeft+1,'The reserved panel column must not cover document content: '+JSON.stringify(geometry));
 assert.ok(geometry.railRight<=geometry.viewport+1&&geometry.pageWidth<=geometry.viewport+1,'The docked stack must fit the viewport');
 console.log('PASS docked info/outline/history coexistence, new-panel placement and document clearance',engine);

 // Shorten the original full-height outline to leave space above the stack,
 // then pull its top handle upwards to enlarge it past its shorter siblings.
 const fullOutline=(await boxes()).find(item=>item.id===ids.outline);
 await drag(ids.outline,0,fullOutline.height-170);
 const before=await boxes(),outlineBefore=before.find(item=>item.id===ids.outline);
 assert.equal(before[0].id,ids.outline,'A shortened outline moves above taller siblings');
 await drag(ids.outline,0,-120,{sample:true});
 const after=await boxes(),outlineAfter=after.find(item=>item.id===ids.outline);
 assert.ok(outlineAfter.height>outlineBefore.height+40,'Pulling the top handle upwards increases panel height');
 assert.notEqual(after[0].id,ids.outline,'A taller panel must move below its shorter siblings');
 const motion=await page.evaluate(()=>window.__stackMotion.frames);
 writeFileSync(join(artifactDir,'reorder-motion.json'),JSON.stringify({before,after,frames:motion},null,2));
 const intermediate=after.some(end=>{
  const points=motion.flatMap(frame=>frame.cards.filter(item=>item.id===end.id));
  const start=points[0]?.y;
  return start!==undefined&&Math.abs(start-end.y)>4&&points.some(point=>point.y>Math.min(start,end.y)+1&&point.y<Math.max(start,end.y)-1);
 });
 assert.ok(intermediate,'Panel reordering must show a frame between the released and settled positions');
 await drag(ids.info,125,0);
 await card(ids.info).waitFor({state:'hidden'});
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
 await openBlock();await assertNewTop(ids.block,previous);
 const raw=card(ids.block).getByRole('textbox',{name:'块源码'});
 const incomplete='# INCOMPLETE_RAW_DRAFT';
 await raw.fill(incomplete);
 await card(ids.block).getByRole('alert').waitFor();
 await page.evaluate(()=>{
  window.__stackEditor=document.querySelector('.tiptap');
  window.__stackRaw=document.querySelector('[data-workspace-panel="block-editor"] textarea');
 });
 const paragraph=page.locator('.tiptap p').filter({hasText:'A stable editable paragraph.'}).first();
 await paragraph.click();await page.keyboard.press('End');await page.keyboard.type(' STACK_UNDO');
 await page.locator('.save-status').getByText('未保存').waitFor();
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
 await card(ids.block).getByRole('button',{name:'关闭块编辑',exact:true}).click();
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
  const mobileRaw=sheet.getByRole('textbox',{name:'块源码'});
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
  await sheet.getByRole('button',{name:'关闭块编辑',exact:true}).click();
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
  const collapsed=page.locator('.workspace-panel-rail [data-workspace-panel][data-collapsed="true"]');
  assert.ok(await collapsed.count()>0,'Short desktop automatically collapses a panel');
  const expandedId=await collapsed.first().getAttribute('data-workspace-panel');
  await card(expandedId).getByRole('button',{name:/^展开/}).click();
  await settle();
  assert.notEqual(await card(expandedId).getAttribute('data-collapsed'),'true','One chevron click expands an automatically collapsed panel');
  assert.ok(await collapsed.count()>0,'Another panel collapses to keep the expanded card readable');
  const closedId=await collapsed.first().getAttribute('data-workspace-panel');
  await card(closedId).locator('.workspace-panel-collapsed-title').getByRole('button',{name:/^关闭/}).click();
  await card(closedId).waitFor({state:'hidden'});await settle();
  const survivors=await boxes();
  assert.equal(survivors.length,2,'One close click removes only the selected collapsed card');
  assert.ok(survivors.some(item=>item.id===expandedId),'Closing the other title bar preserves the expanded card');
  const shortGeometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,
   rail:[...document.querySelectorAll('.workspace-panel-rail [data-workspace-panel]')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})}));
  assert.ok(shortGeometry.pageWidth<=shortGeometry.width+1&&shortGeometry.rail.every(r=>r.left>=0&&r.right<=shortGeometry.width+1&&r.top>=0&&r.bottom<=shortGeometry.height+1),
   'Automatically collapsed stack must remain inside the short viewport: '+JSON.stringify(shortGeometry));
  await page.screenshot({path:join(artifactDir,'short-desktop.png'),fullPage:true});

  // Native focus events inside the portaled content must activate the card,
  // and Escape from that body must close that card rather than its sibling.
  const focusId=survivors.find(item=>item.id!==ids.outline)?.id;
  assert.ok(focusId,'A non-outline inspector survives the collapsed-card close');
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
  console.log('PASS short desktop automatic collapse, single-click expand/close, content Escape and handle arrow keys',engine);
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
