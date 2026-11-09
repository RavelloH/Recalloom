import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';

const base=process.env.RECALLOOM_TEST_BASE||'http://127.0.0.1:8805';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(executablePath);
const secret=readFileSync('.dev.vars','utf8').match(/MCP_AUTH_SECRET\s*=\s*([^ \r\n]+)/)?.[1];
assert.ok(secret);
const registry=JSON.parse(readFileSync('src/rmd/registry.json','utf8'));
const comps=registry.components;
const by=(type,name)=>comps.find(x=>x.type===type&&x.name===name)?.example??'';
const sections=items=>items.map(([name,content],index)=>'## '+(index+1)+' '+name+'\n\n'+content).join('\n\n');
const cases={
 inline:sections([
  ...comps.filter(c=>c.type==='inline').map(c=>[c.name,'示例文字 '+c.example+' 结束。']),
  ['comment','这是可视化注释 %% 仅可视化 %% 普通正文。'],
  ['reviews','原文 {++增加++} {--删除--} {~~旧~>新~~} {==高亮==} {>>审阅<<} 结束。'],
  ['format','**加粗** *斜体* ~~删除~~ <u>下划线</u> <sup>上标</sup> <sub>下标</sub>']
 ]),
 callouts:sections([
  ...comps.filter(c=>c.type==='block'&&['note','info','tip','success','warning','danger','example','question'].includes(c.name)).map(c=>[c.name,c.example]),
  ['mark-math',by('block','mark')],['highlight',by('block','highlight')],
  ['details',by('block','details')],['comment','::: comment\n\n可视化显示注释。\n\n:::']
 ]),
 structured:sections([
  ['tabs',[':::: tabs','','::: tab 第一个标签','','第一个面板，有 **粗体** 和 $E=mc^2$。','',':::','','::: tab 第二个标签','','第二个面板，带有列表：','','- A','- B','',':::','','::::'].join('\n')],
  ['chat',[':::: chat','','::: message User | sender=user','','问题来了。','',':::','','::: message Assistant | sender=assistant','','回复，包括 **强调**。','',':::','','::::'].join('\n')],
  ['flashcard',by('block','flashcard')],
  ['glossary',[':::: glossary','','::: definition AST','','抽象语法树。','',':::','','::: definition CAS','','比较与交换。','',':::','','::::'].join('\n')],
  ['embed',by('leaf','embed')],['link-card',by('leaf','link-card')]
 ]),
 blocks:sections([
  ...registry.nodes.map(n=>[n.node,n.example]),
  ['commonmark',['> 引用一','>','> 引用二','','1. 一级','2. 二级','','- [x] 完成','- [ ] 计划','','行内数学 $U=IR$。','','脚注[^audit]。','','[^audit]: 脚注内容。'].join('\n')],
  ['math','$$\n\\frac{\\partial u}{\\partial t}=\\nabla^2 u\n$$'],
  ['mermaid','~~~mermaid\nflowchart LR\n A[Start] --> B[Finish]\n~~~']
 ])
};
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1220,height:850},deviceScaleFactor:1});
page.setDefaultTimeout(23000);
const errors=[];page.on('pageerror',err=>errors.push(err.message));
const api=(path,body,method='GET')=>page.evaluate(async({path,body,method})=>{
 const res=await fetch('/api'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 return {status:res.status,body:await res.json().catch(()=>null)};
},{path,body,method});
const measure=()=>page.evaluate(()=>{
 const root=document.querySelector('.editor-view .tiptap, .editor-view .markdown-preview');
 const selectors={
 heading:'h1,h2,h3,h4,h5,h6',paragraph:'p',callout:'.rk-rmd-callout',
 mark:'.rk-rmd-block-mark',strong:'strong',inlineMark:'mark',
 badge:'.astryx-badge,.rk-inline-badge',tooltip:'.rk-tooltip-inline',
 kbd:'.rk-keycap',cloze:'.rk-cloze-trigger,.rk-cloze-reveal',
 tabs:'.rk-tabs-edit,.rk-tabs-preview',tabPanels:'.rk-tab-edit,.rk-tabs-read-panel',
 flashcard:'.rk-flashcard',flashcardBack:'.rk-flashcard-back',
 glossary:'.rk-glossary-edit,.rk-glossary-read',definition:'.rk-definition-edit,.rk-definition-read',
 message:'.astryx-chat-message',table:'table',figure:'figure',image:'img',
 caption:'figcaption,.rk-table-caption,.rk-table-caption-read',
 blockMath:'.katex-display',linkcard:'.rk-link-card',
 code:'pre',comments:'.rk-comment,.rk-rmd-comment-block',
 footnotes:'[data-footnote-ref],[data-footnotes]',attrs:'.rk-rmd-attrs-decoration',
 critics:'.rk-critic,.rk-critic-display'
 };
 const style=e=>{
  const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
  return {width:Math.round(r.width*10)/10,height:Math.round(r.height*10)/10,x:Math.round(r.x*10)/10,
   display:cs.display,visible:cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0,
   fontSize:cs.fontSize,lineHeight:cs.lineHeight,color:cs.color,bg:cs.backgroundColor,
   marginTop:cs.marginTop,marginBottom:cs.marginBottom,padding:cs.padding,border:cs.borderRadius,
   text:(e.innerText??e.textContent??'').slice(0,110)};
 };
 const details={};
 for(const [key,sel] of Object.entries(selectors)){
  const nodes=[...(root?.querySelectorAll(sel)??[])],samples=nodes.map(style);
  details[key]={count:nodes.length,visible:samples.filter(s=>s.visible).length,samples:samples.slice(0,9)};
 }
 return {details,documentText:root?.innerText?.slice(0,15000),
   htmlScrollWidth:document.documentElement.scrollWidth,
   rootWidth:root?.getBoundingClientRect().width,docHeight:root?.getBoundingClientRect().height};
});
try{
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('输入 MCP_AUTH_SECRET').fill(secret);
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(base+'/',{timeout:30000});
 const report={timestamp:new Date().toISOString(),git:'origin/main 1320cc0',results:{},errors};
 mkdirSync('tmp/parity-screens',{recursive:true});
 for(const [name,content] of Object.entries(cases)){
  const created=await api('/records',{name:'ParitAudit-'+name+'-'+Date.now()+'.md',kind:'document',content},'POST');
  assert.equal(created.status,201,JSON.stringify(created));
  const id=created.body.id;
  report.results[name]={id,sourceBytes:content.length};
  for(const mode of ['visual','preview']){
   await page.goto(base+'/records/'+id+'?mode='+mode,{waitUntil:'domcontentloaded'});
   await page.locator(mode==='visual'?'.editor-view .tiptap':'.editor-view .markdown-preview').waitFor();
   await page.waitForTimeout(600);
   const info=await measure();
   report.results[name][mode]=info;
   await page.screenshot({path:'tmp/parity-screens/'+name+'-'+mode+'.png',fullPage:true});
   console.log('CASE',name,mode,'counts',Object.fromEntries(Object.entries(info.details).map(([key,v])=>[key,v.visible])),'height',Math.round(info.docHeight));
  }
  const saved=await api('/records/'+id);
  report.results[name].bodyUnchanged=(saved.body?.content??'')===content;
 }
 writeFileSync('tmp/rmd-parity-audit.json',JSON.stringify(report,null,2));
 console.log('AUDIT_RESULTS tmp/rmd-parity-audit.json','JS_ERRORS',errors.length);
}finally{await browser.close().catch(()=>{});}
