import {readLocalAuthVars} from './local-auth-config.mjs';
/** Isolated E2E test for D1 links, semantic fallback and Cytoscape workspace.
 * Run only on an isolated local Wrangler D1/KV fixture (default :8897).
 */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const bin=[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x));
const line=readLocalAuthVars().split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
const secret=process.env.RECALLOOM_TEST_SECRET||line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const engine=process.env.RECALLOOM_E2E_BROWSER==='webkit'?'webkit':'chromium';
assert.ok((engine==='webkit'||bin)&&secret);
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:/,'never run destructive fixtures on remote or production');
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{executablePath:bin}:{})});
const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light'});
page.setDefaultTimeout(20000);
let stage='login';
const step=name=>{stage=name;console.log('Graph E2E ('+engine+'): '+name);};
page.on('crash',()=>console.error('Graph page process crashed at '+stage));
const watchdog=setTimeout(()=>{console.error('Graph E2E timed out at '+stage);process.exit(1);},120000);
let sessionCookie='';
if(engine==='webkit')await page.route('**/api/**',async route=>{
 const request=route.request();
 // Windows WebKit does not persist the loopback-only secure session cookie.
 // Production cookie policy remains unchanged; forward it in this local fixture.
 if(new URL(request.url()).pathname==='/api/auth/login'){
  const response=await route.fetch();sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});return;
 }
 if(sessionCookie){await route.fulfill({response:await route.fetch({headers:{...await request.allHeaders(),cookie:sessionCookie}})});return;}
 await route.continue();
});
const errors=[];
const cssRequests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/assets/')&&path.endsWith('.css'))cssRequests.push(path);});
async function api(path,method='GET',body){
 const response=await page.evaluate(async ({path,method,body})=>{
  const r=await fetch('/api'+path,{method,headers:body===undefined?{}:{'content-type':'application/json'},
   body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>({}))};
 },{path,method,body});
 return response;
}
function expectCode(result,status,label){
 assert.equal(result.status,status,label+': '+JSON.stringify(result.body).slice(0,900));return result.body;
}
function visible(locator){return locator.waitFor({state:'visible',timeout:15000});}
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:40000});
 step('API relationships');
 const stamp=String(Date.now());
 const f=expectCode(await api('/folders','POST',{name:'0 Graph E2E '+stamp}),201,'create folder');
 const make=async(label,content)=>expectCode(await api('/records','POST',{
  name:'Graph '+label+' '+stamp,folderId:f.id,kind:'document',content
 }),201,'create '+label);
 const A=await make('Alpha','# Alpha\n\nCloudflare Workers and Vectorize semantic association.');
 const B=await make('Beta','# Beta\n\nCloudflare Workers and documentation.');
 const C=await make('Gamma','# Gamma\n\nKnowledge graph and hierarchy.');
 const D=await make('Delta','# Delta\n\nKnowledge base unrelated.');
 const noId=await api('/graph?focusId=not-a-uuid');
 expectCode(noId,400,'invalid focus identifier');

 expectCode(await api('/records/'+A.id+'/links','POST',{action:'add',targetId:B.id,relation:'references'}),200,'A references B');
 expectCode(await api('/records/'+C.id+'/links','POST',{action:'add',targetId:A.id,relation:'supports'}),200,'C supports A');

 const relations=expectCode(await api('/records/'+A.id+'/relations?semantic=false'),200,'authoritative relations');
 assert.equal(relations.links.length,2);
 assert.ok(relations.links.some(link=>link.other.id===B.id&&link.direction==='outgoing'&&link.relation==='references'));
 assert.ok(relations.links.some(link=>link.other.id===C.id&&link.direction==='incoming'&&link.relation==='supports'));
 assert.equal(relations.semanticStatus,'disabled');
 assert.equal(relations.suggestions.length,0);

 const auto=expectCode(await api('/records/'+A.id+'/relations'),200,'semantic graceful fallback');
 assert.ok(['indexing','unavailable','ready'].includes(auto.semanticStatus),JSON.stringify(auto));
 assert.equal(auto.links.length,2,'semantic fallback preserves explicit links');
 const local=expectCode(await api('/graph?focusId='+A.id+'&semantic=false'),200,'focused graph');
 assert.equal(local.focusId,A.id);
 assert.ok(local.nodes.some(n=>n.id===A.id));
 assert.ok(local.nodes.some(n=>n.id===B.id));
 assert.ok(local.nodes.some(n=>n.id===C.id));
 assert.ok(local.edges.some(e=>e.sourceId===A.id&&e.targetId===B.id&&e.type==='explicit'));
 assert.ok(local.edges.some(e=>e.sourceId===C.id&&e.targetId===A.id&&e.type==='explicit'));
 assert.ok(local.edges.some(e=>e.type==='folder'),'sibling structure visible');

 const global=expectCode(await api('/graph?semantic=false'),200,'recent graph');
 assert.equal(global.scope,'recent');
 assert.ok(global.nodes.length>=4);
 assert.ok(global.nodes.every(n=>n.status!=='archived'));
 assert.ok(global.edges.every(e=>global.nodes.some(n=>n.id===e.sourceId)&&global.nodes.some(n=>n.id===e.targetId)));

 // Include unrelated documents outside the focused API response.
 const otherFolder=expectCode(await api('/folders','POST',{name:'Graph outer '+stamp}),201,'outer folder');
 const outer=[];
 for(let index=0;index<16;index++)outer.push(expectCode(await api('/records','POST',{
  name:'外围文稿 '+index+' · '+stamp,folderId:otherFolder.id,kind:'document',content:'# 外围文稿 '+index
 }),201,'outer document'));
 await page.goto(base+'/tasks',{waitUntil:'networkidle'});
 const taskHeader=await page.locator('.tasks-page').evaluate(el=>({
  top:getComputedStyle(el).paddingTop,left:getComputedStyle(el).paddingLeft,
  font:getComputedStyle(el.querySelector('h1')).fontSize,gap:getComputedStyle(el.querySelector('.page-header')).marginBottom
 }));
 // Hold semantic enrichment to prove that authoritative content renders first.
 let releaseSemantic;const semanticGate=new Promise(resolve=>{releaseSemantic=resolve;});
 await page.route('**/api/graph?**',async route=>{
  const url=new URL(route.request().url());
  if(url.searchParams.get('semantic')!=='true'){await route.fallback();return;}
  const response=await route.fetch(sessionCookie?{headers:{...await route.request().allHeaders(),cookie:sessionCookie}}:undefined),body=await response.json();await semanticGate;
  assert.equal(response.status(),200,'Semantic enrichment response: '+JSON.stringify(body));
  const focus=url.searchParams.get('focusId');
  if(!focus||focus===A.id){
   if(!body.nodes.some(node=>node.id===outer[0].id))body.nodes.push({...outer[0],folderName:otherFolder.name});
   body.edges.push({id:'semantic:'+A.id+':'+outer[0].id,sourceId:A.id,targetId:outer[0].id,type:'semantic',relation:'语义相似',score:.91});
   body.semanticStatus='ready';
  }
  await route.fulfill({response,json:body});
 });
 await page.goto(base+'/graph',{waitUntil:'domcontentloaded'});
 step('progressive overview and task page header');
 await visible(page.getByRole('heading',{name:'知识关系网'}));
 await visible(page.getByRole('img',{name:/交互式文档关系图/}));
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')?._cyreg?.cy?.nodes().length>=20&&document.querySelector('.graph-stage').getAttribute('aria-busy')==='false');
 assert.ok(await page.getByText('正在补充语义关联…',{exact:true}).isVisible(),'Only semantic enrichment remains loading');
 assert.ok(await page.getByRole('checkbox',{name:'语义关联',exact:true}).isEnabled(),'Semantic suggestions are available in overview');
 const header=await page.locator('.knowledge-graph-page').evaluate(el=>({
  top:getComputedStyle(el).paddingTop,left:getComputedStyle(el).paddingLeft,
  font:getComputedStyle(el.querySelector('h1')).fontSize,gap:getComputedStyle(el.querySelector('.page-header')).marginBottom
 }));
 assert.deepEqual(header,taskHeader,'Graph and task headers use identical spacing and typography');
 assert.equal(await page.locator('.knowledge-graph-page h1 svg').count(),0,'No title icon');
 releaseSemantic();
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.edges('.semantic').length>0);
 assert.ok(cssRequests.some(path=>path.includes('/knowledge-graph-')),'Graph route requests its own CSS');
 const canvas=page.locator('.knowledge-graph-canvas'),dims=await canvas.boundingBox();
 assert.ok(dims.width>1000&&dims.height>550,'Graph fills remaining workspace '+JSON.stringify(dims));
 assert.equal(await page.locator('.graph-inspector').count(),0,'No permanent sidebar');
 const geometry=()=>page.evaluate(()=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy;
  return {same:cy===window.graphRegressionCy,zoom:cy.zoom(),pan:cy.pan(),positions:cy.nodes().map(node=>({id:node.id(),position:node.position()})).sort((a,b)=>a.id.localeCompare(b.id))};
 });
 const settle=()=>page.waitForFunction(()=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy;
  return !cy.animated()&&cy.nodes().every(node=>!node.animated());
 });
 await settle();
 await page.evaluate(()=>{window.graphRegressionCy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy;});
 const overviewGeometry=await geometry();
 const initialViewport=await canvas.evaluate(element=>{
  const cy=element._cyreg.cy,bounds=element.getBoundingClientRect();
  return {height:cy.height(),width:cy.width(),clientHeight:bounds.height,zoom:cy.zoom(),pan:cy.pan(),bounds:cy.nodes().boundingBox()};
 });
 assert.ok(initialViewport.height>500&&initialViewport.zoom>.3,'Initial graph uses the measured viewport: '+JSON.stringify(initialViewport));
 const tap=async id=>{
  await page.evaluate(id=>{document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id).emit('tap');},id);
  await page.waitForURL('**/graph?focus='+id);
  await page.waitForFunction(id=>{
   const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy,p=cy.$id(id).position();
   return cy.$id(id).hasClass('focus-node')&&Math.hypot(p.x,p.y)<.5&&!cy.animated()&&cy.nodes().every(node=>!node.animated());
  },id);
 };
 // Actual pointer click changes the center and does not open a preview.
 const point=await page.evaluate(id=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id).renderedPosition(),A.id);
 await page.mouse.click(dims.x+point.x,dims.y+point.y);
 await page.waitForURL('**/graph?focus='+A.id);
 await page.waitForFunction(id=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy,p=cy.$id(id).position();
  return cy.$id(id).hasClass('focus-node')&&Math.hypot(p.x,p.y)<.5&&!cy.animated()&&cy.nodes().every(node=>!node.animated());
 },A.id);
 assert.equal(await page.locator('.workspace-panel:not([data-closing])').count(),0,'Single click explores without opening a Drawer');
 assert.ok((await geometry()).same,'Center changes keep the graph instance');
 for(const node of overviewGeometry.positions)assert.ok((await geometry()).positions.some(item=>item.id===node.id),'Background retained: '+node.id);
 assert.ok(await page.evaluate(id=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id).hasClass('context-node'),outer[1].id),'Unrelated documents stay in the outer ring');
 assert.ok(await canvas.evaluate(element=>{
  const cy=element._cyreg.cy;
  return cy.nodes().every(node=>{const p=node.renderedPosition();return p.x>=30&&p.x<=cy.width()-30&&p.y>=30&&p.y<=cy.height()-45;});
 }),'Changing center keeps the outer nodes inside the rectangular viewport');
 await page.screenshot({path:'tmp/knowledge-graph-overview-'+engine+'.jpg',type:'jpeg',quality:78});
 // Interrupt position animations with subsequent center changes.
 for(const id of [B.id,C.id,A.id]){
  await page.evaluate(id=>{document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id).emit('tap');},id);
  await page.waitForURL('**/graph?focus='+id);
  await page.waitForFunction(id=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id).hasClass('focus-node'),id);
 }
 await settle();
 assert.ok(await page.evaluate(id=>{
  const node=document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id);
  return Math.hypot(node.position().x,node.position().y)<.5&&Number(node.style('text-opacity'))===1;
 },A.id),'Rapid navigation settles the final center and its label');
 await tap(D.id);await tap(A.id);
 const detail=id=>page.locator('[data-workspace-panel="graph-node-'+id+'"]:not([data-closing])');
 const inspect=async id=>{
  await page.getByRole('button',{name:'文稿列表',exact:true}).click();
  await page.getByRole('complementary',{name:'文稿列表',exact:true}).getByRole('button',{name:'查看'+(id===A.id?A.name:C.name)+'的详情',exact:true}).click();
  await visible(detail(id));
 };
 step('independent detail panels');
 await page.getByRole('button',{name:'查看当前文稿详情',exact:true}).click();await visible(detail(A.id));
 assert.ok(await detail(A.id).getByText('Markdown 文档',{exact:true}).count(),'Metadata renders immediately');
 await detail(A.id).getByRole('button',{name:'查看'+C.name+'的详情',exact:true}).click();await visible(detail(C.id));
 assert.equal(await page.locator('[data-workspace-panel^="graph-node-"]:not([data-closing])').count(),2,'Independent node panels');
 await page.getByRole('button',{name:'查看当前文稿详情',exact:true}).click();
 assert.equal(await page.locator('[data-workspace-panel^="graph-node-"]:not([data-closing])').count(),2,'Existing detail is reused');
 assert.ok(page.url().endsWith('focus='+A.id),'Inspecting neighbors does not change the center');
 await detail(C.id).getByRole('button',{name:'关闭',exact:true}).click();await detail(C.id).waitFor({state:'detached'});
 await detail(A.id).getByRole('button',{name:'关闭',exact:true}).click();await detail(A.id).waitFor({state:'detached'});await settle();
 step('temporary focus and camera restoration');
 await page.evaluate(id=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy,p=cy.$id(id).position();
  cy.pan({x:cy.width()-80-p.x*cy.zoom(),y:cy.height()/2-p.y*cy.zoom()});
 },A.id);
 const obscured=await geometry();
 await page.getByRole('button',{name:'查看当前文稿详情',exact:true}).click();await visible(detail(A.id));
 await page.waitForFunction(id=>{
  const host=document.querySelector('.knowledge-graph-canvas'),cy=host._cyreg.cy;
  return !cy.animated()&&host.getBoundingClientRect().left+cy.$id(id).renderedPosition().x<document.querySelector('.workspace-panel-rail').getBoundingClientRect().left-15;
 },A.id);
 await detail(A.id).getByRole('button',{name:'关闭',exact:true}).click();await detail(A.id).waitFor({state:'detached'});await settle();
 const restored=await geometry();assert.ok(Math.abs(restored.pan.x-obscured.pan.x)<1&&Math.abs(restored.pan.y-obscured.pan.y)<1,'Closing restores automatic reveal pan');
 assert.equal(await page.evaluate(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.elements('.dimmed, .inspected-node').length),0,'Temporary focus clears when details close');
 await page.getByRole('button',{name:'查看当前文稿详情',exact:true}).click();await visible(detail(A.id));
 await page.waitForFunction(id=>{
  const host=document.querySelector('.knowledge-graph-canvas'),cy=host._cyreg.cy;
  return !cy.animated()&&host.getBoundingClientRect().left+cy.$id(id).renderedPosition().x<document.querySelector('.workspace-panel-rail').getBoundingClientRect().left-15;
 },A.id);
 await page.evaluate(()=>{const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy,p=cy.pan();cy.pan({x:p.x-70,y:p.y+25});});
 const manual=await geometry();
 await detail(A.id).getByRole('button',{name:'关闭',exact:true}).click();await detail(A.id).waitFor({state:'detached'});await settle();
 assert.deepEqual((await geometry()).pan,manual.pan,'Manual viewport changes survive closing details');
 await page.getByRole('button',{name:'适应视图',exact:true}).click();
 const stable=await geometry();
 step('filters, labels and wheel zoom');
 await page.getByRole('textbox',{name:'查找图中节点'}).fill('Graph Alpha');
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes('.search-dimmed').length>=19);
 assert.deepEqual(await geometry(),stable,'Search preserves geometry');
 await page.getByRole('textbox',{name:'查找图中节点'}).fill('');
 await page.getByRole('combobox',{name:/显示关联类型/}).click();await page.getByRole('option',{name:'同目录',exact:true}).click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.edges('.folder').every(edge=>edge.style('display')==='none'));
 assert.deepEqual(await geometry(),stable,'Relationship filters preserve geometry');
 await page.getByRole('checkbox',{name:'语义关联',exact:true}).click();await settle();
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.edges('.semantic').length===0);
 await settle();
 const filtered=await geometry();
 await page.getByRole('button',{name:'主题：跟随系统',exact:true}).click();await page.getByRole('button',{name:'主题：浅色',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.effectiveTheme==='dark');
 assert.deepEqual(await geometry(),filtered,'Theme preserves geometry');
 const wheelBefore=(await geometry()).zoom;
 await page.mouse.move(dims.x+70,dims.y+90);await page.mouse.wheel(0,-100);
 await page.waitForFunction(zoom=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.zoom()>zoom*1.1,wheelBefore);
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes('.context-node.label-visible').length>0);
 assert.ok(await page.evaluate(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes('.label-visible').length>3),'Zoom shows readable background labels');
 await page.getByRole('button',{name:'查看当前文稿详情',exact:true}).click();await visible(detail(A.id));
 await detail(A.id).getByRole('button',{name:'关闭',exact:true}).click();await detail(A.id).waitFor({state:'detached'});await settle();
 await page.screenshot({path:'tmp/knowledge-graph-dark-'+engine+'.jpg',type:'jpeg',quality:78});
 await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();await page.getByRole('button',{name:'返回概览',exact:true}).click({trial:true});
 assert.ok(await page.locator('.knowledge-graph-page .page-header').evaluate(element=>element.getBoundingClientRect().top>=46),'Collapsed navigation does not cover header');
 await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();
 await page.getByRole('button',{name:'放大',exact:true}).click();await page.getByRole('button',{name:'缩小',exact:true}).click();
 await page.getByRole('button',{name:'返回概览',exact:true}).click();await page.waitForURL(base+'/graph');await settle();
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes('.focus-node').length===0);
 await settle();
 assert.equal(await page.evaluate(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes('.focus-node').length),0,'Overview clears persistent center');
 await inspect(A.id);await detail(A.id).getByRole('button',{name:'管理关联',exact:true}).click();
 await visible(detail(A.id).getByRole('region',{name:'文档关联'}).getByText(B.name,{exact:true}));

 // Direct inspector: actual incoming/outgoing links, then a new outgoing link.
 step('relationship management');
 await page.goto(base+'/records/'+A.id,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'信息',exact:true}).click();
 await page.locator('.workbench-inspector').waitFor();
 const inspector=page.getByRole('region',{name:'文档关联'});
 await visible(inspector);
 await visible(inspector.getByText(B.name,{exact:true}));
 await visible(inspector.getByText(C.name,{exact:true}));
 const relationLayout=await inspector.evaluate(el=>({display:getComputedStyle(el).display,gap:getComputedStyle(el).rowGap}));
 assert.equal(relationLayout.display,'grid','Record relation styles must load with its component');
 assert.equal(relationLayout.gap,'13px','Record relation spacing must remain intact');
 // A references B, but another relation type to B must still be possible.
 await inspector.getByRole('button',{name:'添加关联',exact:true}).click();
 await inspector.getByRole('textbox',{name:'查找文档'}).fill('Graph Beta '+stamp);
 await visible(inspector.locator('.relation-search-item').filter({hasText:B.name}));
 await inspector.getByRole('textbox',{name:'查找文档'}).fill('Graph Delta '+stamp);
 await visible(inspector.getByText(D.name,{exact:true}));
 const Drow=inspector.locator('.relation-search-item').filter({hasText:D.name});
 await Drow.getByRole('button',{name:'关联'}).click();
 await visible(inspector.locator('.relation-row').filter({hasText:D.name}));
 const created=expectCode(await api('/records/'+A.id+'/links'),200,'persisted links');
 assert.ok(created.items.some(link=>link.targetId===D.id&&link.relation==='related'));
 await inspector.locator('.relation-row').filter({hasText:D.name}).getByRole('button',{name:'解除关系'}).click();
 await inspector.locator('.relation-row').filter({hasText:D.name}).waitFor({state:'detached',timeout:12000});
 const after=expectCode(await api('/records/'+A.id+'/links'),200,'remove link persisted');
 assert.ok(!after.items.some(link=>link.targetId===D.id));
 await inspector.getByRole('link',{name:'查看关系网'}).click();
 await page.waitForURL('**/graph?focus='+A.id,{timeout:12000});

 // Archived documents remain in explicit links but disappear from the global active graph.
 expectCode(await api('/records/'+B.id+'/meta','PATCH',{status:'archived',expectedMetadataRevision:1}),200,'archive B');
 const archived=expectCode(await api('/records/'+A.id+'/relations?semantic=false'),200,'explicit archived link retained');
 assert.ok(archived.links.some(link=>link.other.id===B.id&&link.other.status==='archived'));
 const latest=expectCode(await api('/graph?semantic=false'),200,'active graph excludes archive');
 assert.ok(!latest.nodes.some(n=>n.id===B.id));

 // Windows WebKit can crash when resizing a painted accelerated canvas. Create
 // the compact surface before navigation, rather than resizing a live canvas.
 await page.goto('about:blank');await page.setViewportSize({width:1194,height:834});
 step('wide tablet');
 await page.goto(base+'/graph?focus='+A.id,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'文稿列表',exact:true}).click();
 await visible(page.getByRole('complementary',{name:'文稿列表',exact:true}));
 assert.ok((await canvas.boundingBox()).height>550,'Wide tablet uses a tall graph and the common desktop panel');
 await page.goto('about:blank');await page.setViewportSize({width:390,height:844});
 step('mobile');
 await page.goto(base+'/graph?focus='+A.id,{waitUntil:'networkidle'});
 await visible(page.getByRole('heading',{name:'知识关系网'}));
 const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
  canvas:Math.round(document.querySelector('.knowledge-graph-canvas')?.getBoundingClientRect().width??0)}));
 assert.ok(mobile.canvas>=280&&mobile.canvas<=390,'mobile graph canvas fits '+JSON.stringify(mobile));
 assert.ok(mobile.scrollWidth<=mobile.width+1,'mobile graph page must not overflow '+JSON.stringify(mobile));
 const mobileHeight=await canvas.boundingBox();assert.ok(mobileHeight.height>350,'Mobile canvas uses the remaining viewport');
 assert.ok(await page.locator('.main-scroll').evaluate(el=>el.scrollHeight<=el.clientHeight+2),'Graph does not scroll behind mobile navigation');
 await settle();
 const labelBoxes=await page.evaluate(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes('.label-visible').map(node=>({
  id:node.id(),box:node.renderedBoundingBox({includeNodes:false,includeEdges:false,includeOverlays:false,includeLabels:true})
 })));
 for(let a=0;a<labelBoxes.length;a++)for(let b=a+1;b<labelBoxes.length;b++){
  const x=labelBoxes[a].box,y=labelBoxes[b].box;
  assert.ok(x.x2<=y.x1+1||y.x2<=x.x1+1||x.y2<=y.y1+1||y.y2<=x.y1+1,'Mobile labels avoid collisions: '+JSON.stringify([labelBoxes[a],labelBoxes[b]]));
 }
 await page.screenshot({path:'tmp/knowledge-graph-mobile-'+engine+'.png'});
 await page.getByRole('button',{name:'文稿列表',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'文稿列表',exact:true});await visible(sheet);
 await sheet.getByRole('button',{name:A.name,exact:true}).click();
 await sheet.waitFor({state:'hidden'});
 assert.equal(await page.getByRole('dialog',{name:/节点详情/}).count(),0,'Mobile center selection does not open details');
 await page.getByRole('button',{name:'文稿列表',exact:true}).click();
 await page.getByRole('dialog',{name:'文稿列表',exact:true}).getByRole('button',{name:'查看'+A.name+'的详情',exact:true}).click();
 const mobileDetail=page.getByRole('dialog',{name:'节点详情：'+A.name,exact:true});await visible(mobileDetail);
 await visible(mobileDetail.getByRole('link',{name:'打开文档'}));
 // Trial interaction waits for the sheet's moving ancestor to settle before
 // capturing it; unrelated background animations may keep running indefinitely.
 await mobileDetail.getByRole('button',{name:'关闭',exact:true}).click({trial:true});
 await page.screenshot({path:'tmp/knowledge-graph-mobile-detail-'+engine+'.png'});
 await mobileDetail.getByRole('button',{name:'关闭',exact:true}).click();
 await mobileDetail.waitFor({state:'hidden'});
 await page.waitForFunction(()=>!document.querySelector('.workspace-panel-sheet'));
 step('dense mobile overview fits at real zoom');
 const denseNodes=Array.from({length:80},(_,index)=>({id:'dense-'+index,name:'Mobile document '+index,kind:'document',status:'active',folderId:null,updatedAt:'2026-11-17',revision:1}));
 await page.route('**/api/graph?**',route=>route.fulfill({json:{nodes:denseNodes,edges:[],focusId:null,semanticStatus:'disabled',limit:80,scope:'recent'}}));
 await page.goto(base+'/graph',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')?._cyreg?.cy?.nodes().length===80);
 await settle();
 const dense=await canvas.evaluate(element=>{
  const cy=element._cyreg.cy;
  return {zoom:cy.zoom(),width:cy.width(),height:cy.height(),nodes:cy.nodes().map(node=>({x:node.renderedPosition().x,y:node.renderedPosition().y,radius:node.renderedWidth()/2}))};
 });
 assert.ok(dense.zoom<.8,'Dense mobile overview uses camera zoom '+JSON.stringify(dense));
 const bodyWidth=Math.max(...dense.nodes.map(node=>node.x+node.radius))-Math.min(...dense.nodes.map(node=>node.x-node.radius));
 const bodyHeight=Math.max(...dense.nodes.map(node=>node.y+node.radius))-Math.min(...dense.nodes.map(node=>node.y-node.radius));
 assert.ok(Math.abs(Math.max(bodyWidth/(dense.width-80),bodyHeight/(dense.height-80))-1)<.04,'Automatic fit uses the available canvas without fitting fixed-size labels');
 for(const node of dense.nodes)assert.ok(node.x-node.radius>=0&&node.x+node.radius<=dense.width&&node.y-node.radius>=0&&node.y+node.radius<=dense.height,'All node bodies fit inside the canvas');
 for(let a=0;a<dense.nodes.length;a++)for(let b=a+1;b<dense.nodes.length;b++){
  const left=dense.nodes[a],right=dense.nodes[b];
  assert.ok(Math.hypot(left.x-right.x,left.y-right.y)>left.radius+right.radius,'Dense mobile node bodies stay separate');
 }
 await page.screenshot({path:'tmp/knowledge-graph-dense-mobile-'+engine+'.png'});
 assert.deepEqual(errors,[],'no browser runtime failures');

 console.log('PASS knowledge graph ('+engine+'): progressive semantics, task header, center navigation, outer context, temporary focus restoration, manual viewport, wheel, filters, theme, independent panels, relationships and mobile sheets');
}catch(error){await page.screenshot({path:'tmp/knowledge-graph-failure-'+engine+'.png',timeout:3000}).catch(()=>{});throw error;}
finally{clearTimeout(watchdog);await browser.close()}
