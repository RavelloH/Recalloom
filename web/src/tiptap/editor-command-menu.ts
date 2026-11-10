/** Shared block action list for the grab handle and the desktop context menu.
 * The actual mutations are implemented once in editor-block-actions.ts.
 */
import type {Editor} from '@tiptap/core';
import type {DropdownMenuOption} from '@astryxdesign/core/DropdownMenu';
import {serializeRmdBlock} from '../rmd-serialize';
import {blockCanDelete,blockCanDuplicate,blockCanReorder,blockSiblings,duplicateBlock,editableBlockAt,moveBlockBy,removeBlock} from './editor-block-actions';
import {runInlineRmdCommand} from './editor-inline-commands';

export type BlockMenuOptions={
 editor:Editor;
 pos:number;
 onEditBlock:(pos:number)=>void;
 onAction?:()=>void;
};
export function blockMenuItems({editor,pos,onEditBlock,onAction}:BlockMenuOptions):DropdownMenuOption[]{
 const current=editableBlockAt(editor,pos);
 const siblings=blockSiblings(editor,pos),index=siblings.findIndex(entry=>entry.pos===pos);
 const canMove=blockCanReorder(editor,pos);
 const run=(fn:()=>void)=>()=>{fn();onAction?.();};
 return [
  {id:'edit-block',label:'编辑块',isDisabled:!current,
   onClick:run(()=>onEditBlock(pos))},
  {id:'copy-block-rmd',label:'复制块 RMD 源码',isDisabled:!current,
   onClick:run(()=>{if(current)void navigator.clipboard.writeText(serializeRmdBlock(current.node.toJSON())).catch(()=>undefined);})},
  {type:'divider'},
  {id:'duplicate-block',label:'复制块',isDisabled:!blockCanDuplicate(editor,pos),
   onClick:run(()=>{duplicateBlock(editor,pos);})},
  {id:'move-block-up',label:'上移块',isDisabled:!canMove||index<=0,
   onClick:run(()=>{moveBlockBy(editor,pos,-1);})},
  {id:'move-block-down',label:'下移块',isDisabled:!canMove||index<0||index===siblings.length-1,
   onClick:run(()=>{moveBlockBy(editor,pos,1);})},
  {type:'divider'},
  {id:'remove-block',label:'删除块',variant:'destructive',isDisabled:!blockCanDelete(editor,pos),
   onClick:run(()=>{removeBlock(editor,pos);})}
 ];
}
/** Restore the captured text selection before a context-menu action takes focus. */
export function runWithTextSelection<T>(editor:Editor,range:{from:number;to:number},run:()=>T):T{
 if(range.from<range.to&&range.from>=0&&range.to<=editor.state.doc.content.size)
  editor.commands.setTextSelection(range);
 return run();
}
/** Selection commands share executors with the inline toolbar and RMD menus. */
export function inlineContextItems(editor:Editor){
 const {empty,from,to}=editor.state.selection;
 const range={from,to};
 const selectedText=empty?'':editor.state.doc.textBetween(from,to,' ');
 const action=(run:()=>unknown)=>()=>runWithTextSelection(editor,range,run);
 return [
  {id:'copy-selected-text',label:'复制选中文字',isDisabled:empty,
   onClick:()=>{if(selectedText)void navigator.clipboard.writeText(selectedText).catch(()=>undefined);}},
  {id:'selection-bold',label:'加粗',isDisabled:empty,onClick:action(()=>editor.chain().focus().toggleMark('bold').run())},
  {id:'selection-italic',label:'斜体',isDisabled:empty,onClick:action(()=>editor.chain().focus().toggleMark('italic').run())},
  {id:'selection-underline',label:'普通下划线',isDisabled:empty,onClick:action(()=>editor.chain().focus().toggleMark('underline').run())},
  {id:'selection-strike',label:'删除线',isDisabled:empty,onClick:action(()=>editor.chain().focus().toggleMark('strike').run())},
  {id:'selection-code',label:'行内代码',isDisabled:empty,onClick:action(()=>editor.chain().focus().toggleMark('code').run())},
  {id:'selection-superscript',label:'上标',isDisabled:empty,onClick:action(()=>editor.chain().focus().toggleMark('superscript').run())},
  {id:'selection-subscript',label:'下标',isDisabled:empty,onClick:action(()=>editor.chain().focus().toggleMark('subscript').run())},
  {id:'selection-rmd-mark',label:'语义 Mark',isDisabled:empty,onClick:action(()=>runInlineRmdCommand(editor,'mark'))}
 ];
}
