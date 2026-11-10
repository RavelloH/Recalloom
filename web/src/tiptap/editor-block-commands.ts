/** RMD block insertion commands. The registry remains the syntax authority.
 * This module supplies editor defaults and safe context-sensitive insertion.
 */
import type {Editor,JSONContent} from '@tiptap/core';
import {getRmdSchema} from '../rmd-schema';
import {SKETCH_BLOCK_KINDS} from '../sketch-geometry';

const calloutLabels:Readonly<Record<string,{title:string;name:string}>>={
 note:{title:'备注',name:'备注'},
 info:{title:'信息',name:'信息'},
 tip:{title:'技巧',name:'提示'},
 success:{title:'成功',name:'成功'},
 warning:{title:'警告',name:'注意'},
 danger:{title:'危险',name:'危险'},
 example:{title:'示例',name:'示例'},
 question:{title:'问题',name:'问题'}
};
export type RmdBlockInsertion={
 syntax:string;
 title:string;
 keywords:readonly string[];
 category:'callout'|'annotation'|'child';
 parent?:string;
 run:(editor:Editor)=>boolean;
 isAvailable:(editor:Editor)=>boolean;
};
const paragraph=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
const block=(kind:string,title:string,content:JSONContent[]= [paragraph('在这里直接编辑内容')]):JSONContent=>({
 type:'richContainer',attrs:{kind,title},content
});
function canInsertBlock(editor:Editor):boolean{
 // Nested block insertions are allowed in prose/containers, but not code cells.
 return !editor.isActive('codeBlock')&&!editor.isActive('table');
}
export function insertRmdBlock(editor:Editor,syntax:string):boolean{
 if(!getRmdSchema('block',syntax)||!canInsertBlock(editor))return false;
 if(['tab','message','front','back','definition'].includes(syntax))
  return insertRmdChild(editor,syntax);
 const header=calloutLabels[syntax];
 const node=block(syntax,header?.name??'');
 return editor.chain().focus().insertContent(node).run();
}

/** Returns a legal parent and the exact position at which a new child may be
 * inserted. Never place the child inside an existing sibling's paragraph.
 */
export function insertionForRmdChild(editor:Editor,syntax:string):{pos:number;parent:string}|null{
 const schema=getRmdSchema('block',syntax);
 const parent=schema?.allowedParents?.[0];
 if(!parent||!editor.state?.selection?.empty)return null;
 const selection=editor.state.selection.$from;
 for(let depth=selection.depth;depth>=0;depth--){
  const node=selection.node(depth);
  if(node.type.name!=='richContainer'||node.attrs.kind!==parent)continue;
  if(syntax==='front'||syntax==='back'){
   // A flashcard must have one front and one back, in schema order.
   const kinds=Array.from({length:node.childCount},(_,i)=>node.child(i).attrs.kind);
   if(kinds.includes(syntax))return null;
   if(syntax==='front'){
    const backIndex=kinds.indexOf('back');
    if(backIndex>=0){
     let pos=selection.start(depth);
     for(let index=0;index<backIndex;index++)pos+=node.child(index).nodeSize;
     return {pos,parent};
    }
   }
  }
  return {pos:selection.end(depth),parent};
 }
 return null;
}
export function insertRmdChild(editor:Editor,syntax:string):boolean{
 const insertion=insertionForRmdChild(editor,syntax);
 if(!insertion)return false;
 const titles:Readonly<Record<string,string>>={tab:'新标签',message:'Agent',front:'问题',back:'答案',definition:'新术语'};
 const node=block(syntax,titles[syntax]??'', [paragraph('在这里直接编辑内容')]);
 if(syntax==='message')node.attrs={...node.attrs,sender:'assistant'};
 return editor.chain().focus().insertContentAt(insertion.pos,node).run();
}
export const extraBlockCommands:readonly RmdBlockInsertion[]=[
 ...Object.entries(calloutLabels).map(([syntax,item]):RmdBlockInsertion=>({
  syntax,title:item.title+' Callout',keywords:[syntax,item.title,'callout','提示'],
  category:'callout',isAvailable:canInsertBlock,run:editor=>insertRmdBlock(editor,syntax)
 })),
 ...['mark',...SKETCH_BLOCK_KINDS].map((syntax):RmdBlockInsertion=>({
  syntax,title:syntax==='mark'?'块级语义 Mark':'块级手绘 '+({
   highlight:'荧光笔',circle:'圈选',box:'方框',bracket:'括号',underline:'下划线',
   'double-underline':'双下划线'
  } as Record<string,string>)[syntax],
  keywords:[syntax,'块级','手绘','mark'],category:'annotation',
  isAvailable:canInsertBlock,run:editor=>insertRmdBlock(editor,syntax)
 })),
 ...['tab','message','front','back','definition'].map((syntax):RmdBlockInsertion=>({
  syntax,title:({tab:'添加标签页',message:'添加聊天消息',front:'添加闪卡正面',back:'添加闪卡背面',definition:'添加术语定义'} as Record<string,string>)[syntax]!,
  keywords:[syntax,'子块','添加'],category:'child',
  parent:getRmdSchema('block',syntax)?.allowedParents?.[0],
  isAvailable:editor=>insertionForRmdChild(editor,syntax)!==null,
  run:editor=>insertRmdChild(editor,syntax)
 }))
];
for(const entry of extraBlockCommands)
 if(!getRmdSchema('block',entry.syntax))throw new Error('Unregistered RMD block command '+entry.syntax);
