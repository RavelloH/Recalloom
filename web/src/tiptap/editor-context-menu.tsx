import React,{useState} from 'react';
import type {Editor} from '@tiptap/core';
import {undo,redo,undoDepth,redoDepth} from '@tiptap/pm/history';
import type {ReactNode} from 'react';
import {ContextMenu,type ContextMenuOption} from '@astryxdesign/core/ContextMenu';
import type {DropdownMenuItemData} from '@astryxdesign/core/DropdownMenu';
import {
 IconArrowBackUp,IconArrowDown,IconArrowForwardUp,IconArrowUp,
 IconBold,IconCode,IconCopy,IconCut,IconDots,IconEdit,IconHighlight,
 IconItalic,IconNotes,IconPencil,IconPlus,IconStrikethrough,
 IconSubscript,IconSuperscript,IconTrash,IconUnderline
} from '@tabler/icons-react';
import {blockMenuItems,inlineContextItems,runWithTextSelection} from './editor-command-menu';
import {editableBlockFromDocumentPosition,isExplicitRmdBlock} from './editor-block-actions';
import {inlineCommandsByGroup} from './editor-inline-commands';
import './editor-context-menu.css';

const icons:Record<string,React.ComponentType<{size?:string|number}>>={
 'copy-selected-text':IconCopy,'cut-selected-text':IconCut,
 'delete-selected-text':IconTrash,'selection-bold':IconBold,
 'selection-italic':IconItalic,'selection-underline':IconUnderline,
 'selection-strike':IconStrikethrough,'selection-code':IconCode,
 'selection-superscript':IconSuperscript,'selection-subscript':IconSubscript,
 'selection-rmd-mark':IconHighlight,
 'rmd-inline-sketch':IconPencil,'rmd-inline-components':IconPlus,
 'edit-block':IconEdit,'copy-block-rmd':IconCopy,'duplicate-block':IconCopy,
 'move-block-up':IconArrowUp,'move-block-down':IconArrowDown,
 'remove-block':IconTrash,'undo':IconArrowBackUp,'redo':IconArrowForwardUp
};
function iconOption(item:DropdownMenuItemData):DropdownMenuItemData{
 const Icon=icons[item.id??'']??IconDots;
 return {...item,icon:<Icon size="var(--rk-icon-sm)"/>};
}
function isAction(item:ContextMenuOption):item is DropdownMenuItemData{
 return !('type' in item);
}
function grouped(title:string,items:ContextMenuOption[]):ContextMenuOption|null{
 const actions=items.filter(isAction).map(iconOption);
 return actions.length?{type:'section',title,items:actions}:null;
}
function getMenuPos(editor:Editor,event:React.MouseEvent<HTMLElement>):number{
 if(event.detail===0&&event.clientX===0&&event.clientY===0)return editor.state.selection.from;
 return editor.view.posAtCoords({left:event.clientX,top:event.clientY})?.pos??editor.state.selection.from;
}
/** Desktop-only: on touch, keep the native OS selection/callout behaviour. */
export function EditorContextMenu({editor,onEditBlock,children}:{
 editor:Editor;onEditBlock:(pos:number)=>void;children:ReactNode;
}){
 const [items,setItems]=useState<ContextMenuOption[]>([]);
 const createMenu=(event:React.MouseEvent<HTMLElement>)=>{
  const position=getMenuPos(editor,event);
  const current=editableBlockFromDocumentPosition(editor,position);
  const explicit=!!current&&isExplicitRmdBlock(editor,current.pos);
  const element=(event.target instanceof Element?
   event.target.closest<HTMLElement>('.rk-directive[data-rk-kind],.rk-rich-link-card,.wiki-editor-embed'):null);
  editor.view.dom.dispatchEvent(new CustomEvent('rk-block-select',{bubbles:true,
   detail:{pos:explicit?current!.pos:null,element}}));
  const selection={from:editor.state.selection.from,to:editor.state.selection.to};
  const selected=!editor.state.selection.empty;
  const formats=selected?inlineContextItems(editor):[];
  const copyActions=formats.filter(item=>isAction(item)&&['copy-selected-text','cut-selected-text','delete-selected-text'].includes(item.id??''));
  const textFormats=formats.filter(item=>isAction(item)&&!['copy-selected-text','cut-selected-text','delete-selected-text'].includes(item.id??''));
  const handDrawn:ContextMenuOption={id:'rmd-inline-sketch',label:'手绘标记',icon:<IconPencil size="var(--rk-icon-sm)"/>,
   items:inlineCommandsByGroup('hand-drawn').map(cmd=>({
    id:cmd.id,label:cmd.title,isDisabled:!cmd.isAvailable(editor),icon:<IconPencil size="var(--rk-icon-sm)"/>,
    onClick:()=>runWithTextSelection(editor,selection,()=>cmd.run(editor))
   }))};
  const components:ContextMenuOption={id:'rmd-inline-components',label:'行内组件',icon:<IconPlus size="var(--rk-icon-sm)"/>,
   items:inlineCommandsByGroup('inline-component').map(cmd=>({
    id:cmd.id,label:cmd.title,isDisabled:!cmd.isAvailable(editor),icon:<IconNotes size="var(--rk-icon-sm)"/>,
    onClick:()=>runWithTextSelection(editor,selection,()=>cmd.run(editor))
   }))};
  const actions=current?blockMenuItems({editor,pos:current.pos,onEditBlock}):[];
  const history=actions.filter(item=>isAction(item)&&['undo','redo'].includes(item.id??''));
  const blockActions=actions.filter(item=>isAction(item)&&!['undo','redo'].includes(item.id??''));
  const fallbackHistory:ContextMenuOption[]=history.length?history:[
   {id:'undo',label:'撤销',isDisabled:undoDepth(editor.state)===0,
    onClick:()=>{undo(editor.state,editor.view.dispatch);editor.view.focus();}},
   {id:'redo',label:'重做',isDisabled:redoDepth(editor.state)===0,
    onClick:()=>{redo(editor.state,editor.view.dispatch);editor.view.focus();}}
  ];
  const structure:ContextMenuOption[]=[];
  for(const group of [
   selected?grouped('剪贴板',copyActions):null,
   selected?grouped('文字格式',textFormats):null
  ])if(group)structure.push(group);
  if(selected)structure.push(handDrawn,components,{type:'divider'});
  const blocks=grouped('块操作',blockActions);
  if(blocks)structure.push(blocks);
  const edits=grouped('历史',fallbackHistory);
  if(edits)structure.push(edits);
  setItems(structure);
 };
 return <div className="rk-editor-context-area">
  <ContextMenu label="编辑器右键菜单" menuWidth={244} size="sm"
   className="rk-editor-context-popover" presentation="popover"
   items={items} onContextMenu={createMenu}>
   {children}
  </ContextMenu>
 </div>;
}
