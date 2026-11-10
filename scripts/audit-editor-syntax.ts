/** Authoritative UI coverage audit for RMD and core Markdown.
 * Import the actual editor command registries. Do not infer coverage from
 * stale source files or hard-coded lists of 42 names.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RMD_REGISTRY} from '../web/src/rmd-schema';
import {inlineRmdCommands,inlineCommandsByGroup} from '../web/src/tiptap/editor-inline-commands';
import {extraBlockCommands} from '../web/src/tiptap/editor-block-commands';
import {slashCommands} from '../web/src/tiptap/slash-commands';
import {isRmdAttrsEditable,rmdAttrNodeMapping} from '../web/src/tiptap/rmd-schema-attrs-model';

type Row={syntax:string;type:string;surface:string;command:string;context?:string};
const toolbar=fs.readFileSync('web/src/visual-editor.tsx','utf8');
const panel=fs.readFileSync('web/src/tiptap/block-editor-panel.tsx','utf8');
const ids=slashCommands.map(c=>c.id);
assert.equal(new Set(ids).size,ids.length,'duplicate slash command IDs');
const slash=new Set(ids);
const rows:Row[]=[];
const inline=RMD_REGISTRY.components.filter(c=>c.type==='inline');
const inlineMap=new Map(inlineRmdCommands.map(command=>[command.syntax,command]));
assert.equal(inlineMap.size,inline.length,'all inline commands must be unique and registered');
for(const spec of inline){
 const command=inlineMap.get(spec.name);
 assert.ok(command,'missing inline command '+spec.name);
 const group=command.group;
 const visible=group==='semantic'?toolbar.includes("runInlineRmdCommand(editor,'mark')"):
  toolbar.includes("inlineCommandsByGroup('"+group+"')");
 assert.ok(visible,'inline command not rendered in selection and mobile toolbar: '+spec.name);
 rows.push({syntax:spec.name,type:'inline',surface:group==='semantic'?'format toggle':'toolbar '+group,command:command.id});
}
for(const group of ['semantic','hand-drawn','inline-component'] as const)
 assert.equal(inlineCommandsByGroup(group).length,inline.filter(x=>inlineMap.get(x.name)?.group===group).length,'group mismatch: '+group);
const blocks=RMD_REGISTRY.components.filter(c=>c.type==='block');
const extraByName=new Map(extraBlockCommands.map(command=>[command.syntax,command]));
const predefined:Readonly<Record<string,string>>={details:'details',tabs:'tabs',chat:'chat',flashcard:'flashcard',glossary:'glossary'};
for(const spec of blocks){
 const id=predefined[spec.name]??'rmd-block:'+spec.name;
 assert.ok(slash.has(id),'missing slash entry for block '+spec.name);
 const extra=extraByName.get(spec.name);
 if(!predefined[spec.name]){
  assert.ok(extra,'missing block executor '+spec.name);
  if(spec.allowedParents?.length){
   assert.equal(extra.category,'child','nested block must have contextual insertion: '+spec.name);
   assert.equal(extra.parent,spec.allowedParents[0],'wrong parent constraint: '+spec.name);
   assert.ok(typeof extra.isAvailable==='function','child insertion needs availability guard: '+spec.name);
  }
 }
 rows.push({syntax:spec.name,type:'block',surface:'slash',command:id,
  ...(spec.allowedParents?.length?{context:'parent:'+spec.allowedParents.join('|')}:{} )});
}
for(const command of extraBlockCommands)
 assert.ok(blocks.some(c=>c.name===command.syntax),'unregistered extra block command '+command.syntax);
const leafMap:Readonly<Record<string,string>>={embed:'wiki-embed','link-card':'link-card'};
const leaf=RMD_REGISTRY.components.filter(c=>c.type==='leaf');
for(const spec of leaf){
 const id=leafMap[spec.name];
 assert.ok(id&&slash.has(id),'leaf missing picker/insert action: '+spec.name);
 rows.push({syntax:spec.name,type:'leaf',surface:'slash',command:id});
}
const nodeEntries:Readonly<Record<string,readonly string[]>>={
 heading:['h1','h2','h3'],paragraph:['text'],image:['image'],math:['block-math','inline-math'],table:['table'],code:['code']
};
assert.ok(panel.includes('<RmdSchemaAttributeFields'),'shared block panel must render schema-driven @ attrs');
for(const spec of RMD_REGISTRY.nodes){
 const matching=nodeEntries[spec.node];
 assert.ok(matching,'node family not audited: '+spec.node);
 for(const id of matching)assert.ok(slash.has(id),'missing standard block action '+spec.node+': '+id);
 const mapping=Object.entries(rmdAttrNodeMapping).find(([,value])=>value.node===spec.node);
 assert.ok(mapping,'missing schema attribute mapping for '+spec.node);
 assert.ok(isRmdAttrsEditable(mapping[0]),'node attributes not reachable: '+spec.node);
}
const compact=toolbar.split('{compact&&<div className="wysiwyg-toolbar"')[1]?.split('{!compact&&<BubbleMenu')[0]??'';
const desktop=toolbar.split('{!compact&&<BubbleMenu')[1]?.split('<div hidden={!((active?.table')[0]??'';
const standard=['粗体','斜体','下划线','删除线','行内代码','上标','下标'];
const shared=toolbar.split('const inlineMarks=<>')[1]?.split('</>;')[0]??'';
const sharedMarks=new Set(['粗体','斜体','下划线','删除线']);
for(const title of standard){
 const symbol="toggle('"+title+"'";
 const sharedEntry=sharedMarks.has(title);
 assert.ok(sharedEntry?compact.includes('{inlineMarks}')&&shared.includes(symbol):compact.includes(symbol),
  'mobile toolbar missing standard inline mark '+title);
 const desktopMoreEntry=title==='上标'?"id:'inline-more-super'":title==='下标'?"id:'inline-more-sub'":null;
 assert.ok(sharedEntry?desktop.includes('{inlineMarks}')&&shared.includes(symbol):
  desktop.includes(symbol)||!!desktopMoreEntry&&desktop.includes('{inlineMarks}')&&shared.includes(desktopMoreEntry),
  'desktop selection toolbar missing '+title);
}
for(const action of ['插入或编辑链接','引用 Wiki 文档','插入行内公式'])
 assert.ok(compact.includes("action('"+action+"'"),'mobile toolbar missing core action '+action);
assert.ok(slash.has('footnote'),'GFM footnote reference must retain an insertion entry');
const summary={
 schema:{inline:inline.length,block:blocks.length,leaf:leaf.length,total:rows.length,nodes:RMD_REGISTRY.nodes.length},
 entryPoints:{toolbar:inline.length,slashBlocks:blocks.length,slashLeaf:leaf.length,contextualChildren:rows.filter(row=>row.context).length},
 standardInlineToolbar:standard,
 notices:['CriticMarkup and raw HTML are not RMD registry components; this audit does not promise standalone toolbar buttons for them.']
};
if(process.argv.includes('--json'))console.log(JSON.stringify({summary,rows},null,2));
else {
 console.log('RMD 可视化语法入口审计通过');
 console.log('RMD 行内 '+inline.length+' / '+inline.length+'（工具栏），块级 '+blocks.length+' / '+blocks.length+'（斜杠菜单，含 '+summary.entryPoints.contextualChildren+' 个受父容器约束的子块），叶子 '+leaf.length+' / '+leaf.length+'（斜杠菜单）。');
 console.log('六类 Markdown @ attrs 均映射到统一 Drawer。移动及桌面标准行内格式：'+standard.join('、')+'。');
 console.log('备注：CriticMarkup 等非注册表扩展不计入以上 42 种 RMD 覆盖率。');
}
