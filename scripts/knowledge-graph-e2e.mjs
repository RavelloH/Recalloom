/** Isolated E2E test for D1 links, semantic fallback and Cytoscape workspace.
 * Run only on an isolated local Wrangler D1/KV fixture (default :8897).
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';

const bin=[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x));
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
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
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
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

 await page.goto(base+'/graph?focus='+A.id,{waitUntil:'networkidle'});
 step('canvas and independent panels');
 await visible(page.getByRole('heading',{name:'知识关系网'}));
 await visible(page.getByRole('img',{name:/交互式文档关系图/}));
 const graphLayout=await page.locator('.graph-workspace').evaluate(el=>({display:getComputedStyle(el).display}));
 assert.equal(graphLayout.display,'flex','The graph uses its whole workspace');
 assert.ok(cssRequests.some(path=>path.includes('/knowledge-graph-')),'Graph route must request its own CSS asset');
 const canvas=page.locator('.knowledge-graph-canvas');
 const dims=await canvas.boundingBox();
 await page.screenshot({path:'tmp/knowledge-graph-overview-'+engine+'.jpg',type:'jpeg',quality:72});
 assert.ok(dims&&dims.width>1000&&dims.height>600,'Full-width graph fills the remaining viewport '+JSON.stringify(dims));
 assert.equal(await page.locator('.graph-inspector').count(),0,'No permanent sidebar');
 assert.equal(await page.getByRole('complementary',{name:'文稿列表',exact:true}).count(),0,'Document panel opens on demand');
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')?._cyreg?.cy?.nodes().length>=4);
 const geometry=()=>page.evaluate(()=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy;
  return {same:cy===window.graphRegressionCy,zoom:cy.zoom(),pan:cy.pan(),positions:cy.nodes().map(node=>({id:node.id(),position:node.position()})).sort((a,b)=>a.id.localeCompare(b.id))};
 });
 await page.evaluate(id=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy;window.graphRegressionCy=cy;
  const position=cy.$id(id).position();cy.zoom(.9);cy.pan({x:cy.width()*.3-position.x*.9,y:cy.height()*.45-position.y*.9});
 },A.id);
 const before=await geometry();
 await page.getByRole('button',{name:'文稿列表',exact:true}).click();
 step('document list opened');
 const documents=page.getByRole('complementary',{name:'文稿列表',exact:true});await visible(documents);
 await visible(documents.getByRole('button',{name:A.name,exact:true}));
 const opened=await canvas.boundingBox();
 assert.equal(opened.width,dims.width,'Floating panel does not narrow the graph');
 assert.deepEqual(await geometry(),before,'Opening a panel preserves graph instance, node positions, zoom and pan');
 const point=await page.evaluate(id=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id).renderedPosition(),A.id);
 await page.mouse.click(opened.x+point.x,opened.y+point.y);
 step('canvas node selected');
 const detail=id=>page.locator('[data-workspace-panel="graph-node-'+id+'"]:not([data-closing])');
 await visible(detail(A.id));
 assert.deepEqual(await geometry(),before,'Selecting an unobscured node does not move the graph');
 assert.ok(await detail(A.id).getByText('Markdown 文档',{exact:true}).count(),'Existing metadata renders immediately');
 await detail(A.id).getByRole('button',{name:new RegExp('^'+C.name)}).click();
 step('neighbor opened');
 await visible(detail(C.id));
 assert.equal(await page.locator('.workspace-panel:not([data-closing])').count(),3,'Different nodes have independent stacked panels');
 step('reactivate existing node');
 await page.evaluate(id=>{document.querySelector('.knowledge-graph-canvas')._cyreg.cy.$id(id).emit('tap');},A.id);
 step('existing node activated');
 await visible(detail(A.id));
 assert.equal(await page.locator('[data-workspace-panel^="graph-node-"]:not([data-closing])').count(),2,'Reselecting a node reuses its own panel');
 assert.deepEqual((await geometry()).positions,before.positions,'Selection preserves node layout');
 assert.equal((await geometry()).zoom,before.zoom,'Selection preserves zoom');
 step('reveal obscured node');
 // Reactivate a selected node deliberately hidden under the rail: only pan enough
 // to expose it, without changing the graph layout or zoom.
 await page.evaluate(id=>{
  const cy=document.querySelector('.knowledge-graph-canvas')._cyreg.cy,p=cy.$id(id).position();
  cy.pan({x:cy.width()-80-p.x*cy.zoom(),y:cy.height()*.5-p.y*cy.zoom()});cy.$id(id).emit('tap');
 },A.id);
 step('obscured node activated');
 await page.waitForFunction(id=>{
  const host=document.querySelector('.knowledge-graph-canvas'),cy=host._cyreg.cy;
  return host.getBoundingClientRect().left+cy.$id(id).renderedPosition().x<document.querySelector('.workspace-panel-rail').getBoundingClientRect().left-15;
 },A.id);
 await page.screenshot({path:'tmp/knowledge-graph-desktop-'+engine+'.jpg',type:'jpeg',quality:72});
 step('panel cleanup and canvas filters');
 // Close just one card; every other panel remains available.
 await page.evaluate(id=>document.querySelector('[data-workspace-panel="graph-node-'+id+'"]').querySelector('.workspace-panel-actions button:last-child').click(),C.id);
 await detail(C.id).waitFor({state:'detached'});
 await visible(detail(A.id));
 await documents.getByRole('button',{name:'关闭',exact:true}).click();
 await documents.waitFor({state:'detached'});
 await detail(A.id).getByRole('button',{name:'关闭',exact:true}).click();
 await detail(A.id).waitFor({state:'detached'});
 const stable=await geometry();
 await page.getByRole('textbox',{name:'查找图中节点'}).fill('Graph Alpha');
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes('.search-dimmed').length>=3);
 assert.deepEqual(await geometry(),stable,'Search does not reset the viewport or recreate the graph');
 await page.getByRole('textbox',{name:'查找图中节点'}).fill('');
 await page.getByRole('combobox',{name:/显示关联类型/}).click();
 await page.getByRole('option',{name:'同目录',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.edges('.folder').every(edge=>edge.style('display')==='none'));
 assert.deepEqual(await geometry(),stable,'Relationship filtering preserves the viewport and node positions');
 await page.getByRole('checkbox',{name:'语义关联',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.graph-stage').getAttribute('aria-busy')==='false');
 assert.deepEqual(await geometry(),stable,'Semantic refetch reconciles graph data without resetting the canvas');
 const lightColor=await page.evaluate(()=>document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes().first().style('color'));
 step('theme');
 await page.getByRole('button',{name:'主题：跟随系统',exact:true}).click();
 await page.getByRole('button',{name:'主题：浅色',exact:true}).click();
 await page.waitForFunction(color=>document.documentElement.dataset.effectiveTheme==='dark'&&document.querySelector('.knowledge-graph-canvas')._cyreg.cy.nodes().first().style('color')!==color,lightColor);
 assert.deepEqual(await geometry(),stable,'Theme repaint keeps graph instance, layout and viewport intact');
 await page.getByRole('button',{name:'文稿列表',exact:true}).evaluate(async element=>{
  await Promise.all(element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running'&&animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
 });
 await page.screenshot({path:'tmp/knowledge-graph-dark-'+engine+'.jpg',type:'jpeg',quality:72});
 await page.getByRole('button',{name:'折叠侧边栏',exact:true}).click();
 await page.getByRole('button',{name:'返回概览',exact:true}).click({trial:true});
 assert.ok(await page.locator('.graph-page-heading').evaluate(element=>element.getBoundingClientRect().top>=46),'Collapsed navigation does not cover the graph header');
 await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();
 await page.getByRole('button',{name:'适应视图'}).click();
 await page.getByRole('button',{name:'放大'}).click();
 await page.getByRole('button',{name:'缩小'}).click();
 await page.getByRole('button',{name:'返回概览'}).click();
 await page.waitForURL(base+'/graph',{timeout:12000});
 await page.getByRole('textbox',{name:'查找图中节点'}).fill('Graph Alpha');
 await page.getByRole('button',{name:'文稿列表',exact:true}).click();
 await visible(page.locator('.graph-node-list').getByText(A.name,{exact:true}));
 await page.locator('.graph-node-list').getByText(A.name,{exact:true}).click();
 await visible(detail(A.id).getByRole('link',{name:'打开文档'}));
 await detail(A.id).getByRole('button',{name:'管理关联',exact:true}).click();
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
 await page.screenshot({path:'tmp/knowledge-graph-mobile-'+engine+'.png'});
 await page.getByRole('button',{name:'文稿列表',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'文稿列表',exact:true});await visible(sheet);
 await sheet.getByRole('button',{name:A.name,exact:true}).click();
 const mobileDetail=page.getByRole('dialog',{name:'节点详情：'+A.name,exact:true});await visible(mobileDetail);
 await visible(mobileDetail.getByRole('link',{name:'打开文档'}));
 // Trial interaction waits for the sheet's moving ancestor to settle before
 // capturing it; unrelated background animations may keep running indefinitely.
 await mobileDetail.getByRole('button',{name:'关闭',exact:true}).click({trial:true});
 await page.screenshot({path:'tmp/knowledge-graph-mobile-detail-'+engine+'.png'});
 await mobileDetail.getByRole('button',{name:'关闭',exact:true}).click();
 await mobileDetail.waitFor({state:'hidden'});
 await page.waitForFunction(()=>!document.querySelector('.workspace-panel-sheet'));
 assert.deepEqual(errors,[],'no browser runtime failures');

 console.log('PASS knowledge graph ('+engine+'): links, semantic fallback, full viewport canvas, stable instance/positions/pan/zoom, filters, independent stacked panels, node reveal, UI link creation/removal, archive, mobile sheet and navigation');
}catch(error){await page.screenshot({path:'tmp/knowledge-graph-failure-'+engine+'.png',timeout:3000}).catch(()=>{});throw error;}
finally{clearTimeout(watchdog);await browser.close()}
