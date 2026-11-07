import assert from 'node:assert/strict';
import {launchTestBrowser,testOrigin} from './local-browser.mjs';
import {readFileSync} from 'node:fs';
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
const secret=line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const base=testOrigin;
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Wiki fixtures must never mutate production');
const browser=await launchTestBrowser();
const page=await browser.newPage({viewport:{width:1400,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=async(path,method='GET',payload)=>page.evaluate(async({path,method,payload})=>{
 const response=await fetch('/api'+path,{method,headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});
 return {status:response.status,data:await response.json().catch(()=>({}))};
},{path,method,payload});
const ok=(response,status,label)=>{assert.equal(response.status,status,label+' '+JSON.stringify(response.data).slice(0,800));return response.data};
const wait=locator=>locator.waitFor({state:'visible',timeout:15000});
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const suffix=String(Date.now());
 const parent=ok(await api('/folders','POST',{name:'Wiki E2E '+suffix}),201,'create folder');
 // Resolve a forward path reference atomically when the missing target is later created.
 const futurePath='/Wiki E2E '+suffix+'/Future.md';
 const waiting=ok(await api('/records','POST',{name:'Waiting.md',folderId:parent.id,kind:'document',
  content:'Waiting for [['+futurePath+']]'}),201,'create forward reference');
 let pending=ok(await api('/records/'+waiting.id+'/wiki-references'),200,'missing path before target creation');
 assert.equal(pending.items.length,1);
 assert.equal(pending.items[0].targetId,null);
 const future=ok(await api('/records','POST',{name:'Future.md',folderId:parent.id,kind:'document',
  content:'# Future document'}),201,'create forward target');
 pending=ok(await api('/records/'+waiting.id+'/wiki-references'),200,'resolved path after target creation');
 assert.equal(pending.items[0].targetId,future.id);
 assert.equal(pending.items[0].resolutionStatus,'resolved');
 const futureInverse=ok(await api('/records/'+future.id+'/relations?semantic=false'),200,'forward backlink');
 assert.ok(futureInverse.links.some(x=>x.other.id===waiting.id&&x.direction==='incoming'));
 ok(await api('/records/'+future.id+'/meta','PATCH',{name:'Future-renamed.md',expectedMetadataRevision:1}),200,'rename forward target');
 ok(await api('/records','POST',{name:'Future.md',folderId:parent.id,kind:'document',content:'Replacement'}),201,'replace forward path');
 const immutable=ok(await api('/wiki/resolve?'+new URLSearchParams({target:futurePath,sourceId:waiting.id})),200,'forward pin remains original');
 assert.equal(immutable.targetId,future.id);
 const target=ok(await api('/records','POST',{name:'Target.md',kind:'document',folderId:parent.id,
  content:'# Target\n\nThis is reused knowledge.\n\n## Section\n\nThis is only section content.'}),201,'create target');
 const targetPath='/Wiki E2E '+suffix+'/Target.md';
 const linkA='[[id:'+target.id+']]';
 const linkPath='[['+targetPath+'|Stable Path Label]]';
 const embed='{{embed:id:'+target.id+'#Section}}';
 const anchored='[[id:'+target.id+'#Section|See section]]';
 const tick=String.fromCharCode(96);
 const document=['# Wiki Source','','Ref '+linkA+' and '+linkPath+' and '+anchored+'.',
  '',tick+linkA+tick+' must not count.','',embed,'','[[Only A Name]] remains literal.'].join('\n');
 const source=ok(await api('/records','POST',{name:'Source.md',folderId:parent.id,kind:'document',content:document}),201,'create wiki source');
 let refs=ok(await api('/records/'+source.id+'/wiki-references'),200,'initial references');
 assert.equal(refs.items.length,4,JSON.stringify(refs));
 assert.ok(refs.items.every(x=>x.targetId===target.id&&x.resolutionStatus==='resolved'));
 assert.equal(refs.items.filter(x=>x.kind==='embed').length,1);
 let relations=ok(await api('/records/'+source.id+'/relations?semantic=false'),200,'outgoing refs');
 assert.ok(relations.links.some(x=>x.type==='reference'&&x.other.id===target.id));
 assert.ok(relations.links.some(x=>x.type==='embed'&&x.other.id===target.id));
 const inverse=ok(await api('/records/'+target.id+'/relations?semantic=false'),200,'auto backlink');
 assert.ok(inverse.links.some(x=>x.other.id===source.id&&x.direction==='incoming'));
 const graph=ok(await api('/graph?focusId='+source.id+'&semantic=false'),200,'wiki graph');
 assert.ok(graph.edges.some(x=>x.type==='reference'));
 assert.ok(graph.edges.some(x=>x.type==='embed'));

 await page.goto(base+'/records/'+source.id+'?mode=visual',{waitUntil:'networkidle'});
 await wait(page.locator('.tiptap'));
 await wait(page.locator('.tiptap .wiki-link').first());
 await wait(page.locator('.wiki-embed'));
 await wait(page.getByText('This is only section content.',{exact:false}).first());
 assert.equal(await page.locator('.wiki-link').count(),3,'three actual wiki links');
 const sectionHref=await page.locator('.wiki-link').filter({hasText:'See section'}).getAttribute('href');
 assert.equal(sectionHref,'/records/'+target.id+'#user-content-section','anchor resolves to stable DOM id');
 assert.ok(!await page.locator('.tiptap').getByText('This is reused knowledge.',{exact:false}).count(),'only the section is embedded');
 await page.screenshot({path:'tmp/wiki-preview.png'});
 const geometry=await page.locator('.wiki-embed').first().evaluate(el=>{
  const inner=el.querySelector('.wiki-embed-body'),article=inner?.querySelector('.markdown-preview');
  return Object.fromEntries([el,inner,article].filter(Boolean).map((item,i)=>{
   const s=getComputedStyle(item);return [i===0?'embed':i===1?'body':'article',{
    height:item.getBoundingClientRect().height,minHeight:s.minHeight,padding:s.padding,display:s.display
   }];
  }));
 });
 console.log('WIKI_GEOMETRY',JSON.stringify(geometry));
 console.log('WIKI_PREVIEW',JSON.stringify({links:await page.locator('.wiki-link').count(),embed:await page.locator('.wiki-embed').count()}));

 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap').waitFor();
 await page.waitForTimeout(450);
 const visual=await page.evaluate(()=>({
  wikiInline:document.querySelectorAll('.wiki-editor-chip').length,
  wikiEmbed:document.querySelectorAll('.wiki-editor-embed').length,
  raw:document.querySelectorAll('.raw-markdown-node').length,
  embeds:[...document.querySelectorAll('.wiki-editor-embed')].map(e=>({text:e.textContent?.slice(0,180),
   attrs:e.pmViewDesc?.node?.attrs??e.parentElement?.pmViewDesc?.node?.attrs,
   anchor:e.querySelector('a')?.getAttribute('href'),outer:e.outerHTML.slice(0,130)})),
  text:document.querySelector('.tiptap')?.innerText?.slice(0,500)
 }));
 console.log('WIKI_VISUAL',JSON.stringify(visual));
 assert.equal(visual.wikiInline,3,'visual editor must display all three WikiLink atoms');
 assert.equal(visual.wikiEmbed,1,'visual editor must not create phantom embedded nodes');
 await page.screenshot({path:'tmp/wiki-visual.png'});

 ok(await api('/records/'+target.id+'/meta','PATCH',{name:'Renamed.md',expectedMetadataRevision:1}),200,'rename target');
 const replacement=ok(await api('/records','POST',{name:'Target.md',folderId:parent.id,kind:'document',content:'# Replacement'}),201,'replace old path');
 const pinned=ok(await api('/wiki/resolve?'+new URLSearchParams({target:targetPath,sourceId:source.id}).toString()),200,'path remains pinned');
 assert.equal(pinned.targetId,target.id);
 assert.equal(pinned.status,'path_changed');
 ok(await api('/records/'+source.id+'/content','PATCH',{expectedRevision:1,content:'Revised '+linkPath}),200,'edit source');
 refs=ok(await api('/records/'+source.id+'/wiki-references'),200,'reindexed refs');
 assert.equal(refs.items.length,1);
 assert.equal(refs.items[0].targetId,target.id,'binding remains stable');
 assert.notEqual(refs.items[0].targetId,replacement.id);
 // Even removing every reference must not release a previously pinned path.
 ok(await api('/records/'+source.id+'/content','PATCH',{expectedRevision:2,content:'All references temporarily removed.'}),200,'remove all references');
 const emptyRefs=ok(await api('/records/'+source.id+'/wiki-references'),200,'empty current projection');
 assert.equal(emptyRefs.items.length,0);
 const savedPin=ok(await api('/wiki/resolve?'+new URLSearchParams({target:targetPath,sourceId:source.id}).toString()),200,'retained historical binding');
 assert.equal(savedPin.targetId,target.id,'historical binding must outlive current text');
 const rollback=ok(await api('/records/'+source.id+'/restore','POST',{targetRevision:1,expectedRevision:3}),200,'restore original');
 assert.equal(rollback.revision,4);
 refs=ok(await api('/records/'+source.id+'/wiki-references'),200,'restored references');
 assert.equal(refs.items.length,4);
 assert.ok(refs.items.every(x=>x.targetId===target.id));
 assert.equal(refs.items.filter(x=>x.kind==='embed').length,1);
 assert.equal(ok(await api('/records/'+source.id),200,'final source').content,document);
 // Actual visual-mode edit must not duplicate or drop wiki syntax on serialization.
 await page.goto(base+'/records/'+source.id+'?mode=visual',{waitUntil:'networkidle'});
 const rich=page.locator('.tiptap');await wait(rich);await rich.click();
 await page.keyboard.press('Control+End');await page.keyboard.press('Enter');
 await page.keyboard.type('Visual edit fidelity marker.');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  return r.ok&&(await r.json()).content.includes('Visual edit fidelity marker.');
 },source.id,{timeout:15000});
 const edited=ok(await api('/records/'+source.id),200,'visual edit preserves wiki syntax');
 assert.ok(edited.content.includes(linkA)&&edited.content.includes(linkPath)&&edited.content.includes(anchored));
 assert.equal(edited.content.split(embed).length-1,1,'exactly one embed survives serialization');
 const editedRefs=ok(await api('/records/'+source.id+'/wiki-references'),200,'visual serialization projection');
 assert.equal(editedRefs.items.length,4);

 await page.goto(base+'/records/'+target.id+'?mode=visual',{waitUntil:'networkidle'});
 await page.locator('h2#user-content-section').waitFor();
 await page.getByRole('button',{name:'可视化'}).click();
 await page.locator('.tiptap h2#user-content-section').waitFor();
 const draft=ok(await api('/records','POST',{name:'Picker.md',folderId:parent.id,kind:'document',content:''}),201,'picker fixture');
 await page.goto(base+'/records/'+draft.id+'?mode=visual',{waitUntil:'networkidle'});
 const editor=page.locator('.tiptap');
 await wait(editor);
 await editor.click();
 await page.keyboard.type('See [['+'Renamed');
 await wait(page.getByRole('listbox',{name:'引用文档'}));
 await wait(page.getByRole('option',{name:/Renamed.md/}).first());
 await page.getByRole('option',{name:/Renamed.md/}).first().click();
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);return r.ok&&(await r.json()).content.includes('[[id:');
 },draft.id,{timeout:15000});
 const saved=ok(await api('/records/'+draft.id),200,'picker saved');
 assert.ok(saved.content.includes('[[id:'+target.id+']]'));
 // The block picker must insert a read-only embed node, not a plain-text placeholder.
 const embedDraft=ok(await api('/records','POST',{name:'Embed-Picker.md',folderId:parent.id,
  kind:'document',content:''}),201,'create embed picker fixture');
 await page.goto(base+'/records/'+embedDraft.id+'?mode=visual',{waitUntil:'networkidle'});
 await wait(page.locator('.tiptap'));
 await page.locator('.tiptap').click();
 await page.keyboard.type('{{embed:Renamed');
 await wait(page.getByRole('listbox',{name:'引用文档'}));
 await wait(page.getByRole('option',{name:/Renamed.md/}).first());
 await page.getByRole('option',{name:/Renamed.md/}).first().click();
 await wait(page.locator('.wiki-editor-embed'));
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  return r.ok&&(await r.json()).content.includes('{{embed:id:');
 },embedDraft.id,{timeout:15000});
 const embeddedSaved=ok(await api('/records/'+embedDraft.id),200,'embedded picker saved');
 assert.ok(embeddedSaved.content.includes('{{embed:id:'+target.id+'}}'));
 const embedIndex=ok(await api('/records/'+embedDraft.id+'/wiki-references'),200,'embedded picker indexes an embed');
 assert.equal(embedIndex.items.length,1);
 assert.equal(embedIndex.items[0].kind,'embed');

 // A->B->A must render a clear terminal warning rather than recurse forever.
 const cycleA=ok(await api('/records','POST',{name:'Cycle-A.md',folderId:parent.id,kind:'document',content:'# A'}),201,'create cycle A');
 const cycleB=ok(await api('/records','POST',{name:'Cycle-B.md',folderId:parent.id,kind:'document',content:'{{embed:id:'+cycleA.id+'}}'}),201,'create cycle B');
 ok(await api('/records/'+cycleA.id+'/content','PATCH',{expectedRevision:1,content:'{{embed:id:'+cycleB.id+'}}'}),200,'create A-B-A cycle');
 await page.goto(base+'/records/'+cycleA.id+'?mode=visual',{waitUntil:'networkidle'});
 await wait(page.getByText('检测到循环嵌入，已停止递归。'));
 assert.ok(await page.locator('.wiki-embed').count()<=3,'cycle does not mount infinite embed subtree');
 // A->B->C->D->E hits the explicit nesting budget.
 const chain=[];
 for(let i=0;i<5;i++)chain.push(ok(await api('/records','POST',{
  name:'Depth-'+i+'.md',folderId:parent.id,kind:'document',content:'# Depth '+i}),201,'create deep embed'));
 for(let i=3;i>=0;i--)ok(await api('/records/'+chain[i].id+'/content','PATCH',{
  expectedRevision:1,content:'{{embed:id:'+chain[i+1].id+'}}'}),200,'link deep embed');
 await page.goto(base+'/records/'+chain[0].id+'?mode=visual',{waitUntil:'networkidle'});
 await wait(page.getByText('嵌入层级已达上限，请打开源文档查看。'));
 assert.ok(await page.locator('.wiki-embed').count()<=4,'nested transclusions are bounded');
 const indexed=ok(await api('/wiki/reindex','POST',{limit:8}),200,'bounded legacy backfill');
 assert.ok(indexed.scanned>=0&&indexed.scanned<=8);
 assert.ok(typeof indexed.inserted==='number');
 await page.goto(base+'/settings/indexing',{waitUntil:'networkidle'});
 await wait(page.getByText('Wiki 引用索引',{exact:true}));
 await wait(page.getByRole('button',{name:'扫描旧文档'}));
 await page.setViewportSize({width:390,height:844});
 await page.goto(base+'/records/'+source.id+'?mode=visual',{waitUntil:'networkidle'});
 await wait(page.locator('.wiki-embed'));
 const sizes=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(sizes.scroll<=sizes.viewport+1,JSON.stringify(sizes));
 assert.deepEqual(errors,[],'no uncaught browser errors');
 console.log('PASS Wiki: AST, atomic projection, backlinks/graph, section embed, visual atoms, path rename safety, restore, picker, mobile');
}finally{await browser.close()}
