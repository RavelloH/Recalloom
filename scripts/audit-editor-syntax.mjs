/** Audits current RMD menu entry points against the authoritative registry. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const r=JSON.parse(fs.readFileSync('src/rmd/registry.json','utf8'));
const slash=fs.readFileSync('web/src/tiptap/slash-commands.ts','utf8');
const toolbar=fs.readFileSync('web/src/visual-editor.tsx','utf8');
const attrs=fs.readFileSync('web/src/tiptap/rmd-attrs-editor.tsx','utf8');
const ids=new Set([...slash.matchAll(/\bid:'([^']+)'/g)].map(m=>m[1]));
const entries={
 'inline:mark':{surface:'toolbar',id:'rmdMark',proof:()=>toolbar.includes("toggleMark('rmdMark')")},
 'inline:highlight':{surface:'slash',id:'color-highlight'},
 'inline:badge':{surface:'slash',id:'badge'},
 'inline:kbd':{surface:'slash',id:'kbd'},
 'inline:cloze':{surface:'slash',id:'cloze'},
 'block:warning':{surface:'slash',id:'callout'},
 'block:details':{surface:'slash',id:'details'},
 'block:tabs':{surface:'slash',id:'tabs'},
 'block:chat':{surface:'slash',id:'chat'},
 'block:flashcard':{surface:'slash',id:'flashcard'},
 'block:glossary':{surface:'slash',id:'glossary'},
 'leaf:link-card':{surface:'slash',id:'link-card'},
 'block:tab':{surface:'parent-default',id:'tabs'},
 'block:message':{surface:'parent-default',id:'chat'},
 'block:front':{surface:'parent-default',id:'flashcard'},
 'block:back':{surface:'parent-default',id:'flashcard'},
 'block:definition':{surface:'parent-default',id:'glossary'}
};
// The new inline catalog is generated from the RMD registry. Count these
// entries only when BOTH toolbar groups actually render and the shared command
// module is present. P0's original baseline remains in Recalloom history.
const catalogPath='web/src/tiptap/editor-inline-commands.ts';
if(fs.existsSync(catalogPath)){
 const catalog=fs.readFileSync(catalogPath,'utf8');
 const all=RMDInlineSourceCheck(catalog);
 if(all){
  for(const c of r.components.filter(c=>c.type==='inline')){
   const syntax=c.name;
   const group=syntax==='mark'?'semantic':
    ['highlight','circle','box','bracket','underline','double-underline','dotted-underline','wavy','arrow'].includes(syntax)?'hand-drawn':'inline-component';
   const visible=group==='semantic'?toolbar.includes("runInlineRmdCommand(editor,'mark')"):
    toolbar.includes("inlineCommandsByGroup('"+group+"')");
   if(visible)entries['inline:'+syntax]={surface:'toolbar',id:'inline:'+syntax,proof:()=>catalog.includes('const allNames=RMD_REGISTRY.components.filter')};
  }
 }
}
function RMDInlineSourceCheck(source){return source.includes('inlineRmdCommands')&&source.includes('runInlineRmdCommand');}
for(const [name,data] of Object.entries(entries)){
 assert.ok(r.components.some(c=>c.type+':'+c.name===name),'stale registry name '+name);
 assert.ok((data.proof?data.proof():ids.has(data.id)),'stale UI anchor '+name+':'+data.id);
}
const rows=r.components.map(c=>{
 const key=c.type+':'+c.name,entry=entries[key];
 return {key,type:c.type,name:c.name,current:entry?.surface??'missing',
  evidence:entry?.id??'',target:c.type==='inline'?'toolbar / inline submenu':
    c.type==='leaf'?'slash / targeted picker':
    ['tab','message','front','back','definition'].includes(c.name)?'container child menu':'slash / block menu'};
});
const summary=Object.fromEntries(['toolbar','slash','parent-default','missing'].map(surface=>[surface,rows.filter(row=>row.current===surface).length]));
const typeForAttr={math:'blockMath',code:'codeBlock'};
const attrRows=r.nodes.map(n=>({node:n.node,current:attrs.includes((typeForAttr[n.node]??n.node)+':')?'attribute dialog':'verify mapping',target:'shared BlockEditorPanel'}));
if(process.argv.includes('--json'))console.log(JSON.stringify({head:'current',registryTotal:rows.length,summary,rows,attributes:attrRows},null,2));
else {
 console.log('# RMD 可视化命令入口覆盖审计（当前工作树）\n');
 console.log('基线统计：'+rows.length+' 种组件；直接工具栏 '+summary.toolbar+'，直接斜杠 '+summary.slash+'，仅父容器默认内含 '+summary['parent-default']+'，缺少入口 '+summary.missing+'。\n');
 console.log('注意：parent-default 只能在创建父容器时生成预设子块，不代表可随时添加合法子块；slash 中的 inline 项也不代表在格式工具栏可找到。\n');
 console.log('| RMD | 当前入口 | 证据 | 目标入口 |');console.log('|---|---|---|---|');
 for(const x of rows)console.log('| '+x.key+' | '+x.current+' | '+(x.evidence||'—')+' | '+x.target+' |');
 console.log('\n## 块属性\n');
 for(const a of attrRows)console.log('- @ attrs '+a.node+'：'+a.current+' → '+a.target);
 console.log('\n注：标题、列表、表格、段落、普通链接、图片、普通 HTML 下划线、GFM 代码、公式、CriticMarkup 不计入上述 42 种 RMD 组件，仍需要单独验收。');
}
