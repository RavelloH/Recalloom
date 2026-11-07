import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchTestBrowser,testOrigin} from './local-browser.mjs';

// Runs only against a local Worker. The fixtures are taken directly from
// the published help pages, not a separately maintained copy of the syntax.
assert.match(testOrigin,/^http:\/\/127\.0\.0\.1:\d+$/);
const secretLine=readFileSync('.dev.vars','utf8')
 .split(/\r?\n/).find(line=>/^\s*MCP_AUTH_SECRET\s*=/.test(line));
const secret=secretLine?.slice(secretLine.indexOf('=')+1).trim().replace(/^["']|["']$/g,'');
assert.ok(secret,'A local .dev.vars MCP_AUTH_SECRET is required');
function examples(topic){
 const body=readFileSync('src/help/'+topic+'.md','utf8').replace(/\r\n/g,'\n');
 return [...body.matchAll(/~~~markdown\n([\s\S]*?)\n~~~/g)].map(match=>match[1]);
}
const math=examples('math');
const wiki=examples('wiki');
assert.equal(math.length,4);
assert.equal(wiki.length,2);
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
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(testOrigin+'/',{timeout:30000});
 const suffix=String(Date.now());
 const targetName='Help Reference '+suffix+'.md';
 const target=must(await api('/records','POST',{
  name:targetName,kind:'document',
  content:'# 示例引用文档\n\n## 空载试验\n\n空载试验中的目标正文。\n\n## 总结\n\n用于检查章节嵌入。'
 }),201);
 const referenceId='11111111-1111-4111-8111-111111111111';
 const references=wiki.map(block=>block
  .replaceAll(referenceId,target.id)
  .replaceAll('/Projects/电力系统分析/核心知识.md','/'+targetName));
 const content=['# 帮助文档实际验证','',...math.flatMap(block=>[block,'']),
  '## WikiLink 与嵌入','',...references.flatMap(block=>[block,''])].join('\n');
 const source=must(await api('/records','POST',{
  name:'Help Examples '+suffix+'.md',kind:'document',content
 }),201);
 // The visual editor is the single reading and editing surface.
 await page.goto(testOrigin+'/records/'+source.id+'?mode=visual',{waitUntil:'networkidle'});
 await page.locator('.tiptap .rk-highlighted-block-math').first().waitFor({timeout:20000});
 await page.locator('.wiki-editor-embed').first().waitFor({timeout:20000});
 await page.getByText('空载试验中的目标正文。',{exact:false}).first().waitFor({timeout:20000});
 assert.equal(await page.locator('.tiptap .rk-highlighted-block-math').count(),1);
 assert.equal(await page.locator('.tiptap .wiki-editor-chip').count(),3);
 assert.equal(await page.locator('.tiptap .wiki-editor-embed').count(),3);
 assert.ok(await page.locator('.tiptap mark [data-type="inline-math"]').count()>=1);
 assert.ok(await page.locator('.tiptap [data-type="block-math"] .katex').count()>=2);
 const visible=await page.locator('.tiptap .rk-highlighted-block-math').evaluate(node=>{
  const inner=node.querySelector('.block-math-inner');
  const a=node.getBoundingClientRect(),b=inner?.getBoundingClientRect();
  return {rendered:!!inner,outerHeight:a.height,mathHeight:b?.height??0};
 });
 assert.ok(visible.rendered&&visible.outerHeight>=visible.mathHeight-3,
  'visual highlighted display block encompasses the KaTeX box');
 assert.equal(await page.getByRole('button',{name:'预览'}).count(),0);
 await page.locator('.tiptap h1').first().click();
 await page.keyboard.press('End');
 await page.keyboard.type(' edited');
 await page.getByRole('button',{name:'保存'}).click();
 await page.waitForFunction(async id=>{
  const response=await fetch('/api/records/'+id);
  return response.ok&&(await response.json()).content.includes(' edited');
 },source.id,{timeout:20000});
 const updated=must(await api('/records/'+source.id),200);
 assert.match(updated.content,/<mark>\s*\n\$\$/);
 assert.ok(updated.content.includes('<mark>$\\frac{\\Delta P_s U_N^2}{S_N^2}$</mark>'),
  'the published highlighted inline fraction survives a real edit');
 assert.ok(updated.content.includes('[[id:'+target.id+'#空载试验|变压器空载试验]]'));
 assert.ok(updated.content.includes('{{embed:id:'+target.id+'#空载试验}}'));
 assert.ok(updated.content.includes('{{embed:/'+targetName+'#总结}}'));
 const linked=must(await api('/records/'+source.id+'/wiki-references'),200);
 assert.equal(linked.items.length,6);
 assert.ok(linked.items.every(item=>item.targetId===target.id));
 assert.deepEqual(errors,[]);
 console.log('PASS: real help Markdown visual editing, math highlight layout and Wiki projection');
}finally{await browser.close()}
