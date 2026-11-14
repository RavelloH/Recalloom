import React from 'react';
import type {Editor} from '@tiptap/core';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {Icon} from '../icon';
import {alignTableColumn} from '../tiptap/editor-actions';
import type {useVisualEditorSelection} from './use-selection';

type Command='addRowBefore'|'addRowAfter'|'deleteRow'|'addColumnBefore'|'addColumnAfter'|'deleteColumn';
type Props={
 editor:Editor;
 active:ReturnType<typeof useVisualEditorSelection>;
 tableTarget:boolean;
 tableToolbarTop:number;
 column:number|null;
 editTableCaption:()=>void;
 tableCommand:(name:Command)=>void;
 action:(name:string,run:()=>void,child:React.ReactNode,disabled?:boolean)=>React.ReactNode;
};
export function EditorTableControls({editor,active,tableTarget,tableToolbarTop,column,editTableCaption,tableCommand,action}:Props){
 return <>
  <Toolbar hidden={!((active?.table&&active.focused)||tableTarget)} className="editor-table-actions" label="表格操作" size="sm" gap={0}
   style={{top:tableToolbarTop,padding:'7px 12px'}} startContent={<div className="rk-editor-table-tools">
   <span className="muted small table-actions-label">表格</span>
   {action('在上方插入行',()=>tableCommand('addRowBefore'),<Icon name="tableInsertRowBefore" size="sm"/>,!tableTarget&&!editor.can().addRowBefore())}
   {action('在下方插入行',()=>tableCommand('addRowAfter'),<Icon name="tableInsertRowAfter" size="sm"/>,!tableTarget&&!editor.can().addRowAfter())}
   {action('删除当前行',()=>tableCommand('deleteRow'),<Icon name="tableDeleteRow" size="sm"/>,!tableTarget&&!editor.can().deleteRow())}
   <span className="editor-table-sep"/>
   {action('在前方插入列',()=>tableCommand('addColumnBefore'),<Icon name="tableInsertColumnBefore" size="sm"/>,!tableTarget&&!editor.can().addColumnBefore())}
   {action('在后方插入列',()=>tableCommand('addColumnAfter'),<Icon name="tableInsertColumnAfter" size="sm"/>,!tableTarget&&!editor.can().addColumnAfter())}
   {action('删除当前列',()=>tableCommand('deleteColumn'),<Icon name="tableDeleteColumn" size="sm"/>,!tableTarget&&!editor.can().deleteColumn())}
   <span className="editor-table-sep"/>
   {action('当前列左对齐',()=>alignTableColumn(editor,'left',column??undefined),<Icon name="alignLeft" size="sm"/>)}
   {action('当前列居中对齐',()=>alignTableColumn(editor,'center',column??undefined),<Icon name="alignCenter" size="sm"/>)}
   {action('当前列右对齐',()=>alignTableColumn(editor,'right',column??undefined),<Icon name="alignRight" size="sm"/>)}
   <span className="editor-table-sep"/>
   {action('编辑表格图注与 ID',editTableCaption,<span className="rk-editor-table-caption"><Icon name="pencil" size="sm"/><span>表注</span></span>)}
   {action('删除表格',()=>editor.chain().focus().deleteTable().run(),<Icon name="trash" size="sm"/>,!tableTarget&&!editor.can().deleteTable())}
  </div>}/>

 </>;
}
