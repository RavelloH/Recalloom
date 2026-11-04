/** Isolated Web API + browser regression for archived records and empty folder deletion.
 * Never run this against production. Use a fresh wrangler dev D1/KV instance.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(edge&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base='http://127.0.0.1:8897',browser=await chromium.launch({headless:true,executablePath:edge});
const page=await browser.newPage({viewport:{width:1350,height:860}});
async function api(path,method='GET',value){
 return page.evaluate(async({path,method,value})=>{
  const r=await fetch('/api'+path,{method,headers:value===undefined?{}:{'content-type':'application/json'},
   body:value===undefined?undefined:JSON.stringify(value)});
  let data;try{data=await r.json()}catch{data={}};
  return {status:r.status,data};
 },{path,method,value});
}
function code(actual,expected,label){assert.equal(actual.status,expected,label+' '+JSON.stringify(actual.data).slice(0,700))}
try{
 await page.goto(base+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:25000});
 const unique=String(Date.now());
 const parent=await api('/folders','POST',{name:'archive-test-'+unique});
 code(parent,201,'create parent');
 const folderId=parent.data.id;
 const child=await api('/folders','POST',{name:'empty-child',parentId:folderId});
 code(child,201,'create child');
 const childId=child.data.id;
 const record=await api('/records','POST',{name:'archive-note-'+unique,kind:'document',folderId,content:'# Keep every revision'});
 code(record,201,'create archive record');
 const id=record.data.id;
 const archived=await api('/records/'+id+'/meta','PATCH',{expectedMetadataRevision:1,status:'archived'});
 code(archived,200,'archive record');
 const listing=await api('/archives?limit=50');
 code(listing,200,'archive listing');
 assert.ok(listing.data.items.some(x=>x.id===id&&x.metadataRevision===2),'archive visible in dedicated listing');
 const active=await api('/folders?parentId='+folderId);
 code(active,200,'active folder listing');
 assert.ok(!active.data.items.some(x=>x.id===id),'archived item hidden from active folder');
 assert.ok(active.data.items.some(x=>x.id===childId),'unarchived child folder remains');
 const protectedParent=await api('/folders/'+folderId,'DELETE',{expectedMetadataRevision:1,expectedName:parent.data.name??'archive-test-'+unique});
 code(protectedParent,409,'parent with children cannot delete');
 assert.equal(protectedParent.data.code,'FOLDER_NOT_EMPTY');

 const wrongVersion=await api('/folders/'+childId,'DELETE',{expectedMetadataRevision:999,expectedName:'empty-child'});
 code(wrongVersion,409,'stale metadata blocked');
 const childRemoved=await api('/folders/'+childId,'DELETE',{expectedMetadataRevision:1,expectedName:'empty-child'});
 code(childRemoved,200,'empty child delete');
 const stillArchived=await api('/folders/'+folderId,'DELETE',{expectedMetadataRevision:1,expectedName:'archive-test-'+unique});
 code(stillArchived,409,'archived record protects parent');
 const kept=await api('/records/'+id);
 code(kept,200,'archived content accessible');
 assert.equal(kept.data.content,'# Keep every revision');

 await page.goto(base+'/archive',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'归档',exact:true}).waitFor();
 const row=page.locator('.archive-item').filter({hasText:'archive-note-'+unique});
 await row.waitFor({timeout:12000});
 await row.getByRole('button',{name:'恢复'}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  return r.ok&&(await r.json()).status==='active';
 },id,{timeout:12000});
 await row.waitFor({state:'detached',timeout:15000});
 assert.equal(await page.locator('.archive-item').filter({hasText:'archive-note-'+unique}).count(),0,'restored record removed from archive UI');

 const archiveAgain=await api('/records/'+id+'/meta','PATCH',{expectedMetadataRevision:3,status:'archived'});
 code(archiveAgain,200,'archive again');
 const move=await api('/records/'+id+'/meta','PATCH',{expectedMetadataRevision:4,folderId:null});
 code(move,200,'move archived record out of folder');
 const removed=await api('/folders/'+folderId,'DELETE',{expectedMetadataRevision:1,expectedName:'archive-test-'+unique});
 code(removed,200,'empty parent can be explicitly deleted');
 const missing=await api('/folders/'+folderId);
 code(missing,404,'removed folder not found');
 const preserved=await api('/records/'+id);
 code(preserved,200,'moving preserves original record');
 assert.equal(preserved.data.status,'archived');

 const empty=await api('/folders','POST',{name:'ui-empty-'+unique});
 code(empty,201,'create separate empty folder for UI test');
 await page.goto(base+'/library/'+empty.data.id,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'删除空文件夹'}).click();
 const dialog=page.getByRole('alertdialog',{name:'永久删除空文件夹？'});
 await dialog.waitFor();
 await dialog.getByRole('button',{name:'取消'}).click();
 code(await api('/folders/'+empty.data.id),200,'cancel preserves folder');
 await page.getByRole('button',{name:'删除空文件夹'}).click();
 await page.getByRole('alertdialog',{name:'永久删除空文件夹？'}).getByRole('button',{name:'删除空文件夹'}).click();
 await page.waitForURL(base+'/library',{timeout:15000});
 code(await api('/folders/'+empty.data.id),404,'confirmed empty folder deleted');

 // The archived record remains recoverable after its original directory was removed.
 const restore=await api('/records/'+id+'/meta','PATCH',{expectedMetadataRevision:5,status:'active'});
 code(restore,200,'recover archived record after folder removal');
 const finalRecord=await api('/records/'+id);
 code(finalRecord,200,'record preserved');
 assert.equal(finalRecord.data.content,'# Keep every revision');
 console.log('PASS archive management: paged listing, hidden active tree, restore, CAS, archived-child protection, empty folder deletion, cancel/confirm, preserved record');
}finally{await browser.close()}
