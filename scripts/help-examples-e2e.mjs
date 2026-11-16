import {readLocalAuthVars} from './local-auth-config.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchTestBrowser,testOrigin} from './local-browser.mjs';

// Runs only against a local Worker. The fixtures are taken directly from
// the published help pages, not a separately maintained copy of the syntax.
assert.match(testOrigin,/^http:\/\/127\.0\.0\.1:\d+$/);
const secretLine=readLocalAuthVars()
 .split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local .dev.vars MCP_AUTH_SECRET is required');
function examples(topic){
 const body=readFileSync('src/help/'+topic+'.md','utf8').replace(/\r\n/g,'\n');
 return [...body.matchAll(/^~~~~markdown\n([\s\S]*?)\n~~~~$/gm)].map(match=>match[1]);
}
const math=examples('math').filter(block=>!block.includes('[[#'));
const wiki=examples('wiki').filter(block=>!block.includes('@ attrs'));
assert.ok(math.length>=3);
assert.ok(wiki.length>=2);
const browser=await launchTestBrowser();
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const api=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{
 const response=await fetch('/api'+path,{
  method,headers:body?{'content-type':'application/json'}:{},
  body:body?JSON.stringify(body):undefined
 });
 return {status:response.status,data:await response.json().catch(()=>null)};
},{path,method,body});
const must=(result,status)=>{assert.equal(result.status,status,JSON.stringify(result.data));return result.data;};
try{
 await page.goto(testOrigin+'/login',{waitUntil:'networkidle'});
 await page.getByPlaceholder('输入授权密钥').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(testOrigin+'/',{timeout:30000});
 const suffix=String(Date.now());
 const targetName='Help Reference '+suffix+'.md';
 const target=must(await api('/records','POST',{
  name:targetName,kind:'document',
  content:'# 示例引用文稿\n\n## 变压器试验 @ attrs transformer-test @\n\n试验中的目标正文。\n\n单独嵌入的段落。 @ attrs important-block @'
 }),201);
 const referenceId='550e8400-e29b-41d4-a716-446655440000';
 const references=wiki.map(block=>block
  .replaceAll(referenceId,target.id)
  .replaceAll('/Projects/电力系统分析/核心知识.md','/'+targetName));
 const content=['# 帮助文档实际验证','',...math.flatMap(block=>[block,'']),
  '## WikiLink 与嵌入','',...references.flatMap(block=>[block,''])].join('\n');
 const source=must(await api('/records','POST',{
  name:'Help Examples '+suffix+'.md',kind:'document',content
 }),201);
 await page.goto(testOrigin+'/records/'+source.id+'?mode=preview',{waitUntil:'networkidle'});
 const preview=page.locator('.markdown-preview').first();
 await preview.locator('.rk-rmd-mark-math-only').first().waitFor({timeout:20000});
 await preview.locator('.wiki-embed').first().waitFor({timeout:20000});
 await preview.getByText('试验中的目标正文。',{exact:false}).first().waitFor({timeout:20000});
 assert.ok(await preview.locator('.katex').count()>=4);
 assert.equal(await preview.locator('.wiki-embed').count(),3);
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'源码',exact:true}).click();
 const editor=page.locator('.cm-content').first();await editor.waitFor();await editor.click();
 await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.type('edited');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(async id=>{
  const response=await fetch('/api/records/'+id);
  return response.ok&&(await response.json()).content.includes('edited');
 },source.id,{timeout:20000});
 const updated=must(await api('/records/'+source.id),200);
 assert.match(updated.content,/::: mark\s*\n\n\$\$/);
 assert.ok(updated.content.includes(':: mark $\\frac{\\Delta P_s U_N^2}{S_N^2}$ ::'),
  'the published highlighted inline fraction survives a real edit');
 assert.ok(updated.content.includes('[[id:'+target.id+'#transformer-test|变压器试验]]'));
 assert.ok(updated.content.includes('::: embed id:'+target.id+'#transformer-test :::'));
 assert.ok(updated.content.includes('::: embed /'+targetName+'#important-block :::'));
 const linked=must(await api('/records/'+source.id+'/wiki-references'),200);
 assert.ok(linked.items.length>=6);
 assert.ok(linked.items.every(item=>item.targetId===target.id));
 assert.deepEqual(errors,[]);
 console.log('PASS: real help Markdown visual editing, math highlight layout and Wiki projection');
}finally{await browser.close()}
