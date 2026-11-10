/** Single command model for the RMD inline syntax family.
 * The RMD schema enumerates the syntax; this layer adds editor behavior and UI
 * metadata. Toolbars, slash actions, context menus and block handles should
 * call the same functions rather than reimplementing Tiptap transactions.
 */
import type {Editor} from '@tiptap/core';
import {RMD_REGISTRY} from '../rmd-schema';
import {isSketchKind} from '../sketch-geometry';

export type InlineCommandGroup='semantic'|'hand-drawn'|'inline-component';
export type InlineCommand={
 id:string;
 syntax:string;
 title:string;
 description:string;
 group:InlineCommandGroup;
 keywords:readonly string[];
 isAvailable:(editor:Editor)=>boolean;
 isActive:(editor:Editor)=>boolean;
 run:(editor:Editor)=>boolean;
};
const names:Record<string,{title:string;description:string;keywords:string[];group:InlineCommandGroup}>={
 mark:{title:'高亮',description:'语义背景高亮（RMD Mark，非手绘荧光笔）',keywords:['mark','重点','语义'],group:'semantic'},
 highlight:{title:'荧光笔',description:'默认黄色手绘荧光笔（RMD highlight）',keywords:['highlight','荧光笔'],group:'hand-drawn'},
 circle:{title:'手绘圈选',description:'用不规则笔迹圈出选中内容',keywords:['circle','圈选'],group:'hand-drawn'},
 box:{title:'手绘方框',description:'在选中内容周围绘制方框',keywords:['box','方框'],group:'hand-drawn'},
 bracket:{title:'手绘括号',description:'用左右括号强调关联内容',keywords:['bracket','括号'],group:'hand-drawn'},
 underline:{title:'手绘下划线',description:'手绘笔迹，不替换普通 HTML 下划线',keywords:['underline','手绘下划线'],group:'hand-drawn'},
 'double-underline':{title:'手绘双下划线',description:'两条轻微不规则的笔迹',keywords:['double','双下划线'],group:'hand-drawn'},
 'dotted-underline':{title:'手绘点状下划线',description:'点状笔迹用于弱强调',keywords:['dotted','点线'],group:'hand-drawn'},
 wavy:{title:'手绘波浪线',description:'以波浪笔迹提醒重点',keywords:['wavy','波浪'],group:'hand-drawn'},
 arrow:{title:'手绘箭头',description:'在内容下方绘制指向箭头',keywords:['arrow','箭头'],group:'hand-drawn'},
 badge:{title:'徽标 Badge',description:'插入可继续编辑的行内状态标签',keywords:['badge','徽标'],group:'inline-component'},
 tooltip:{title:'提示 Tooltip',description:'插入带描述的可编辑术语',keywords:['tooltip','提示'],group:'inline-component'},
 abbr:{title:'缩写 Abbr',description:'插入带完整释义的缩写',keywords:['abbr','缩写'],group:'inline-component'},
 kbd:{title:'键帽 Kbd',description:'将快捷键显示为键帽',keywords:['kbd','键帽'],group:'inline-component'},
 cloze:{title:'挖空 Cloze',description:'创建可揭示答案的复习挖空',keywords:['cloze','挖空'],group:'inline-component'}
};
const inlineNode:Record<string,{type:string;placeholder:string;attrs?:Record<string,string>}> = {
 badge:{type:'richBadge',placeholder:'状态',attrs:{variant:'neutral'}},
 tooltip:{type:'richTooltip',placeholder:'术语',attrs:{content:'提示说明'}},
 abbr:{type:'richAbbr',placeholder:'缩写',attrs:{title:'完整名称'}},
 kbd:{type:'richKbd',placeholder:'Ctrl'},
 cloze:{type:'richCloze',placeholder:'答案',attrs:{hint:'显示答案'}}
};
const allNames=RMD_REGISTRY.components.filter(c=>c.type==='inline').map(c=>c.name);
const missing=allNames.filter(name=>!names[name]);
if(missing.length)throw new Error('RMD inline syntax needs editor commands: '+missing.join(', '));

export function canUseInlineRmdCommand(editor:Editor,syntax:string){
 if(!names[syntax]||editor.isActive('codeBlock'))return false;
 const selection=editor.state.selection;
 if(syntax in inlineNode){
  // Rich inline NodeViews have content:text*. A selection that crosses
  // paragraphs cannot be replaced with a single valid inline node.
  if(!selection.$from.sameParent(selection.$to))return false;
  // A rich inline node cannot contain another atom or a KaTeX/Wiki node.
  // Replacing such a selection with plain text would silently destroy data.
  if(!selection.empty){
   let nonTextInline=false;
   editor.state.doc.nodesBetween(selection.from,selection.to,node=>{
    if(node.isInline&&!node.isText)nonTextInline=true;
   });
   if(nonTextInline)return false;
  }
 }
 return true;
}
export function runInlineRmdCommand(editor:Editor,syntax:string):boolean{
 if(!canUseInlineRmdCommand(editor,syntax))return false;
 if(syntax==='mark')return editor.chain().focus().toggleMark('rmdMark').run();
 if(isSketchKind(syntax))return editor.chain().focus().toggleMark('rmdSketch',{kind:syntax}).run();
 const node=inlineNode[syntax];
 if(!node)return false;
 const selection=editor.state.selection;
 const selected=selection.empty?'':editor.state.doc.textBetween(selection.from,selection.to,' ').trim();
 const text=(selected||node.placeholder).slice(0,200);
 return editor.chain().focus().insertContent({
  type:node.type,
  attrs:node.attrs??{},
  content:[{type:'text',text}]
 }).run();
}
export const inlineRmdCommands:readonly InlineCommand[]=allNames.map(syntax=>{
 const meta=names[syntax]!;
 return {
  id:'inline:'+syntax,syntax,title:meta.title,description:meta.description,
  group:meta.group,keywords:meta.keywords,
  isAvailable:(editor:Editor)=>canUseInlineRmdCommand(editor,syntax),
  isActive:(editor:Editor)=>syntax==='mark'?editor.isActive('rmdMark'):
   isSketchKind(syntax)?editor.isActive('rmdSketch',{kind:syntax}):
   editor.isActive(inlineNode[syntax]?.type??''),
  run:(editor:Editor)=>runInlineRmdCommand(editor,syntax)
 };
});
export function inlineCommandsByGroup(group:InlineCommandGroup):readonly InlineCommand[]{
 return inlineRmdCommands.filter(command=>command.group===group);
}
