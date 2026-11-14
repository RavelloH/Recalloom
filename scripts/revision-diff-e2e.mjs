import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright-core';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/,'Only the temporary local Worker is permitted');
const engine=(process.env.RECALLOOM_E2E_BROWSER??process.env.RECALLOOM_TEST_ENGINE)==='webkit'?'webkit':'chromium';
const executable=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path)):undefined;
const secretLine=readFileSync(join(root,'.dev.vars'),'utf8').split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=process.env.RECALLOOM_TEST_SECRET||secretLine?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g,'');
assert.ok(secret,'A local MCP_AUTH_SECRET is required');

const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(executable?{executablePath:executable}:{})});
const context=await browser.newContext({viewport:{width:1365,height:900}});
const page=await context.newPage();
// Windows WebKit exits when native dialogs close during viewport-height changes.
// Keep its phone-width checks at a fixed height; Chromium uses real phone heights.
const mobileHeight=engine==='webkit'?900:844;
const narrowHeight=engine==='webkit'?900:740;
page.setDefaultTimeout(25000);
const faults=[];
page.on('pageerror',error=>faults.push(error.message));

let sessionCookie='';
let recordId=null;
let allowRevisionOneRetry=false;
let revisionOneRetrySeen=false;
let failedRevisionOneResolve=()=>{};
let retriedRevisionOneResolve=()=>{};
const failedRevisionOne=new Promise(resolve=>{failedRevisionOneResolve=resolve;});
const retriedRevisionOne=new Promise(resolve=>{retriedRevisionOneResolve=resolve;});
const requestedRevisions=new Set();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Keep the WebKit cookie bridge and the revision failure fixture in one
// handler so route ordering cannot bypass the auth cookie on loopback HTTP.
await page.route('**/api/**',async route=>{
 const request=route.request();
 const url=new URL(request.url());
 if(url.pathname.includes('/api/wiki/resolve')||url.pathname.startsWith('/api/records/'+embeddedTargetId))
  forbiddenEmbedRequests.push({method:request.method(),path:url.pathname});
 if(recordId&&url.pathname==='/api/records/'+recordId&&url.searchParams.has('revision')){
  const revision=url.searchParams.get('revision');
  requestedRevisions.add(revision);
  if(revision==='1'){
   if(!allowRevisionOneRetry){
    failedRevisionOneResolve();
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary revision read failure'})});
    return;
   }
   if(!revisionOneRetrySeen){
    revisionOneRetrySeen=true;
    retriedRevisionOneResolve();
    await wait(550);
   }
  }
 }

 if(engine==='webkit'&&url.pathname==='/api/auth/login'){
  const response=await route.fetch();
  sessionCookie=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});
  return;
 }
 if(engine==='webkit'&&sessionCookie){
  await route.fulfill({response:await route.fetch({headers:{...(await request.allHeaders()),cookie:sessionCookie}})});
  return;
 }
 await route.continue();
});

const stableSections=Array.from({length:42},(_,index)=>[
 '### Stable section '+String(index+1).padStart(2,'0'),
 '',
 'This unchanged section checks incremental loading in the comparison view.'
].join('\n'));
const embeddedTargetId='00000000-0000-4000-8000-000000000001';
const forbiddenEmbedRequests=[];
const makeContent=({title,phrase,tableValue,codeValue,equation})=>[
 '# '+title,
 '',
 'The stable sentence contains the '+phrase+' and ends with the same words.',
 '',
 '| Item | Value |',
 '| --- | --- |',
 '| Alpha | '+tableValue+' |',
 '| Beta | Stable |',
 '',
 '```ts',
 'const status = "'+codeValue+'";',
 '```',
 '',
 '$$',
 equation,
 '$$',
 '',
 '::: warning Read carefully',
 '',
 'The callout body remains available in both revisions.',
 '',
 ':::',
 '',
 'See [the source guide][source-guide] and footnote[^note].',
 '',
 '[source-guide]: https://example.org/guide "Source guide"',
 '',
 '[^note]: The reference footnote remains attached.',
 '',
 ...stableSections,
 '',
 '::: embed id:'+embeddedTargetId+' :::',
 ''
].join('\n');
const revisionOne=makeContent({title:'Revision One',phrase:'old beacon',tableValue:'Former value',codeValue:'draft',equation:'x^2 + y^2 = 1'});
const revisionTwo=makeContent({title:'Revision Two',phrase:'new beacon',tableValue:'Updated value',codeValue:'published',equation:'x^3 + y^2 = 1'});
const revisionThree=revisionTwo.replace('Updated value','Remote value').replace('published','remote');
const localDraft=revisionTwo.replace('new beacon','new beacon LOCAL_DRAFT');
const screenshotDir=join(root,'tmp','revision-diff-'+Date.now());
mkdirSync(screenshotDir,{recursive:true});

const createRecord=content=>page.evaluate(async content=>{
 const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({name:'Revision comparison '+Date.now()+'.md',kind:'document',content})});
 if(!response.ok)throw Error('Cannot create revision comparison fixture: '+await response.text());
 return response.json();
},content);
const updateRecord=(id,revision,content)=>page.evaluate(async({id,revision,content})=>{
 const response=await fetch('/api/records/'+id+'/content',{method:'PATCH',headers:{'content-type':'application/json'},
  body:JSON.stringify({expectedRevision:revision,content,message:'Revision comparison fixture'})});
 if(!response.ok)throw Error('Cannot create fixture revision: '+await response.text());
 return response.json();
},{id,revision,content});
const sourceValue=()=>page.locator('.editor-section .cm-content').evaluate(element=>
 element.cmTile?.root?.view?.state?.doc?.toString()??element.textContent??''
);

try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');

 const record=await createRecord(revisionOne);
 recordId=record.id;
 await updateRecord(record.id,1,revisionTwo);
 assert.equal((await page.evaluate(async id=>{
  const response=await fetch('/api/records/'+id);
  if(!response.ok)throw Error('Cannot verify fixture head');
  return response.json();
 },record.id)).revision,2);

 await page.goto(base+'/records/'+record.id+'?mode=source');
 const editorSource=page.locator('.editor-section .cm-content');
 await editorSource.waitFor();
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.getAttribute('data-base-revision')==='2');
 await editorSource.fill(localDraft);
 await page.locator('.save-status').getByText('未保存').waitFor();
 assert.ok((await sourceValue()).includes('LOCAL_DRAFT'));

 await page.getByRole('button',{name:'历史',exact:true}).click();
 const inspector=page.locator('#document-panel-history');
 await inspector.waitFor();
 const inspectorHostTag=await inspector.evaluate(element=>element.tagName);
 assert.notEqual(inspectorHostTag,'DIALOG','Desktop history must use a docked panel');
 assert.equal(await inspector.getAttribute('role'),'complementary');
 await inspector.getByRole('heading',{name:'历史',exact:true}).waitFor();
 await inspector.getByText('Revision 1').waitFor();
 const revisionRow=inspector.locator('.history-row').filter({hasText:'Revision 1'});
 await revisionRow.getByRole('button',{name:'比较',exact:true}).click();

 const dialog=page.getByRole('dialog',{name:'版本对比'});
 await dialog.waitFor();
 await dialog.evaluate(element=>{window.__revisionComparisonHost=element;});
 await Promise.race([failedRevisionOne,wait(8000).then(()=>{throw Error('Revision R1 request was not made');})]);
 const retry=dialog.getByRole('button',{name:/重试/});
 await retry.waitFor();
 assert.equal(await dialog.locator('.revision-diff-block').count(),0,'Failed reads must not render a partial comparison');
 allowRevisionOneRetry=true;
 await retry.click();
 await Promise.race([retriedRevisionOne,wait(8000).then(()=>{throw Error('Revision R1 retry was not made');})]);
 await wait(100);
 assert.equal(await dialog.locator('.revision-diff-block').count(),0,'Delayed retry must keep comparison blocks unloaded');
 await dialog.locator('.revision-diff-summary').waitFor();
 await dialog.locator('.revision-diff-block').first().waitFor();
 const summary=await dialog.locator('.revision-diff-summary').innerText();
 assert.match(summary,/R1[\s\S]*R2|R2[\s\S]*R1/,'The selected comparison must stay pinned to R1 and R2');
 assert.ok(requestedRevisions.has('1'),'R1 must be fetched by revision');
 assert.ok(requestedRevisions.has('2'),'R2 must be fetched by revision');
 assert.equal(await dialog.locator('[contenteditable="true"],textarea,input,select').count(),0,
  'Comparison content must be read-only');

 const kinds=await dialog.locator('.revision-diff-block').evaluateAll(blocks=>
  [...new Set(blocks.map(block=>block.getAttribute('data-kind')))]
 );
 for(const kind of ['removed','added','unchanged'])assert.ok(kinds.includes(kind),'Missing preview block kind '+kind);
 const markedWords=(await dialog.locator('.rk-revision-word').allInnerTexts()).join(' ');
 assert.match(markedWords,/\bold\b/i,'Preview should mark the removed local wording');
 assert.match(markedWords,/\bnew\b/i,'Preview should mark the added local wording');
 assert.ok(await dialog.locator('.revision-diff-block table').count()>0,'Preview must retain GFM table structure');
 assert.ok(await dialog.locator('.revision-diff-block pre code').count()>0,'Preview must retain fenced code structure');
 assert.ok(await dialog.locator('.revision-diff-block .katex').count()>0,'Preview must render block math');
 const foldedContext=dialog.getByRole('button',{name:/展开.*段未修改内容/});
 await foldedContext.first().waitFor();
 assert.ok(await foldedContext.count()>0,'Unchanged preview context must be folded by default');
 await foldedContext.first().click();
 const previewText=(await dialog.locator('.revision-diff-block').allInnerTexts()).join('\n');
 for(const text of ['Read carefully','source guide','reference footnote'])
  assert.ok(previewText.toLowerCase().includes(text.toLowerCase()),'Preview is missing '+text);
 assert.ok(await dialog.locator('.revision-diff-block a[href="https://example.org/guide"]').count()>0,
  'Reference links must keep their resolved target');

 const more=dialog.locator('.revision-diff-more');
 await more.waitFor();
 const blocksBefore=await dialog.locator('.revision-diff-block').count();
 await more.getByRole('button').click();
 await page.waitForFunction(before=>document.querySelectorAll('.revision-diff-block').length>before,blocksBefore);
 const blocksAfter=await dialog.locator('.revision-diff-block').count();
 assert.ok(blocksAfter>blocksBefore,'More must add comparison blocks incrementally');
 for(let batch=0;batch<8&&await dialog.locator('.revision-diff-embed').count()===0;batch++){
  const nextMore=dialog.locator('.revision-diff-more');
  assert.ok(await nextMore.count()>0,'Preview pagination ended before the embedded reference was rendered');
  const before=await dialog.locator('.revision-diff-block').count();
  await nextMore.getByRole('button').click();
  await page.waitForFunction(count=>document.querySelectorAll('.revision-diff-block').length>count,before);
 }
 const embeddedPreview=dialog.locator('.revision-diff-embed');
 assert.ok(await embeddedPreview.count()>0,'Embedded reference was not rendered after preview pagination');
 assert.ok((await embeddedPreview.innerText()).includes('此处仅比较嵌入引用。'),
  'Historical embedded documents must render a static reference in comparison preview');
 assert.deepEqual(forbiddenEmbedRequests,[],'Comparison preview must not resolve or fetch embedded records');
 await dialog.getByRole('button',{name:'下一个差异',exact:true}).click();
 await dialog.getByRole('button',{name:'上一个差异',exact:true}).click();
 assert.match(await dialog.locator('.revision-diff-summary').innerText(),/R1[\s\S]*R2|R2[\s\S]*R1/);
 await page.screenshot({path:join(screenshotDir,'revision-diff-desktop.png'),fullPage:true});
 console.log('PASS revision diff loading/retry, pinned summary, preview structure and incremental blocks',engine);

 // A remote head update must not change the already-open R1/R2 comparison.
 await updateRecord(record.id,2,revisionThree);
 await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.getAttribute('data-remote-revision')==='3');
 await dialog.waitFor();
 assert.match(await dialog.locator('.revision-diff-summary').innerText(),/R1[\s\S]*R2|R2[\s\S]*R1/,
  'An open comparison must remain pinned after the record head advances to R3');

 await dialog.getByRole('button',{name:'源码',exact:true}).click();
 const foldedSourceContext=dialog.getByRole('button',{name:/展开.*行未修改内容/});
 await foldedSourceContext.first().waitFor();
 assert.ok(await foldedSourceContext.count()>0,'Unchanged source context must be folded by default');
 await foldedSourceContext.first().click();
 const sourceRows=dialog.locator('.revision-source-row');
 await sourceRows.first().waitFor();
 assert.ok(await dialog.locator('.revision-source-text').count()>0,'Source rows must expose their text cell');
 const sourceKinds=await sourceRows.evaluateAll(rows=>[...new Set(rows.map(row=>row.getAttribute('data-kind')))]);
 for(const kind of ['removed','added','unchanged'])assert.ok(sourceKinds.includes(kind),'Missing source row kind '+kind);
 const oldPhraseRow=sourceRows.filter({hasText:'old beacon'}).first();
 const newPhraseRow=sourceRows.filter({hasText:'new beacon'}).first();
 assert.equal(await oldPhraseRow.count()>0,true,'Source view must retain the old local phrase');
 assert.equal(await newPhraseRow.count()>0,true,'Source view must retain the new local phrase');
 const oldLine=Number((await oldPhraseRow.locator('.revision-source-old-line').innerText()).trim());
 const newLine=Number((await newPhraseRow.locator('.revision-source-new-line').innerText()).trim());
 assert.ok(oldLine>0&&newLine>0,'Source rows must show line numbers for both revisions');
 const sourceDiffText=(await dialog.locator('.revision-source-row').allInnerTexts()).join('\n');
 for(const text of ['| Alpha |','const status','x^','source-guide','[^note]','::: embed id:'+embeddedTargetId+' :::'])
  assert.ok(sourceDiffText.includes(text),'Source comparison is missing '+text);

 const geometry=async()=>dialog.evaluate(element=>{
  const rect=element.getBoundingClientRect();
  return {left:rect.left,right:rect.right,width:rect.width,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,
   viewport:innerWidth,pageWidth:document.documentElement.scrollWidth};
 });
 const sourceMode=dialog.getByRole('button',{name:'源码',exact:true});
 const previewMode=dialog.getByRole('button',{name:'预览',exact:true});
 let showingSource=true;
 for(const width of [390,320]){
  if(!showingSource){await sourceMode.click();showingSource=true;}
  await page.setViewportSize({width,height:mobileHeight});
  await page.waitForTimeout(80);
  const comparisonHostState=await dialog.evaluate(element=>({
   same:element===window.__revisionComparisonHost,connected:element.isConnected,
   tag:element.tagName,open:element.open,modal:element.matches(':modal')
  }));
  assert.deepEqual(comparisonHostState,{same:true,connected:true,tag:'DIALOG',open:true,modal:true},
   'Comparison must retain its native top-layer host across responsive history migration at '+width+'px');
  await dialog.getByRole('button',{name:'下一个差异',exact:true}).click();
  await dialog.getByRole('button',{name:'上一个差异',exact:true}).click();
  let measure=await geometry();
  assert.ok(measure.pageWidth<=measure.viewport+1,'Source comparison page overflow at '+width+': '+JSON.stringify(measure));
  assert.ok(measure.left>=-1&&measure.right<=measure.viewport+1,'Source dialog is outside '+width+'px viewport: '+JSON.stringify(measure));
  assert.ok(measure.scrollWidth<=measure.clientWidth+1,'Source dialog has horizontal overflow at '+width+': '+JSON.stringify(measure));
  await previewMode.click();showingSource=false;
  measure=await geometry();
  assert.ok(measure.pageWidth<=measure.viewport+1,'Preview comparison page overflow at '+width+': '+JSON.stringify(measure));
  assert.ok(measure.left>=-1&&measure.right<=measure.viewport+1,'Preview dialog is outside '+width+'px viewport: '+JSON.stringify(measure));
  assert.ok(measure.scrollWidth<=measure.clientWidth+1,'Preview dialog has horizontal overflow at '+width+': '+JSON.stringify(measure));
  if(width===390)await page.screenshot({path:join(screenshotDir,'revision-diff-mobile-390.png'),fullPage:true});
 }
 await page.emulateMedia({colorScheme:'dark'});
 await page.setViewportSize({width:320,height:narrowHeight});
 await page.waitForFunction(()=>document.documentElement.dataset.effectiveTheme==='dark');
 const darkGeometry=await geometry();
 assert.ok(darkGeometry.pageWidth<=darkGeometry.viewport+1,'Dark 320px page overflow: '+JSON.stringify(darkGeometry));
 assert.ok(darkGeometry.scrollWidth<=darkGeometry.clientWidth+1,'Dark 320px comparison overflow: '+JSON.stringify(darkGeometry));
 await page.screenshot({path:join(screenshotDir,'revision-diff-dark-320.png'),fullPage:true});

 await dialog.getByRole('button',{name:'关闭版本对比',exact:true}).click();
 await dialog.waitFor({state:'hidden'});
 await dialog.locator('.revision-diff-content').waitFor({state:'detached'});
 await inspector.waitFor({state:'visible'});
 assert.ok((await sourceValue()).includes('LOCAL_DRAFT'),'Closing comparison must preserve the unsaved source draft');

 await page.emulateMedia({reducedMotion:'reduce'});
 const revisionOneAgain=inspector.locator('.history-row').filter({hasText:'Revision 1'});
 await revisionOneAgain.getByRole('button',{name:'比较',exact:true}).click();
 await dialog.waitFor({state:'visible'});
 await dialog.locator('.revision-diff-block').first().waitFor();
 assert.match(await dialog.locator('.revision-diff-summary').innerText(),/R1[\s\S]*R3|R3[\s\S]*R1/,
  'A reopened comparison must use the current R3 head');
 await page.keyboard.press('Escape');
 await dialog.waitFor({state:'hidden'});
 await dialog.locator('.revision-diff-content').waitFor({state:'detached'});
 await inspector.waitFor({state:'visible'});
 assert.ok((await sourceValue()).includes('LOCAL_DRAFT'),'Escape must preserve the source draft and inspector');
 await inspector.getByRole('button',{name:'关闭',exact:true}).click();
 await inspector.waitFor({state:'hidden'});
 await page.locator('.editor-section .cm-content').click();
 await page.keyboard.press('Control+z');
 await page.waitForFunction(expected=>{
  const editor=document.querySelector('.editor-section .cm-content');
  const source=editor?.cmTile?.root?.view?.state?.doc?.toString()??editor?.textContent??'';
  return source===expected;
 },revisionTwo);
 assert.deepEqual(faults,[],'Browser runtime errors');
 console.log('PASS source rows, mobile/dark overflow, preserved draft and Undo',engine,'screenshots:',screenshotDir);
}catch(error){
 const failureScreenshot=join(screenshotDir,'failure.png');
 await page.screenshot({path:failureScreenshot,fullPage:true}).catch(()=>undefined);
 const comparisonText=await page.getByRole('dialog',{name:'版本对比'}).innerText().catch(()=>null);
 console.error('Revision comparison scenario failed',JSON.stringify({engine,url:page.url(),requestedRevisions:[...requestedRevisions],faults,
  forbiddenEmbedRequests,screenshotDir,failureScreenshot,comparisonText,
  visible:await page.locator('body').innerText().then(text=>text.slice(0,1600)).catch(()=>null)}));
 throw error;
}finally{
 if(engine==='webkit')await page.unrouteAll({behavior:'ignoreErrors'});
 await context.close();
 await browser.close();
}
