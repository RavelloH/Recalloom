import {useEditorState} from '@tiptap/react';
import {NodeSelection} from '@tiptap/pm/state';
import type {Editor} from '@tiptap/core';
export function useVisualEditorSelection(editor:Editor|null){
return useEditorState({editor,selector:({editor:e})=>({
  position:e?.state.selection.from??-1,
  bold:e?.isActive('bold')??false,italic:e?.isActive('italic')??false,
  heading1:e?.isActive('heading',{level:1})??false,
  heading2:e?.isActive('heading',{level:2})??false,
  heading3:e?.isActive('heading',{level:3})??false,
  heading4:e?.isActive('heading',{level:4})??false,
  heading5:e?.isActive('heading',{level:5})??false,
  heading6:e?.isActive('heading',{level:6})??false,
  code:e?.isActive('code')??false,
  bulletList:e?.isActive('bulletList')??false,
  orderedList:e?.isActive('orderedList')??false,
  taskList:e?.isActive('taskList')??false,
  blockquote:e?.isActive('blockquote')??false,
  codeBlock:e?.isActive('codeBlock')??false,
  underline:e?.isActive('underline')??false,
  strike:e?.isActive('strike')??false,
  mark:e?.isActive('rmdMark')??false,
  superscript:e?.isActive('superscript')??false,
  subscript:e?.isActive('subscript')??false,
  link:e?.isActive('link')??false,
  image:e?.isActive('image')??false,
  table:e?.isActive('table')??false,
  focused:e?.isFocused??false,
  alignCenter:e?.isActive({textAlign:'center'})??false,
  alignRight:e?.isActive({textAlign:'right'})??false,
  textSelection:e?!e.state.selection.empty&&!(e.state.selection instanceof NodeSelection):false,
  imageSelected:e?e.state.selection instanceof NodeSelection&&e.state.selection.node.type.name==='image':false,
  linkHref:e?.isActive('link')?String(e.getAttributes('link').href??''):''
 })});
}
