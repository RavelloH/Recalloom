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

 // A file name with .md is displayed without that suffix in the page title.
 const plain=await create('Only filename.md','A paragraph.\n\n# Later H1');
 await open(plain.id);
 await topTitle().getByText('Only filename',{exact:true}).waitFor();
 assert.equal((await topTitle().innerText()).trim(),'Only filename');
 assert.equal(await header().locator('.workbench-document-filename').count(),0,
  'the metadata strip must not repeat the filename');
 await page.locator('.cm-content').getByText('Later H1').waitFor();
 await editTop('Renamed file');
 await until(async()=>(await read(plain.id)).name==='Renamed file.md','inline rename preserves .md suffix');
 assert.equal((await read(plain.id)).content,'A paragraph.\n\n# Later H1',
  'renaming the file must never change Markdown content');
 await header().getByRole('button',{name:'详细信息'}).click();
 const inspector=page.getByRole('dialog',{name:'文档检查器'});
 await inspector.waitFor();
 assert.equal(await inspector.getByRole('textbox',{name:'文件名'}).count(),0,
  'filename editing lives in the top title, not in the metadata inspector');
 await inspector.getByText('Markdown 文档',{exact:true}).waitFor();
 await inspector.getByRole('button',{name:'关闭'}).click();
 console.log('PASS filename title without extension, metadata inspector without duplicate rename input');

 // A first-block H1 is always actual Markdown content. Source, preview and
 // visual editor must all show it instead of promoting it to the page header.
 const sourceText='# Original H1\n\nBody text.\n\n## Other';
 const first=await create('sample-entry',sourceText);
 await open(first.id);
 await topTitle().getByText('sample-entry',{exact:true}).waitFor();
 assert.ok((await page.locator('.cm-content').innerText()).includes('Original H1'),
  'source editor must include the first H1');
 await editTop('renamed-entry');
 await until(async()=>(await read(first.id)).name==='renamed-entry','header rename persists independently');
 assert.equal((await read(first.id)).content,sourceText,'filename rename must not rewrite H1');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 const previewHeading=page.locator('.editor-body .markdown-preview h1').first();
 await previewHeading.getByText('Original H1',{exact:true}).waitFor();
 const sizes=await page.evaluate(()=>{
  const title=document.querySelector('.workbench-header h1.page-title');
  const heading=document.querySelector('.editor-body .markdown-preview h1');
  return {file:parseFloat(getComputedStyle(title).fontSize),body:parseFloat(getComputedStyle(heading).fontSize)};
 });
 assert.ok(sizes.body<sizes.file,'body H1 must be smaller than the filename title: '+JSON.stringify(sizes));
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 await page.locator('.tiptap h1').getByText('Original H1',{exact:true}).waitFor();
 await page.getByRole('button',{name:'源码',exact:true}).click();
 assert.ok((await page.locator('.cm-content').innerText()).includes('# Original H1'),
  'source mode must preserve the actual heading markup');
 await page.locator('.cm-content').fill('# Edited H1\n\nBody text.\n\n## Other');
 await save();
 assert.equal((await read(first.id)).name,'renamed-entry',
  'editing a body H1 must not change filename');
 assert.equal((await read(first.id)).content,'# Edited H1\n\nBody text.\n\n## Other');
 await page.reload();
 await topTitle().getByText('renamed-entry',{exact:true}).waitFor();
 assert.ok((await page.locator('.cm-content').innerText()).includes('Edited H1'),
  'saved first H1 must remain visible on reopen');
 console.log('PASS first H1 in source, preview and visual; typography and filename independence');

 // Rich Markdown attributes must stay in the body and survive mode switches.
 const attributedText='# Visible H1 @ attrs stable-heading @\n\n正文段落';
 const attributed=await create('RMD-title.md',attributedText);
 await open(attributed.id);
 await topTitle().getByText('RMD-title',{exact:true}).waitFor();
 assert.ok((await page.locator('.cm-content').innerText()).includes('stable-heading'));
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.locator('.editor-body h1').getByText('Visible H1',{exact:true}).waitFor();
 await page.getByRole('button',{name:'源码',exact:true}).click();
 assert.ok((await page.locator('.cm-content').innerText()).includes('stable-heading'));
 assert.equal((await read(attributed.id)).content,attributedText);
 console.log('PASS RMD H1 attributes remain in Markdown and visible as ordinary headings');

 // Creating and saving a first heading must not ever promote it on mode
 // switch, save, or reload. Non-first H1 behaves identically.
 const newHeading=await create('new-heading','');
 await open(newHeading.id);
 await page.locator('.cm-content').fill('# New body heading\n\nBody');
 await save();
 await topTitle().getByText('new-heading',{exact:true}).waitFor();
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await page.locator('.editor-body h1').getByText('New body heading',{exact:true}).waitFor();
 await page.reload();
 await topTitle().getByText('new-heading',{exact:true}).waitFor();
 await page.locator('.editor-body h1').getByText('New body heading',{exact:true}).waitFor();
 assert.equal((await read(newHeading.id)).content,'# New body heading\n\nBody');
 console.log('PASS save/reload and mode changes never extract the first H1');

 assert.deepEqual(faults,[]);
}finally{await browser.close();}
