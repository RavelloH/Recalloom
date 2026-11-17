import {readLocalAuthVars} from './local-auth-config.mjs';
/** Destructive lifecycle regression on an ISOLATED local Wrangler D1/KV instance.
 * Never run this against production.
 */
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright-core';
import {existsSync,mkdirSync} from 'node:fs';
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readLocalAuthVars().split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(executablePath&&line,'local browser and .dev.vars are needed');
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Destructive lifecycle tests must only use a loopback Worker');
const browser=process.env.RECALLOOM_TEST_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath});
const page=await browser.newPage({viewport:{width:1360,height:860}});
page.on('pageerror',error=>console.log('Browser error:',error.message));
page.on('crash',()=>console.log('Browser target crashed'));
// WebKit does not send Secure cookies over plain HTTP loopback. Preserve the
// real login token only in this disposable local test transport.
if(process.env.RECALLOOM_TEST_BROWSER==='webkit'){
 let session='';
 await page.route('**/api/**',async route=>{
  const request=route.request();
  const response=await route.fetch(session?{headers:{...await request.allHeaders(),cookie:session}}:undefined);
  if(new URL(request.url()).pathname==='/api/auth/login')session=/^(__Host-recalloom_session=[^;]+)/.exec(response.headers()['set-cookie']??'')?.[1]??'';
  await route.fulfill({response});
 });
}
async function api(path,method='GET',value){
 return page.evaluate(async({path,method,value})=>{
  const r=await fetch('/api'+path,{method,headers:value===undefined?{}:{'content-type':'application/json'},
   body:value===undefined?undefined:JSON.stringify(value)});
  let data;try{data=await r.json()}catch{data={}};
  return {status:r.status,data};
 },{path,method,value});
}
function check(res,status,message){
 assert.equal(res.status,status,message+' '+JSON.stringify(res.data).slice(0,850));
}
async function makeFolder(name,parentId){
 const r=await api('/folders','POST',{name,parentId});
 check(r,201,'create folder');return r.data;
}
async function makeRecord(name,folderId,content='# Archive test'){
 const r=await api('/records','POST',{name,folderId,content});
 check(r,201,'create record');return r.data;
}
async function previewFolder(id,rev=1){
 const r=await api('/folders/'+id+'/delete-preview?expectedMetadataRevision='+rev);
 check(r,200,'folder deletion preview');return r.data;
}
async function folderDelete(id,preview,rev=1){
 return api('/folders/'+id,'DELETE',{expectedMetadataRevision:rev,previewToken:preview.previewToken});
}
async function read(id){
 const r=await api('/records/'+id);check(r,200,'read record');return r.data;
}
async function archive(id,rev){
 const r=await api('/records/'+id+'/meta','PATCH',{expectedMetadataRevision:rev,status:'archived'});
 check(r,200,'archive');return r.data;
}
async function deletePreview(record){
 return api('/records/'+record.id+'/deletion-preview?expectedMetadataRevision='+record.metadataRevision+'&expectedRevision='+record.revision);
}
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const u='lifecycle-'+Date.now(),parent=await makeFolder(u),folderId=parent.id;
 const nested=await makeFolder('child',folderId),childId=nested.id;
 const first=await makeRecord('alpha.md',folderId,'# Alpha\n\nOne revision');
 const deep=await makeRecord('deep.md',childId,'# Deep\n\nKeep these versions');
 const archived=await archive(first.id,1);
 assert.equal(archived.metadataRevision,2);
 const firstArchived=await read(first.id);
 assert.equal(firstArchived.folderId,null);
 assert.equal(firstArchived.archivedFromPath,'/'+u+'/alpha.md');
 assert.equal(firstArchived.path,'/'+u+'/alpha.md');
 assert.ok(firstArchived.archivedAt);
 const activePath=await api('/paths?path='+encodeURIComponent('/'+u+'/alpha.md'));
 check(activePath,404,'archived path is not resolvable');
 const filtered=await api('/archives?query='+encodeURIComponent(u));
 check(filtered,200,'list archive by original path');
 assert.ok(filtered.data.items.some(x=>x.id===first.id&&x.archivedFromPath==='/'+u+'/alpha.md'));
 const browsing=await api('/folders?parentId='+folderId);
 check(browsing,200,'active browse');
 assert.ok(!browsing.data.items.some(x=>x.id===first.id),'archived not in browse');
 const search=await api('/search?query=One%20revision&mode=literal');
 check(search,200,'literal search');
 assert.ok(!search.data.results?.some(x=>x.id===first.id),'archived excluded from search');
 const replacement=await makeRecord('alpha.md',folderId,'# New document under reclaimed name');
 const resolved=await api('/paths?path='+encodeURIComponent('/'+u+'/alpha.md'));
 check(resolved,200,'original path available for new record');
 assert.equal(resolved.data.id,replacement.id);
 const conflict=await api('/records/'+first.id+'/meta','PATCH',{expectedMetadataRevision:2,status:'active'});
 check(conflict,409,'restoring cannot overwrite replacement');
 assert.equal(conflict.data.code,'PATH_CONFLICT');
 const renamed=await api('/records/'+first.id+'/meta','PATCH',{expectedMetadataRevision:2,status:'active',name:'old-alpha.md'});
 check(renamed,200,'rename and restore to original folder');
 assert.equal((await read(first.id)).folderId,folderId);
 await archive(first.id,3);
 const oldSnapshot=await previewFolder(folderId);
 assert.equal(oldSnapshot.foldersToDelete,2);
 assert.equal(oldSnapshot.recordsToArchive,2,'deep + replacement; first already detached');
 assert.equal(oldSnapshot.recordsPermanentlyDeleted,0);
 assert.match(oldSnapshot.previewToken,/^[0-9a-f]{64}$/);
 const changed=await api('/records/'+deep.id+'/meta','PATCH',{expectedMetadataRevision:1,description:'Updated by another agent'});
 check(changed,200,'concurrent metadata change');
 const stale=await folderDelete(folderId,oldSnapshot);
 check(stale,409,'stale folder preview refused');
 assert.equal(stale.data.code,'STALE_DELETE_PREVIEW');
 check(await api('/folders/'+folderId),200,'stale preview keeps root');
 const fresh=await previewFolder(folderId);
 const deleted=await folderDelete(folderId,fresh);
 check(deleted,200,'delete parent and archive nested records');
 assert.equal(deleted.data.recordsArchived,2);
 assert.equal(deleted.data.foldersDeleted,2);
 assert.equal(deleted.data.recordsPermanentlyDeleted,0);
 check(await api('/folders/'+folderId),404,'parent folder deleted');
 check(await api('/folders/'+childId),404,'child folder deleted');
 for(const [id,oldPath] of [[deep.id,'/'+u+'/child/deep.md'],[replacement.id,'/'+u+'/alpha.md'],[first.id,'/'+u+'/old-alpha.md']]){
  const row=await read(id);
  assert.equal(row.status,'archived');assert.equal(row.folderId,null);
  assert.equal(row.archivedFromPath,oldPath);
  assert.ok(row.content.startsWith('# '),'content survived directory deletion');
 }
 const noOriginal=await api('/records/'+deep.id+'/meta','PATCH',{expectedMetadataRevision:3,status:'active'});
 check(noOriginal,409,'deleted folder cannot be inferred');
 assert.equal(noOriginal.data.code,'RESTORE_DESTINATION_REQUIRED');
 const restoredName='restored-'+u+'.md';
 const restoreToRoot=await api('/records/'+deep.id+'/meta','PATCH',{expectedMetadataRevision:3,status:'active',folderId:null,name:restoredName});
 check(restoreToRoot,200,'explicit root restore');
 assert.equal((await read(deep.id)).path,'/'+restoredName);
 const activeDelete=await api('/records/'+deep.id,'DELETE',{expectedMetadataRevision:4,expectedRevision:1});
 check(activeDelete,409,'active cannot be permanently deleted');
 assert.equal(activeDelete.data.code,'RECORD_NOT_ARCHIVED');
 // Existing relations should not allow bypassing archive status.
 const victim=await read(replacement.id);
 const impact=await deletePreview(victim);
 check(impact,200,'permanent deletion impact preview');
 assert.ok(impact.data.revisions>=1);
 assert.equal(impact.data.dryRun,true);
 const staleVersion=await api('/records/'+victim.id,'DELETE',{expectedMetadataRevision:victim.metadataRevision,expectedRevision:99});
 check(staleVersion,409,'permanent deletion requires current content version');
 const gone=await api('/records/'+victim.id,'DELETE',{expectedMetadataRevision:victim.metadataRevision,expectedRevision:victim.revision});
 check(gone,200,'permanent delete archived record');
 assert.equal(gone.data.deleted,true);
 assert.equal(gone.data.vectorCleanupQueued,true);
 check(await api('/records/'+victim.id),404,'deleted record not recoverable through API');

 const empty=await makeFolder('empty-ui-'+u);
 await page.goto(base+'/library/'+empty.id,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'删除文件夹',exact:true}).click();
 const dialog=page.getByRole('alertdialog',{name:'删除文件夹并归档内容？'});
 await dialog.waitFor();
 await dialog.getByRole('button',{name:'取消'}).click();
 check(await api('/folders/'+empty.id),200,'cancel keeps empty folder');
 await page.getByRole('button',{name:'删除文件夹',exact:true}).click();
 await page.getByRole('alertdialog',{name:'删除文件夹并归档内容？'}).getByRole('button',{name:'删除文件夹',exact:true}).click();
 await page.waitForURL(base+'/library',{timeout:15000});
 check(await api('/folders/'+empty.id),404,'empty folder deleted through UI');
 await page.goto(base+'/archive',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'归档',exact:true}).waitFor();
 const row=page.locator('.archive-item').filter({hasText:'old-alpha'});
 await row.waitFor();
 await row.getByRole('button',{name:'old-alpha',exact:true}).click();
 const preview=page.locator('[id="archive-preview-'+first.id+'"]');
 await preview.getByRole('heading',{name:'归档预览',exact:true}).waitFor();
 await preview.getByText('One revision',{exact:true}).waitFor();
 await preview.getByRole('button',{name:'关闭',exact:true}).click();
 await row.getByRole('button',{name:'更多操作：old-alpha.md',exact:true}).click();
 await page.getByRole('menuitem',{name:'永久删除',exact:true}).click();
 const confirm=page.getByRole('alertdialog',{name:'永久删除已归档记录？'});
 await confirm.waitFor();
 await confirm.getByRole('button',{name:'取消'}).click();
 check(await api('/records/'+first.id),200,'cancel preserves archived record');
 await row.getByRole('button',{name:'更多操作：old-alpha.md',exact:true}).click();
 await page.getByRole('menuitem',{name:'永久删除',exact:true}).click();
 await page.getByRole('alertdialog',{name:'永久删除已归档记录？'}).getByRole('button',{name:'永久删除'}).click();
 await row.waitFor({state:'detached',timeout:12000});
 check(await api('/records/'+first.id),404,'archive UI permanently deleted record');
 // A name conflict can be resolved in the shared restore panel.
 const destination=await makeFolder('archive-destination-'+u);
 const conflictRecord=await makeRecord('restore-me.md',destination.id,'# Preview document\n\nArchived body.');
 await archive(conflictRecord.id,1);
 await makeRecord('restore-me.md',destination.id,'# Existing name');
 await page.reload({waitUntil:'networkidle'});
 let conflictRow=page.locator('.archive-item').filter({hasText:'restore-me'});
 await conflictRow.getByRole('button',{name:'恢复',exact:true}).click();
 const restorePanel=page.locator('[id="archive-restore"]');
 await restorePanel.getByRole('heading',{name:'恢复归档',exact:true}).waitFor();
 await restorePanel.getByRole('textbox',{name:'名称',exact:true}).fill('restored-unique.md');
 await restorePanel.getByRole('button',{name:'恢复',exact:true}).click();
 await conflictRow.waitFor({state:'detached'});
 assert.equal((await read(conflictRecord.id)).name,'restored-unique.md');
 // Two independent archive panels share the same workspace stack.
 const a=await makeRecord('archive-one.md',destination.id,'# First preview');
 const b=await makeRecord('archive-two.md',destination.id,'# Second preview');
 await archive(a.id,1);await archive(b.id,1);
 await page.reload({waitUntil:'networkidle'});
 for(const name of ['archive-one','archive-two'])await page.getByRole('button',{name,exact:true}).click();
 await page.locator('[id="archive-preview-'+a.id+'"][data-ready]').waitFor();
 await page.locator('[id="archive-preview-'+b.id+'"][data-ready]').waitFor();
 await page.waitForTimeout(550);
 mkdirSync('output/playwright',{recursive:true});
 await page.screenshot({path:'output/playwright/archive-desktop.png'});
 for(const id of [b.id,a.id])await page.locator('[id="archive-preview-'+id+'"]').getByRole('button',{name:'关闭',exact:true}).click();
 // Selection persists for failures and successful batch restores disappear.
 for(const name of ['archive-one.md','archive-two.md'])await page.getByRole('checkbox',{name:'选择 '+name,exact:true}).check();
 check(await api('/records/'+b.id+'/meta','PATCH',{expectedMetadataRevision:2,description:'Concurrent archive metadata update'}),200,'concurrent batch change');
 await page.getByRole('button',{name:'恢复所选',exact:true}).click();
 await page.getByRole('button',{name:'archive-one',exact:true}).waitFor({state:'detached'});
 await page.getByText('已选 1 项',{exact:true}).waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'选择 archive-two.md',exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'恢复所选',exact:true}).click();
 await page.getByRole('button',{name:'archive-two',exact:true}).waitFor({state:'detached'});
 assert.equal((await read(a.id)).status,'active');assert.equal((await read(b.id)).status,'active');
 console.log('Archive E2E: independent previews and partial batch restore passed');
 await archive(a.id,3);await archive(b.id,4);
 const taskList=await api('/records','POST',{kind:'task_list',name:'archive-tasks',folderId:destination.id});
 check(taskList,201,'create task archive');
 check(await api('/tasks/mutate','POST',{recordId:taskList.data.id,action:'add',expectedRevision:1,changes:{title:'Archived task',details:'Preserved task details'}}),200,'create archived task content');
 await archive(taskList.data.id,(await read(taskList.data.id)).metadataRevision);
 await page.reload({waitUntil:'networkidle'});
 await page.getByRole('combobox',{name:/^内容类型/}).click();
 await page.getByRole('option',{name:'任务列表',exact:true}).click();
 await page.getByRole('button',{name:'archive-tasks',exact:true}).waitFor();
 await page.getByRole('button',{name:'archive-one',exact:true}).waitFor({state:'detached'});
 await page.getByRole('button',{name:'archive-tasks',exact:true}).click();
 const tasksPreview=page.locator('[id="archive-preview-'+taskList.data.id+'"]');
 await tasksPreview.getByText('Archived task',{exact:true}).waitFor();
 await tasksPreview.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('combobox',{name:/^内容类型/}).click();
 await page.getByRole('option',{name:'全部类型',exact:true}).click();
 await page.getByRole('checkbox',{name:'按原文件夹分组',exact:true}).check();
 await page.getByRole('heading',{name:new RegExp('archive-destination-')}).waitFor();
 await page.getByRole('checkbox',{name:'按原文件夹分组',exact:true}).uncheck();
 await page.getByRole('combobox',{name:/^排序/}).click();
 await page.getByRole('option',{name:'按名称',exact:true}).click();
 await page.getByRole('textbox',{name:'搜索归档',exact:true}).fill('archive-one');
 await page.getByRole('button',{name:'archive-two',exact:true}).waitFor({state:'detached'});
 await page.getByRole('textbox',{name:'搜索归档',exact:true}).fill('');
 await page.getByRole('button',{name:'archive-two',exact:true}).waitFor();
 console.log('Archive E2E: task preview, type/search filters, grouping and sorting passed');
 await page.waitForTimeout(800);
 // The Windows WebKit test port crashes during this live viewport switch.
 // Load the two responsive viewports independently in that engine.
 if(process.env.RECALLOOM_TEST_BROWSER==='webkit')await page.goto('about:blank');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.locator('.archive-table .astryx-checkbox-input[data-size="sm"]').count()>0,'Archive uses compact Astryx checkboxes');
 assert.equal(await page.locator('.archive-table .astryx-checkbox-input:not([data-size="sm"])').count(),0,'Every row and select-all checkbox uses the compact size');
 await page.emulateMedia({colorScheme:'dark'});
 await page.goto(base+'/archive',{waitUntil:'networkidle'});
 await page.waitForTimeout(600);
 await page.screenshot({path:'output/playwright/archive-mobile.png'});
 await page.getByRole('button',{name:'archive-one',exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page fits its viewport');
 await page.screenshot({path:'output/playwright/archive-mobile.png'});
 await page.getByRole('button',{name:'archive-one',exact:true}).click();
 await page.getByText('First preview',{exact:true}).waitFor();
 await page.waitForTimeout(500);
 await page.screenshot({path:'output/playwright/archive-mobile-preview.png'});
 await page.locator('[id="archive-preview-'+a.id+'"]').getByRole('button',{name:'关闭',exact:true}).click();
 for(const name of ['archive-one.md','archive-two.md'])await page.getByRole('checkbox',{name:'选择 '+name,exact:true}).check();
 await page.getByRole('button',{name:'永久删除',exact:true}).click();
 const batchDelete=page.getByRole('alertdialog',{name:'永久删除 2 项归档内容？',exact:true});
 await batchDelete.getByRole('button',{name:'永久删除',exact:true}).click();
 await page.getByRole('button',{name:'archive-one',exact:true}).waitFor({state:'detached'});
 await page.getByRole('button',{name:'archive-two',exact:true}).waitFor({state:'detached'});
 check(await api('/records/'+a.id),404,'batch permanent deletion a');check(await api('/records/'+b.id),404,'batch permanent deletion b');
 console.log('Archive E2E: mobile preview and batch deletion passed');
 const large=await makeRecord('large-archive.md',destination.id,'# Large archive\n\n'+('A'.repeat(72)+'\n').repeat(4500)+'\n# Large archive end');
 await archive(large.id,1);
 await page.reload({waitUntil:'networkidle'});
 await page.getByRole('button',{name:'large-archive',exact:true}).click();
 await page.locator('[id="archive-preview-'+large.id+'"]').getByRole('heading',{name:'Large archive end',exact:true}).waitFor();
 await page.locator('[id="archive-preview-'+large.id+'"]').getByRole('button',{name:'关闭',exact:true}).click();
 console.log('Archive E2E: large ranged preview passed');
 // Deterministic pagination verifies the observer and a retry without discarding
 // already loaded rows. These fixture-only IDs are never used for mutations.
 const fixtures=Array.from({length:55},(_,i)=>({id:crypto.randomUUID(),name:'Paged archive '+String(i).padStart(2,'0')+'.md',kind:'document',folderId:null,folderName:null,archivedFromPath:'/Paged/'+i+'.md',archivedAt:'2026-11-16T08:00:00Z',metadataRevision:2,revision:1,updatedAt:'2026-11-16T08:00:00Z'}));
 let nextAttempts=0;
 await page.route('**/api/archives?**',async route=>{
  const next=new URL(route.request().url()).searchParams.get('cursor');
  if(next&&++nextAttempts<=2){await route.fulfill({status:503,json:{code:'TEMPORARY_FAILURE'}});return;}
  await route.fulfill({json:{items:next?fixtures.slice(50):fixtures.slice(0,50),total:55,page:{hasMore:!next,nextCursor:next?null:'page-2'}}});
 });
 await page.reload({waitUntil:'networkidle'});
 await page.getByRole('checkbox',{name:'选择 '+fixtures[0].name,exact:true}).check();
 await page.locator('.archive-scroll .rk-scroll-viewport').evaluate(node=>{node.scrollTop=node.scrollHeight;});
 await page.getByRole('button',{name:'加载失败，重试',exact:true}).waitFor();
 assert.equal(await page.locator('.archive-item').count(),50,'pagination errors preserve existing content');
 await page.getByRole('button',{name:'加载失败，重试',exact:true}).click();
 await page.getByRole('button',{name:'Paged archive 54',exact:true}).waitFor();
 assert.equal(await page.locator('.archive-item').count(),55);
 assert.equal(await page.getByRole('checkbox',{name:'选择 '+fixtures[0].name,exact:true}).isChecked(),true);
 assert.equal(nextAttempts,3);
 console.log('PASS lifecycle: isolated archive listing/path, reclaimed names, CAS restore, stale subtree preview, atomic recursive delete, restored root, gated permanent delete, folder/record UI');
}catch(error){
 await page.screenshot({path:'output/playwright/archive-failure.png'}).catch(()=>{});
 throw error;
}finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
