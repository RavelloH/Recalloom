/** Destructive lifecycle regression on an ISOLATED local Wrangler D1/KV instance.
 * Never run this against production.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(executablePath&&line,'local browser and .dev.vars are needed');
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Destructive lifecycle tests must only use a loopback Worker');
const browser=await chromium.launch({headless:true,executablePath});
const page=await browser.newPage({viewport:{width:1360,height:860}});
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
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
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
 const row=page.locator('.archive-item').filter({hasText:'/'+u+'/old-alpha.md'});
 await row.waitFor();
 await row.getByRole('button',{name:'永久删除'}).click();
 const confirm=page.getByRole('alertdialog',{name:'永久删除已归档记录？'});
 await confirm.waitFor();
 await confirm.getByRole('button',{name:'取消'}).click();
 check(await api('/records/'+first.id),200,'cancel preserves archived record');
 await row.getByRole('button',{name:'永久删除'}).click();
 await page.getByRole('alertdialog',{name:'永久删除已归档记录？'}).getByRole('button',{name:'永久删除'}).click();
 await row.waitFor({state:'detached',timeout:12000});
 check(await api('/records/'+first.id),404,'archive UI permanently deleted record');
 console.log('PASS lifecycle: isolated archive listing/path, reclaimed names, CAS restore, stale subtree preview, atomic recursive delete, restored root, gated permanent delete, folder/record UI');
}finally{await browser.close();}
