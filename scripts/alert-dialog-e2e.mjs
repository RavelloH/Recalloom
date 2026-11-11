import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {existsSync,readFileSync} from 'node:fs';

const bin=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^\s*MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(bin&&line);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8897';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'Browser tests must use a local-only Worker');
const browser=await chromium.launch({headless:true,executablePath:bin});
const page=await browser.newPage({viewport:{width:1360,height:900}});
try {
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');
 await page.goto(base+'/library');
 await page.getByRole('button',{name:'新建记录'}).click();
 await page.getByRole('textbox',{name:'名称'}).fill('Astryx confirmation isolated '+Date.now());
 await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.waitForURL(/\/records\//);
 const recordId=page.url().split('/records/')[1].split('?')[0];
 await page.getByRole('button',{name:'源码',exact:true}).click();
 async function revision(){
  const r=await page.evaluate(async id=>await (await fetch('/api/records/'+id)).json(),recordId);
  return {revision:r.revision,content:r.content};
 }
 async function write(content,expected){
  await page.locator('.cm-content').fill(content);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(async ({id,expected})=>{const r=await fetch('/api/records/'+id);return r.ok&&(await r.json()).revision>=expected;},{id:recordId,expected},{timeout:12000});
  await page.waitForFunction(expected=>document.querySelector('.workbench-header .workbench-revision')?.textContent?.includes('R'+expected),expected,{timeout:12000});
 }
 await write('# First version',2);
 await write('# Second version',3);
 assert.equal((await revision()).revision,3);
 await page.getByRole('button',{name:'历史',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'文档检查器'});
 await panel.waitFor();
 const target=panel.locator('.history-row').filter({hasText:'Revision 2'});
 await target.getByRole('button',{name:'恢复'}).click();
 const confirmation=page.getByRole('alertdialog',{name:'恢复历史版本？'});
 await confirmation.waitFor();
 await confirmation.getByRole('button',{name:'取消'}).click();
 assert.equal((await revision()).revision,3,'Cancel must leave revisions unchanged');
 await target.getByRole('button',{name:'恢复'}).click();
 await page.getByRole('alertdialog',{name:'恢复历史版本？'}).getByRole('button',{name:'恢复该版本'}).click();
 await page.waitForFunction(async id=>(await (await fetch('/api/records/'+id)).json()).revision>=4,recordId,{timeout:15000});
 const restored=await revision();
 assert.equal(restored.revision,4);
 assert.equal(restored.content,'# First version');
 console.log('PASS Astryx AlertDialog: cancel leaves history untouched, confirm restores a new revision');
}finally{await browser.close();}
