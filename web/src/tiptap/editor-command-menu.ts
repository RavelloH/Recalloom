/** Shared block action list for the grab handle and the desktop context menu.
 * The actual mutations are implemented once in editor-block-actions.ts.
 */
import type {Editor} from '@tiptap/core';
import type {DropdownMenuOption} from '@astryxdesign/core/DropdownMenu';
import {serializeRmdBlock} from '../rmd-serialize';
import {duplicateBlock,moveBlockBy,removeBlock,topLevelBlockAt,topLevelBlocks} from './editor-block-actions';

export type BlockMenuOptions={
 editor:Editor;
 pos:number;
 onEditBlock:(pos:number)=>void;
 onAction?:()=>void;
};
export function blockMenuItems({editor,pos,onEditBlock,onAction}:BlockMenuOptions):DropdownMenuOption[]{
 const current=topLevelBlockAt(editor,pos);
 const index=topLevelBlocks(editor).findIndex(entry=>entry.pos===pos);
 const run=(fn:()=>void)=>()=>{fn();onAction?.();};
 return [
  {id:'edit-block',label:'编辑块',isDisabled:!current,
   onClick:run(()=>onEditBlock(pos))},
  {id:'copy-block-rmd',label:'复制块 RMD 源码',isDisabled:!current,
   onClick:run(()=>{if(current)void navigator.clipboard.writeText(serializeRmdBlock(current.node.toJSON())).catch(()=>undefined);})},
  {type:'divider'},
  {id:'duplicate-block',label:'复制块',isDisabled:!current,
   onClick:run(()=>{duplicateBlock(editor,pos);})},
  {id:'move-block-up',label:'上移块',isDisabled:index<=0,
   onClick:run(()=>{moveBlockBy(editor,pos,-1);})},
  {id:'move-block-down',label:'下移块',isDisabled:index<0||index===topLevelBlocks(editor).length-1,
   onClick:run(()=>{moveBlockBy(editor,pos,1);})},
  {type:'divider'},
  {id:'remove-block',label:'删除块',variant:'destructive',isDisabled:!current,
   onClick:run(()=>{removeBlock(editor,pos);})}
 ];
}
/** Selection commands share the same executor used by inline toolbar & slash. */
export function inlineContextItems(editor:Editor){
 const {empty,from,to}=editor.state.selection;
 return [
  {id:'copy-selected-text',label:'复制选中文字',
   isDisabled:empty,onClick:()=>{if(!empty)void navigator.clipboard.writeText(editor.state.doc.textBetween(from,to,' ')).catch(()=>undefined);}},
  {id:'selection-bold',label:'加粗',isDisabled:empty,
   onClick:()=>{editor.chain().focus().toggleBold().run();}},
  {id:'selection-italic',label:'斜体',isDisabled:empty,
   onClick:()=>{editor.chain().focus().toggleItalic().run();}},
 ];
}
