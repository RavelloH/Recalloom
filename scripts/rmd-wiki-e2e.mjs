import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8799';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const line=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(x=>/^MCP_AUTH_SECRET\s*=/.test(x));
assert.ok(line&&browserPath);
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1320,height:870}});
page.setDefaultTimeout(22000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=async(path,method='GET',payload)=>page.evaluate(async({path,method,payload})=>{
 const response=await fetch('/api'+path,{
  method,headers:payload?{'content-type':'application/json'}:{},
  body:payload?JSON.stringify(payload):undefined
 });
 return {status:response.status,body:await response.json().catch(()=>({}))};
},{path,method,payload});
const created=(result,label)=>{assert.equal(result.status,201,label+' '+JSON.stringify(result).slice(0,550));return result.body;};
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:28000});
 const suffix=Date.now();
 const targetName='RMD 章节源 '+suffix+'.md';
 const source=[
  '# 源文档',
  '',
  '未包含在章节内的第一段。',
  '',
  '## 设备说明 @ attrs stable-heading @',
  '',
  '此段必须出现在章节嵌入中。',
  '',
  '## 其它部分',
  '',
  '这里绝不能出现在章节嵌入中。',
  '',
  '一个独立的段落。 @ attrs important-block @'
 ].join('\n');
 const target=created(await api('/records','POST',{kind:'document',name:targetName,content:source}),'target');
 const embed='::: embed id:'+target.id+'#stable-heading :::';
 const paragraphEmbed='::: embed id:'+target.id+'#important-block :::';
 const hostMarkdown=['# Host','','参见 [[id:'+target.id+']]。','',embed,'',paragraphEmbed].join('\n');
 const host=created(await api('/records','POST',{kind:'document',name:'RMD 关系主文档 '+suffix+'.md',content:hostMarkdown}),'host');
 const refs=await api('/records/'+host.id+'/wiki-references');
 assert.equal(refs.status,200,JSON.stringify(refs));
 assert.equal(refs.body.items.length,3,'one link and two embeds must be indexed '+JSON.stringify(refs.body));
 assert.deepEqual(refs.body.items.map(x=>x.kind),['link','embed','embed']);
 assert.ok(refs.body.items.every(x=>x.targetId===target.id&&x.resolutionStatus==='resolved'));
 const inverse=await api('/records/'+target.id+'/relations?semantic=false');
 assert.equal(inverse.status,200);
 assert.ok(inverse.body.links.some(x=>x.other.id===host.id&&x.direction==='incoming'),'target must see the backlink');
 await page.goto(base+'/records/'+host.id+'?mode=preview',{waitUntil:'domcontentloaded'});
 const preview=page.locator('.markdown-preview').first();await preview.waitFor();
 await preview.locator('.wiki-embed').first().waitFor({state:'visible'});
 await preview.getByText('此段必须出现在章节嵌入中。').first().waitFor({state:'visible'});
 await preview.getByText('一个独立的段落。',{exact:false}).first().waitFor({state:'visible'});
 assert.equal(await preview.locator('.wiki-embed').count(),2);
 assert.equal(await preview.getByText('这里绝不能出现在章节嵌入中。').count(),0);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'rendering must not dirty the document');
 await page.getByRole('button',{name:'可视化',exact:true}).click();
 const visual=page.locator('.tiptap');await visual.waitFor();
 await visual.locator('.wiki-editor-embed').first().waitFor({state:'visible'});
 assert.equal(await visual.locator('.wiki-editor-embed').count(),2);
 assert.ok(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),'read-only embed must not write');
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.locator('.cm-content').waitFor();
 assert.ok((await page.locator('.cm-content').innerText()).includes(embed));
 assert.equal((await api('/records/'+host.id)).body.content,hostMarkdown);
 const picker=created(await api('/records','POST',{kind:'document',name:'RMD Picker '+suffix+'.md',content:''}),'picker');
 // Wiki toolbar actions are intentionally mounted only in compact mode.
 await page.setViewportSize({width:580,height:870});
 await page.goto(base+'/records/'+picker.id+'?mode=visual',{waitUntil:'domcontentloaded'});
 const editor=page.locator('.tiptap');await editor.waitFor();
 await page.getByRole('button',{name:'嵌入 Wiki 文档'}).click();
 await page.keyboard.type(targetName.slice(0,-3));
 await page.getByRole('listbox',{name:'引用文档'}).waitFor({state:'visible',timeout:20000});
 const option=page.getByRole('option',{name:new RegExp('RMD 章节源 '+suffix)});
 await option.first().waitFor();
 await option.first().click();
 await editor.locator('.wiki-editor-embed').waitFor();
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(async id=>{
  const r=await fetch('/api/records/'+id);
  return r.ok&&(await r.json()).content.includes('::: embed id:');
 },picker.id,{timeout:23000});
 const saved=(await api('/records/'+picker.id)).body.content;
 assert.ok(saved.includes('::: embed id:'+target.id+' :::'),'new picker must emit RMD syntax '+saved);
 assert.ok(!saved.includes('{{embed:'));
 const pickRefs=await api('/records/'+picker.id+'/wiki-references');
 assert.equal(pickRefs.body.items.length,1);
 assert.equal(pickRefs.body.items[0].targetId,target.id);
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS RMD Wiki graph, backlink, preview heading and paragraph section, visual, source, picker, save');
}finally{await browser.close().catch(()=>{});}
