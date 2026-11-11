import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const binary=[process.env.RECALLOOM_BROWSER_PATH,
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(f=>f&&existsSync(f));
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(s=>/^\s*MCP_AUTH_SECRET\s*=/.test(s));
const secret=process.env.RECALLOOM_TEST_SECRET??line?.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const base=process.env.RECALLOOM_TEST_BASE??'http://127.0.0.1:8897';
assert.ok(binary&&secret);
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);

const browser=await chromium.launch({executablePath:binary,headless:true});
const page=await browser.newPage({viewport:{width:1320,height:880}});
const faults=[];
page.on('pageerror',err=>faults.push(err.message));
page.setDefaultTimeout(24000);
const request=async(method,path,body)=>{
 const result=await page.evaluate(async({method,path,body})=>{
  const response=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw Error(path+': '+response.status+' '+JSON.stringify(data));
  return data;
 },{method,path,body});
 return result;
};
const create=(name,content,tags=[])=>request('POST','/records',{name,kind:'document',content,tags});
const read=id=>request('GET','/records/'+id);
const until=async(check,message)=>{for(let attempt=0;attempt<55;attempt++){if(await check())return;await page.waitForTimeout(130);}throw Error('Timed out: '+message);};
const header=()=>page.locator('.record-page.workbench-document .workbench-header');
const topTitle=()=>header().locator('.page-title');
const open=(id,mode='source')=>page.goto(base+'/records/'+id+'?mode='+mode);
const editTop=async(title)=>{
 await topTitle().click();
 await page.keyboard.press('Control+A');
 await page.keyboard.type(title);
 await page.keyboard.press('Enter');
 await topTitle().getByText(title,{exact:true}).waitFor();
};
const save=async()=>{
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.getByText('已保存',{exact:true}).first().waitFor();
};
try{
 await page.goto(base+'/login');
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/');

 const pure=await create('Only filename','A paragraph.\n\n# Later H1');
 await open(pure.id);
 await topTitle().getByText('Only filename',{exact:true}).waitFor();
 assert.equal(await header().locator('.workbench-document-filename').count(),0);
 assert.equal(await header().locator('.workbench-tag-line').count(),0,'Empty tags do not render a row');
 await page.locator('.cm-content').getByText('Later H1').waitFor();
 await editTop('Renamed file');
 await until(async()=>(await read(pure.id)).name==='Renamed file','top filename rename persisted');
 assert.equal((await read(pure.id)).content,'A paragraph.\n\n# Later H1','Renaming filename must not change body');
 await header().getByRole('button',{name:'详细信息'}).click();
 const inspector=page.getByRole('dialog',{name:'文档检查器'});
 await inspector.waitFor();
 const filename=inspector.getByRole('textbox',{name:'文件名'});
 await filename.fill('New name from details');
 await filename.press('Enter');
 await filename.waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('.workbench-header .page-title')?.textContent==='New name from details');
 await until(async()=>(await read(pure.id)).name==='New name from details','inspector filename rename persisted');
 await inspector.getByRole('button',{name:'关闭'}).click();
 console.log('PASS filename-only document, late H1 stays in body, renaming in top and details');

 const withH1=await create('sample-entry','# Original H1\n\nBody text.\n\n## Other');
 await open(withH1.id);
 await topTitle().getByText('Original H1',{exact:true}).waitFor();
 await header().getByText('sample-entry.md').waitFor();
 const source=page.locator('.cm-content');
 await source.getByText('Body text.').waitFor();
 assert.equal(await source.getByText('Original H1').count(),0,'Promoted heading must not duplicate in source');
 await header().getByText('编辑者：本人（Web）',{exact:true}).waitFor();
 assert.ok((await header().locator('.workbench-summary').innerText()).includes('字') ,'Character count must render');
 await editTop('Changed / 中文 H1');
 await page.getByText('未保存',{exact:true}).first().waitFor();
 assert.equal((await read(withH1.id)).content,'# Original H1\n\nBody text.\n\n## Other','Unsaved title must not write a new revision');
 await save();
 await topTitle().getByText('Changed / 中文 H1',{exact:true}).waitFor();
 assert.equal((await read(withH1.id)).content,'# Changed / 中文 H1\n\nBody text.\n\n## Other');
 assert.equal((await read(withH1.id)).name,'sample-entry','Editing H1 must not rename the file');
 await header().getByRole('button',{name:'详细信息'}).click();
 const h1Name=inspector.getByRole('textbox',{name:'文件名'});
 await h1Name.fill('renamed-entry');
 await h1Name.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.workbench-document-filename')?.textContent?.includes('renamed-entry'));
 await until(async()=>(await read(withH1.id)).name==='renamed-entry','H1 inspector filename rename persisted');
 assert.equal((await read(withH1.id)).content,'# Changed / 中文 H1\n\nBody text.\n\n## Other');
 await inspector.getByRole('button',{name:'关闭'}).click();
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await topTitle().getByText('Changed / 中文 H1',{exact:true}).waitFor();
 assert.equal(await page.locator('.editor-body h1').count(),0,'Promoted H1 should not be in preview');
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 try{await page.locator('.tiptap').waitFor();}catch(err){
  console.error('VISUAL DEBUG',JSON.stringify({faults,mode:await page.locator('.editor-body').getAttribute('data-mode'),text:(await page.locator('.editor-body').innerText()).slice(0,600)}));
  throw err;
 }
 assert.equal(await page.locator('.tiptap h1').count(),0,'Promoted H1 should not appear in visual editor');
 console.log('PASS opening H1, no duplication in three modes, H1 source edits and filename independent');

 const delayed=await create('first-block-delayed','Body original');
 await open(delayed.id);
 await topTitle().getByText('first-block-delayed',{exact:true}).waitFor();
 await page.locator('.cm-content').fill('# Added heading\n\nBody original');
 await topTitle().getByText('first-block-delayed',{exact:true}).waitFor();
 assert.ok((await page.locator('.cm-content').innerText()).includes('Added heading'),'H1 remains in body during same editing session');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await topTitle().getByText('Added heading',{exact:true}).waitFor();
 assert.equal(await page.locator('.editor-body h1').count(),0,'Leading H1 promoted only at mode boundary');
 await save();
 assert.equal((await read(delayed.id)).content,'# Added heading\n\nBody original');
 await page.reload();
 await topTitle().getByText('Added heading',{exact:true}).waitFor();
 await page.getByRole('button',{name:'源码',exact:true}).click();
 assert.equal(await page.locator('.cm-content').getByText('Added heading').count(),0);
 console.log('PASS first-block H1 stays in body until mode switch, then persists across reopen');

 const savedWithoutSwitch=await create('save-first-heading-later','');
 await open(savedWithoutSwitch.id);
 await page.locator('.cm-content').fill('# Saved but not promoted\n\nBody');
 await save();
 await topTitle().getByText('save-first-heading-later',{exact:true}).waitFor();
 assert.ok((await page.locator('.cm-content').innerText()).includes('Saved but not promoted'),
  'Saving should not count as reopening the document');
 assert.equal((await read(savedWithoutSwitch.id)).content,'# Saved but not promoted\n\nBody');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await topTitle().getByText('Saved but not promoted',{exact:true}).waitFor();
 assert.equal(await page.locator('.editor-body h1').count(),0);
 console.log('PASS save without mode switch preserves the same-session unpromoted H1');

 const reopenAfterSave=await create('reopen-to-promote','');
 await open(reopenAfterSave.id);
 await page.locator('.cm-content').fill('# Appears after reopen\n\nBody');
 await save();
 await topTitle().getByText('reopen-to-promote',{exact:true}).waitFor();
 await page.reload();
 await topTitle().getByText('Appears after reopen',{exact:true}).waitFor();
 assert.equal(await page.locator('.cm-content').getByText('Appears after reopen').count(),0);
 console.log('PASS reopening after save promotes the stored first-block H1');

 const visualInserted=await create('visual-first-heading','');
 await open(visualInserted.id,'visual');
 await page.locator('.tiptap p').first().click();
 await page.keyboard.press('Control+Alt+1');
 await page.keyboard.type('Visual heading');
 await page.keyboard.press('Enter');
 await page.keyboard.type('Visual body');
 await topTitle().getByText('visual-first-heading',{exact:true}).waitFor();
 await page.locator('.tiptap h1').getByText('Visual heading').waitFor();
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await topTitle().getByText('Visual heading',{exact:true}).waitFor();
 assert.equal(await page.locator('.cm-content').getByText('Visual heading').count(),0);
 await save();
 assert.ok((await read(visualInserted.id)).content.startsWith('# Visual heading'));
 console.log('PASS visual-mode first H1 remains a body block until source-mode switch');

 const later=await create('later-heading','First body paragraph');
 await open(later.id);
 await page.locator('.cm-content').fill('First body paragraph\n\n# Later heading');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await topTitle().getByText('later-heading',{exact:true}).waitFor();
 await page.locator('.editor-body h1').filter({hasText:'Later heading'}).waitFor();
 assert.equal(await page.locator('.editor-body h1').count(),1,'H1 after another block never promotes');
 await save();
 await page.reload();
 await topTitle().getByText('later-heading',{exact:true}).waitFor();
 assert.equal((await read(later.id)).content,'First body paragraph\n\n# Later heading');
 console.log('PASS non-first H1 remains ordinary content after mode switch and reopen');

 assert.deepEqual(faults,[]);
}finally{await browser.close();}
