import React,{useState} from 'react';
import type {Editor} from '@tiptap/core';
import type {ReactNode} from 'react';
import {ContextMenu,type ContextMenuOption} from '@astryxdesign/core/ContextMenu';
import {blockMenuItems,inlineContextItems,runWithTextSelection} from './editor-command-menu';
import {editableBlockFromDocumentPosition} from './editor-block-actions';
import {inlineCommandsByGroup} from './editor-inline-commands';
import './editor-context-menu.css';

/** Desktop-only context menu. Mobile never wraps ProseMirror in ContextMenu:
 * Astryx's touch-long-press intentionally suppresses native text selection,
 * while Recalloom must keep the OS text handles and callout on touch.
 */
export function EditorContextMenu({editor,onEditBlock,children}:{
 editor:Editor;onEditBlock:(pos:number)=>void;children:ReactNode;
}){
 const [items,setItems]=useState<ContextMenuOption[]>([]);
 const createMenu=(event:React.MouseEvent<HTMLElement>)=>{
  const pos=event.detail===0&&event.clientX===0&&event.clientY===0?
   editor.state.selection.from:
   editor.view.posAtCoords({left:event.clientX,top:event.clientY})?.pos??editor.state.selection.from;
  const current=editableBlockFromDocumentPosition(editor,pos);
  const selection={from:editor.state.selection.from,to:editor.state.selection.to};
  const selected=!editor.state.selection.empty;
  const selectionActions:ContextMenuOption[]=selected?[
   ...inlineContextItems(editor),
   {id:'rmd-inline-sketch',label:'手绘标记',items:inlineCommandsByGroup('hand-drawn').map(command=>({
    id:command.id,label:command.title,isDisabled:!command.isAvailable(editor),
    onClick:()=>{runWithTextSelection(editor,selection,()=>command.run(editor));}
   }))},
   {id:'rmd-inline-components',label:'行内组件',items:inlineCommandsByGroup('inline-component').map(command=>({
    id:command.id,label:command.title,isDisabled:!command.isAvailable(editor),
    onClick:()=>{runWithTextSelection(editor,selection,()=>command.run(editor));}
   }))},
   {type:'divider'}
  ]:[];
  setItems([
   ...selectionActions,
   ...(current?blockMenuItems({editor,pos:current.pos,onEditBlock}):[
    {id:'undo',label:'撤销',onClick:()=>{editor.chain().focus().undo().run();}},
    {id:'redo',label:'重做',onClick:()=>{editor.chain().focus().redo().run();}}
   ])
  ]);
 };
 return <div className="rk-editor-context-area">
  <ContextMenu label="编辑器右键菜单" menuWidth={240} size="sm" presentation="popover"
   items={items} onContextMenu={createMenu}>
   {children}
  </ContextMenu>
 </div>;
}
