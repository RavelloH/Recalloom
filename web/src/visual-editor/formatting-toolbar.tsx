import {Icon} from '../icon';
import React from 'react';
import type {Editor} from '@tiptap/core';
import {inlineCommandsByGroup,runInlineRmdCommand,type InlineCommand} from '../tiptap/editor-inline-commands';
import type {InlinePopupItem} from './types';
import type {FormatHoverKind} from '../tiptap/format-hover-preview';
import type {useVisualEditorSelection} from './use-selection';

type ToolbarProps={
 editor:Editor;
 active:ReturnType<typeof useVisualEditorSelection>;
 categoryButton:(label:string,child:React.ReactNode,items:InlinePopupItem[],highlightActive?:boolean)=>React.ReactNode;
 toggle:(name:string,pressed:boolean,run:()=>void,child:React.ReactNode)=>React.ReactNode;
 action:(name:string,run:()=>void,child:React.ReactNode,disabled?:boolean)=>React.ReactNode;
 runCapturedInline:(run:()=>void)=>void;
 runInlineFromMenu:(command:InlineCommand)=>void;
 openLink:()=>void;
 openMath:(kind:'inline'|'block')=>void;
 moreInlineItems:InlinePopupItem[];
 touchToolbar:boolean;
};

export function buildMoreInlineItems(editor:Editor,active:ToolbarProps["active"],runCapturedInline:ToolbarProps["runCapturedInline"],runInlineFromMenu:ToolbarProps["runInlineFromMenu"]):InlinePopupItem[]{
 return [
  ...inlineCommandsByGroup('inline-component').map(command=>({
   id:command.id,label:command.title,description:command.description,
   preview:('rich:'+command.syntax) as FormatHoverKind,
   disabled:!command.isAvailable(editor),active:command.isActive(editor),
   run:()=>runInlineFromMenu(command)
  })),
  {id:'inline-more-super',label:'上标',preview:'superscript' as FormatHoverKind,active:Boolean(active?.superscript),
   run:()=>runCapturedInline(()=>editor.chain().focus().toggleSuperscript().run())},
  {id:'inline-more-sub',label:'下标',preview:'subscript' as FormatHoverKind,active:Boolean(active?.subscript),
   run:()=>runCapturedInline(()=>editor.chain().focus().toggleSubscript().run())},
  {id:'inline-more-comment',label:'注释',preview:'comment' as FormatHoverKind,description:'将选中文字标为可见注释',
   active:editor.isActive('visibleComment'),
   run:()=>runCapturedInline(()=>editor.chain().focus().toggleMark('visibleComment').run())}
 ];
}

/** Shared sequence; mobile alone adds Undo/Redo at the end.
 * Each semantic group owns exactly one separator in the presentation layer.
 * Never reorder via CSS: visual, DOM, keyboard, and screen reader orders match.
 */
export function buildFormattingToolbar(props:ToolbarProps){
 const {editor,active,categoryButton,toggle,action,runCapturedInline,runInlineFromMenu,openLink,openMath,moreInlineItems,touchToolbar}=props;
 return <>
  <span className="rk-format-group" data-format-group="heading">
   {categoryButton('标题',<Icon name="h2" size="sm"/>,[...([1,2,3,4,5,6] as const).map(level=>({
    id:'heading-'+level,label:level+' 级标题',preview:(editor.isActive('heading',{level})?'heading:0':'heading:'+level) as FormatHoverKind,active:editor.isActive('heading',{level}),
    run:()=>runCapturedInline(()=>editor.chain().focus().toggleHeading({level}).run())
   }))])}
  </span>
  <span className="rk-format-group" data-format-group="text">
   {toggle('粗体',active?.bold??false,()=>editor.chain().focus().toggleBold().run(),<Icon name="bold" size="sm"/>)}
   {toggle('斜体',active?.italic??false,()=>editor.chain().focus().toggleItalic().run(),<Icon name="italic" size="sm"/>)}
   {toggle('删除线',active?.strike??false,()=>editor.chain().focus().toggleStrike().run(),<Icon name="strikethrough" size="sm"/>)}
   {toggle('下划线',active?.underline??false,()=>editor.chain().focus().toggleUnderline().run(),<Icon name="underline" size="sm"/>)}
   {toggle('高亮',active?.mark??false,()=>runInlineRmdCommand(editor,'mark'),<span className="toolbar-highlight" aria-hidden="true">H</span>)}
   {categoryButton('荧光笔与手绘标记',<Icon name="pencil" size="sm"/>,
    inlineCommandsByGroup('hand-drawn').map(command=>({
     id:command.id,label:command.title,description:command.description,
     preview:('sketch:'+command.syntax) as FormatHoverKind,
     active:command.isActive(editor),disabled:!command.isAvailable(editor),
     run:()=>runInlineFromMenu(command)
    })))}
  </span>
  <span className="rk-format-group" data-format-group="layout">
   {categoryButton('对齐方式',<Icon name="alignLeft" size="sm"/>,[
    {id:'align-left',label:'左对齐',preview:'align:left',active:!active?.alignCenter&&!active?.alignRight,
     run:()=>runCapturedInline(()=>editor.chain().focus().unsetTextAlign().run())},
    {id:'align-center',label:'居中对齐',preview:active?.alignCenter?'align:left':'align:center',active:Boolean(active?.alignCenter),
     run:()=>runCapturedInline(()=>{
      const chain=editor.chain().focus();
      if(active?.alignCenter)chain.unsetTextAlign().run();else chain.setTextAlign('center').run();
     })},
    {id:'align-right',label:'右对齐',preview:active?.alignRight?'align:left':'align:right',active:Boolean(active?.alignRight),
     run:()=>runCapturedInline(()=>{
      const chain=editor.chain().focus();
      if(active?.alignRight)chain.unsetTextAlign().run();else chain.setTextAlign('right').run();
     })}
   ],false)}
   {categoryButton('列表',<Icon name="list" size="sm"/>,[
    {id:'list-bullet',label:'项目列表',preview:active?.bulletList?'remove:list:bullet':'list:bullet',active:Boolean(active?.bulletList),
     run:()=>runCapturedInline(()=>editor.chain().focus().toggleBulletList().run())},
    {id:'list-ordered',label:'编号列表',preview:active?.orderedList?'remove:list:ordered':'list:ordered',active:Boolean(active?.orderedList),
     run:()=>runCapturedInline(()=>editor.chain().focus().toggleOrderedList().run())},
    {id:'list-todo',label:'任务清单',preview:active?.taskList?'remove:list:task':'list:task',active:Boolean(active?.taskList),
     run:()=>runCapturedInline(()=>editor.chain().focus().toggleTaskList().run())}
   ])}
  </span>
  <span className="rk-format-group" data-format-group="insert-inline">
   {toggle('引用',active?.blockquote??false,()=>editor.chain().focus().toggleBlockquote().run(),<Icon name="quote" size="sm"/>)}
   {toggle('行内代码',active?.code??false,()=>editor.chain().focus().toggleCode().run(),<Icon name="code" size="sm"/>)}
   {action('插入行内公式',()=>runCapturedInline(()=>openMath('inline')),<Icon name="math" size="sm"/>)}
   {action('插入或编辑链接',()=>runCapturedInline(openLink),<Icon name="link" size="sm"/>)}
  </span>
  <span className="rk-format-group" data-format-group="more">
   {categoryButton('更多',<Icon name="dots" size="sm"/>,moreInlineItems)}
  </span>
  {touchToolbar&&<span className="rk-format-group" data-format-group="history">
   {action('撤销',()=>editor.chain().focus().undo().run(),<Icon name="undo" size="sm"/>,!editor.can().undo())}
   {action('重做',()=>editor.chain().focus().redo().run(),<Icon name="redo" size="sm"/>,!editor.can().redo())}
  </span>}
 </>;
}
