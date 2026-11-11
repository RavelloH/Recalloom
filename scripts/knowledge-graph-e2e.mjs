/** Isolated E2E test for D1 links, semantic fallback and Cytoscape workspace.
 * Run only on an isolated local Wrangler D1/KV fixture (default :8897).
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';

const bin=[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x));
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
const secret=process.env.RECALLOOM_TEST_SECRET||line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(bin&&secret);
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:/,'never run destructive fixtures on remote or production');
const browser=await chromium.launch({headless:true,executablePath:bin});
const page=await browser.newPage({viewport:{width:1440,height:900}});
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
 await visible(page.getByRole('heading',{name:'知识关系网'}));
 await visible(page.getByRole('img',{name:/交互式文档关系图/}));
 const graphLayout=await page.locator('.graph-workspace').evaluate(el=>({display:getComputedStyle(el).display,columns:getComputedStyle(el).gridTemplateColumns}));
 assert.equal(graphLayout.display,'grid','On-demand graph CSS must apply to the graph workspace');
 assert.ok(cssRequests.some(path=>path.includes('/knowledge-graph-')),'Graph route must request its own CSS asset');
 const canvas=page.locator('.knowledge-graph-canvas');
 const dims=await canvas.boundingBox();
 assert.ok(dims&&dims.width>400&&dims.height>200,'graph canvas occupies usable area '+JSON.stringify(dims));
 await visible(page.locator('.graph-node-list').getByText(A.name,{exact:true}));
 await page.screenshot({path:'tmp/knowledge-graph-desktop.jpg',type:'jpeg',quality:72});
 await page.getByRole('button',{name:'适应视图'}).click();
 await page.getByRole('button',{name:'放大'}).click();
 await page.getByRole('button',{name:'缩小'}).click();
 await page.getByRole('button',{name:'返回概览'}).click();
 await page.waitForURL(base+'/graph',{timeout:12000});
 await page.getByRole('textbox',{name:'查找图中节点'}).fill('Graph Alpha');
 await visible(page.locator('.graph-node-list').getByText(A.name,{exact:true}));
 await page.locator('.graph-node-list').getByText(A.name,{exact:true}).click();
 await visible(page.getByRole('link',{name:'打开文档'}));

 // Direct inspector: actual incoming/outgoing links, then a new outgoing link.
 await page.goto(base+'/records/'+A.id,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'详情与关联'}).click();
 const inspector=page.getByRole('region',{name:'文档关联'});
 await visible(inspector);
 await visible(inspector.getByText(B.name,{exact:true}));
 await visible(inspector.getByText(C.name,{exact:true}));
 const relationLayout=await inspector.evaluate(el=>({display:getComputedStyle(el).display,gap:getComputedStyle(el).rowGap}));
 assert.equal(relationLayout.display,'grid','Record relation styles must load with its component');
 assert.equal(relationLayout.gap,'13px','Record relation spacing must remain intact');
 // A references B, but another relation type to B must still be possible.
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

 await page.setViewportSize({width:390,height:844});
 await page.goto(base+'/graph?focus='+A.id,{waitUntil:'networkidle'});
 await visible(page.getByRole('heading',{name:'知识关系网'}));
 const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
  canvas:Math.round(document.querySelector('.knowledge-graph-canvas')?.getBoundingClientRect().width??0)}));
 assert.ok(mobile.canvas>=280&&mobile.canvas<=390,'mobile graph canvas fits '+JSON.stringify(mobile));
 assert.ok(mobile.scrollWidth<=mobile.width+1,'mobile graph page must not overflow '+JSON.stringify(mobile));
 await page.screenshot({path:'tmp/knowledge-graph-mobile.png'});
 assert.deepEqual(errors,[],'no browser runtime failures');

 console.log('PASS knowledge graph: two-way D1 links, semantic fallback, focused/global graphs, Cytoscape canvas, zoom, selection, UI link creation/removal, archive, 390px');
}finally{await browser.close()}
