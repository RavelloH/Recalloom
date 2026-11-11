import React from 'react';
import type {Editor} from '@tiptap/core';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Icon} from '../icon';
import {alignTableColumn} from '../tiptap/editor-actions';
import {safeTableId} from '../table-caption';
import type {useVisualEditorSelection} from './use-selection';

type Command='addRowBefore'|'addRowAfter'|'deleteRow'|'addColumnBefore'|'addColumnAfter'|'deleteColumn';
type Props={
 editor:Editor;
 active:ReturnType<typeof useVisualEditorSelection>;
 tableTarget:boolean;
 tableToolbarTop:number;
 tableCaptionOpen:boolean;
 tableCaptionDraft:string;
 tableIdDraft:string;
 column:number|null;
 onTableCaptionDraftChange:(value:string)=>void;
 onTableIdDraftChange:(value:string)=>void;
 onCloseCaption:()=>void;
 applyTableCaption:()=>void;
 editTableCaption:()=>void;
 tableCommand:(name:Command)=>void;
 action:(name:string,run:()=>void,child:React.ReactNode,disabled?:boolean)=>React.ReactNode;
};
export function EditorTableControls({editor,active,tableTarget,tableToolbarTop,tableCaptionOpen,tableCaptionDraft,tableIdDraft,column,onTableCaptionDraftChange,onTableIdDraftChange,onCloseCaption,applyTableCaption,editTableCaption,tableCommand,action}:Props){
 return <>
  <div hidden={!((active?.table&&active.focused)||tableTarget)} className="editor-table-actions" role="toolbar" aria-label="表格操作" style={{top:tableToolbarTop}}>
   <span className="muted small table-actions-label">表格</span>
   {action('在上方插入行',()=>tableCommand('addRowBefore'),<><Icon name="tableRow" size="sm"/><Icon name="plus" size="sm"/></>,!tableTarget&&!editor.can().addRowBefore())}
   {action('在下方插入行',()=>tableCommand('addRowAfter'),<><Icon name="tableRow" size="sm"/><Icon name="plus" size="sm"/></>,!tableTarget&&!editor.can().addRowAfter())}
   {action('删除当前行',()=>tableCommand('deleteRow'),<><Icon name="tableRow" size="sm"/><Icon name="minus" size="sm"/></>,!tableTarget&&!editor.can().deleteRow())}
   <span className="editor-table-sep"/>
   {action('在前方插入列',()=>tableCommand('addColumnBefore'),<><Icon name="columns3" size="sm"/><Icon name="plus" size="sm"/></>,!tableTarget&&!editor.can().addColumnBefore())}
   {action('在后方插入列',()=>tableCommand('addColumnAfter'),<><Icon name="columns3" size="sm"/><Icon name="plus" size="sm"/></>,!tableTarget&&!editor.can().addColumnAfter())}
   {action('删除当前列',()=>tableCommand('deleteColumn'),<><Icon name="columns3" size="sm"/><Icon name="minus" size="sm"/></>,!tableTarget&&!editor.can().deleteColumn())}
   <span className="editor-table-sep"/>
   {action('当前列左对齐',()=>alignTableColumn(editor,'left',column??undefined),<Icon name="alignLeft" size="sm"/>)}
   {action('当前列居中对齐',()=>alignTableColumn(editor,'center',column??undefined),<Icon name="alignCenter" size="sm"/>)}
   {action('当前列右对齐',()=>alignTableColumn(editor,'right',column??undefined),<Icon name="alignRight" size="sm"/>)}
   <span className="editor-table-sep"/>
   {action('编辑表格图注与 ID',editTableCaption,<><Icon name="pencil" size="sm"/><span>表注</span></>)}
   {action('删除表格',()=>editor.chain().focus().deleteTable().run(),<Icon name="trash" size="sm"/>,!tableTarget&&!editor.can().deleteTable())}
  </div>
  {tableCaptionOpen&&<div className="rk-table-caption-editor" role="group" aria-label="编辑表格图注与 ID" style={{top:tableToolbarTop+55}}>
   <TextInput label="表格 ID（tbl-...）" value={tableIdDraft} onChange={onTableIdDraftChange} placeholder="tbl-parameters"/>
   <TextInput label="表格图注" value={tableCaptionDraft} onChange={onTableCaptionDraftChange} placeholder="系统参数"/>
   <div className="rk-table-caption-editor-actions">
    <Button label="取消表注编辑" size="sm" variant="ghost" onClick={onCloseCaption}>取消</Button>
    <Button label="保存表注" size="sm" onClick={applyTableCaption}
      isDisabled={Boolean(tableIdDraft.trim())!==Boolean(tableCaptionDraft.trim())||Boolean(tableIdDraft.trim())&&!safeTableId(tableIdDraft.trim().toLowerCase())}>保存</Button>
   </div>
  </div>}
 </>;
}
