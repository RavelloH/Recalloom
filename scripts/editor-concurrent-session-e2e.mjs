import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE;
assert.match(base??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const engine=process.env.RECALLOOM_TEST_ENGINE==='webkit'?'webkit':'chromium';
const bin=engine==='chromium'?[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(x=>x&&existsSync(x)):undefined;
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
const secret=process.env.RECALLOOM_TEST_SECRET||line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(secret);
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(bin?{executablePath:bin}:{})});
const mobile=process.env.RECALLOOM_TEST_MOBILE==='1';
const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1200,height:850},isMobile:mobile,hasTouch:mobile});
const page=await context.newPage();
page.setDefaultTimeout(25000);
if(engine==='webkit'){
 let cookie='';
 await page.route('**/api/**',async route=>{
  const req=route.request();
  if(req.url().endsWith('/api/auth/login')){
   const result=await route.fetch();
   const match=/^(__Host-recalloom_session=[^;]+)/.exec(result.headers()['set-cookie']??'');
   if(match)cookie=match[1];
   await route.fulfill({response:result});return;
  }
  if(!cookie){await route.continue();return;}
  const response=await route.fetch({headers:{...(await req.allHeaders()),cookie}});
  await route.fulfill({response});
 });
}
const faults=[];page.on('pageerror',error=>faults.push(error.message));
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 const original='# Heading\n\nOriginal paragraph\n';
 const record=await page.evaluate(async content=>{
  const res=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Concurrent editor '+Date.now()+'.md',kind:'document',content})});
  if(!res.ok)throw Error('Create fixture failed '+await res.text());
  return res.json();
 },original);
 await page.goto(base+'/records/'+record.id+'?mode=source');
 const source=page.locator('.cm-content');
 await source.waitFor();
 await page.locator('.save-status').getByText('已保存').waitFor();
 const local='# Heading\n\nLocal unsaved paragraph\n';
 await source.fill(local);
 await page.locator('.save-status').getByText('未保存').waitFor();
 await page.evaluate(()=>{window.__rkSourceDom=document.querySelector('.cm-editor');});
 const remote='# Heading\n\nRemote agent paragraph\n';
 const updateRemote=async(expectedRevision,content)=>page.evaluate(async({id,expectedRevision,content})=>{
  const res=await fetch('/api/records/'+id+'/content',{method:'PATCH',headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedRevision,content,message:'Concurrent agent fixture'})});
  const data=await res.json();if(!res.ok)throw Error('Remote update failed '+JSON.stringify(data));
  return data;
 },{id:record.id,expectedRevision,content});
 await updateRemote(1,remote);
 // React Query should refresh the active record on tab re-focus, without
 // rebuilding its editor or changing the editing baseRevision.
 await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 await page.getByText(/远端.*更新|服务器.*更新/).first().waitFor({timeout:6000});
 assert.match(await source.innerText(),/Local unsaved paragraph/,'local editor contents must survive query refresh');
 assert.doesNotMatch(await source.innerText(),/Remote agent paragraph/,'remote text may not overwrite unsaved editor');
 assert.equal(await page.evaluate(()=>window.__rkSourceDom===document.querySelector('.cm-editor')),true,
  'background R2 must not remount CodeMirror (preserve undo/focus/selection)');
 await page.waitForFunction(()=>{
  const labels=[...document.querySelectorAll('.save-status')];
  return labels.length===1&&labels[0].textContent==='未保存';
 });
 console.log('PASS remote R2 refetch retains active unsaved R1 editor and shows remote notice',engine);
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true,
  'known remote Revision must disable the old-base save action');
 // CAS is still the server-enforced protection even against direct clients.
 const rejected=await page.evaluate(async({id,content})=>{
  const result=await fetch('/api/records/'+id+'/content',{method:'PATCH',headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedRevision:1,content,message:'Stale edit attempt'})});
  return result.status;
 },{id:record.id,content:local});
 assert.equal(rejected,409,'server must reject stale expectedRevision regardless of UI');
 assert.match(await source.innerText(),/Local unsaved paragraph/);
 const actual=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()),record.id);
 assert.equal(actual.revision,2,'R1 client must not overwrite the remote R2');
 assert.equal(actual.content,remote);
 console.log('PASS stale R1 save is blocked in UI and rejected by CAS while retaining both drafts',engine);
 await page.waitForFunction(()=>Object.keys(sessionStorage).some(key=>key.startsWith('recalloom:draft:')));
 await page.getByRole('button',{name:'放弃本地修改并加载新版'}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 assert.match(await source.innerText(),/Local unsaved paragraph/,
  'cancelling a destructive upgrade must retain local content');
 assert.equal(await page.locator('.editor-section').getAttribute('data-base-revision'),'1');
 await page.getByRole('button',{name:'放弃本地修改并加载新版'}).click();
 await page.getByRole('button',{name:'放弃本地修改',exact:true}).click();
 await page.waitForFunction(text=>[...document.querySelectorAll('.cm-line')]
  .map(n=>n.textContent).join('\n').includes(text),'Remote agent paragraph');
 await page.locator('.save-status').getByText('已保存').waitFor();
 assert.equal((await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('recalloom:draft:')))).length,0);
 console.log('PASS explicit confirmation adopts R2 and discards only the chosen local draft',engine);
 await page.evaluate(()=>{window.__rkAdoptedSource=document.querySelector('.cm-editor');});
 const updated='# Heading\n\nRemote agent paragraph\n\nLocal R3 addition\n';
 await source.fill(updated);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.locator('.save-status').getByText('已保存').waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.save-status').length===1);
 assert.equal(await page.evaluate(()=>window.__rkAdoptedSource===document.querySelector('.cm-editor')),true,
  'own accepted save must also preserve CodeMirror and its undo history');
 assert.equal(await page.locator('.editor-body').getAttribute('aria-busy'),'false',
  'saved content and finished busy state must agree after the fade');
 await page.waitForFunction(()=>document.querySelector('.cm-editor')!==null);
 const saved=await page.evaluate(async id=>await(await fetch('/api/records/'+id)).json(),record.id);
 assert.equal(saved.revision,3);
 assert.equal(saved.content,updated);
 console.log('PASS new editor baseline saves R3 after explicit remote adoption',engine);
 const latest='# Heading\n\nRemote agent paragraph\n\nLocal R3 addition\n\nRemote R4\n';
 await updateRemote(3,latest);
 await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 await page.getByText(/远端.*更新|服务器.*更新/).first().waitFor();
 await page.locator('.save-status').getByText('有新版').waitFor();
 await page.getByRole('button',{name:'加载新版',exact:true}).click();
 await page.locator('.save-status').getByText('已保存').waitFor();
 await page.waitForFunction(text=>document.querySelector('.cm-content')?.textContent.includes(text),'Remote R4');
 console.log('PASS a clean editing session can explicitly accept the latest revision',engine);

 // Revision restore no longer relies on RecordEditor being keyed by revision.
 // It must explicitly load the accepted content into the current session.
 await page.getByRole('button',{name:'历史',exact:true}).click();
 const firstRevision=page.locator('.history-row').filter({hasText:'Revision 1'}).first();
 await firstRevision.waitFor();
 await firstRevision.getByRole('button',{name:'恢复',exact:true}).click();
 await page.getByRole('button',{name:'恢复该版本',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.editor-section')?.dataset.baseRevision==='5');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('Original paragraph'));
 const afterRestore=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()),record.id);
 assert.equal(afterRestore.revision,5);
 assert.equal(afterRestore.content,original);
 await page.locator('.save-status').getByText('已保存').waitFor();
 console.log('PASS explicit history restore advances to R5 without losing editor session semantics',engine);
 await page.locator('#document-panel').getByRole('button',{name:'关闭'}).click();
 await page.locator('#document-panel').waitFor({state:'hidden'});

 // Visual (ProseMirror) mode must preserve its instance/undo when R6 arrives.
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 const visual=page.locator('.tiptap');
 await visual.waitFor();
 await visual.locator('p').first().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' LOCAL_VISUAL_R5');
 await page.locator('.save-status').getByText('未保存').waitFor();
 await page.evaluate(()=>{window.__rkVisualBeforeRefresh=document.querySelector('.tiptap');});
 await updateRemote(5,'# Heading\n\nAgent remote R6\n');
 await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
 await page.getByText(/远端.*更新|服务器.*更新/).first().waitFor();
 assert.equal(await page.evaluate(()=>window.__rkVisualBeforeRefresh===document.querySelector('.tiptap')),true,
  'remote R6 must not reconstruct the active ProseMirror editor');
 assert.match(await visual.innerText(),/LOCAL_VISUAL_R5/);
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>!document.querySelector('.tiptap')?.textContent?.includes('LOCAL_VISUAL_R5'));
 await page.keyboard.press('Control+Shift+z');
 await page.waitForFunction(()=>document.querySelector('.tiptap')?.textContent?.includes('LOCAL_VISUAL_R5'));
 console.log('PASS visual editor preserves DOM, live draft and undo/redo history across remote R6',engine);
 await page.waitForFunction(()=>Object.keys(sessionStorage).some(key=>key.startsWith('recalloom:draft:')));
 await page.reload();
 await page.getByText('发现旧版本的未保存草稿').waitFor();
 assert.doesNotMatch(await page.locator('.tiptap').innerText(),/LOCAL_VISUAL_R5/,
  'stale R5 draft must never silently replace remote R6 on reload');
 const finalRemote=await page.evaluate(async id=>(await(await fetch('/api/records/'+id)).json()),record.id);
 assert.equal(finalRemote.revision,6);
 assert.equal(finalRemote.content,'# Heading\n\nAgent remote R6\n');
 console.log('PASS stale session draft survives reload as an explicit recovery choice without overwriting R6',engine);
 assert.deepEqual(faults,[]);
}finally{
 if(engine==='webkit')await page.unrouteAll({behavior:'ignoreErrors'});
 await context.close();
 await browser.close();
}
