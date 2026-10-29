import React,{useEffect,useMemo,useRef,useState,useImperativeHandle} from 'react';
import './tiptap/editor.css';
import {Button} from '@astryxdesign/core/Button';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {useEditor,useEditorState,EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {BlockMath,InlineMath} from '@tiptap/extension-mathematics';
import Placeholder from '@tiptap/extension-placeholder';
import type {JSONContent} from '@tiptap/core';
import {CustomHeading} from './tiptap/custom-heading';
import {CustomParagraph} from './tiptap/custom-paragraph';
import {UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,TextAlignWithMarkdown} from './tiptap/markdown-extensions';
import {TableWithMarkdown,TableRowWithMarkdown,TableCellWithMarkdown,TableHeaderWithMarkdown} from './tiptap/table-with-markdown';
import {postProcessTableAlignment} from './tiptap/table-alignment';
import {markdownRoundTripSafe} from './tiptap/fidelity';


/**
 * Visual Markdown uses the NeutralPress serialization extensions but stays
 * separate from its CMS-specific upload / Monaco / local draft infrastructure.
 * The parent RecordEditor remains the only authority for saving revisions.
 */
export type VisualEditorHandle={flushEditedMarkdown:()=>string|null};
const VisualEditor=React.forwardRef<VisualEditorHandle,{value:string;onChange:(v:string)=>void;onUnsafe:()=>void}>(function VisualEditor({value,onChange,onUnsafe},ref){
 const checked=useRef(false);
 const [ready,setReady]=useState(false);
 const applying=useRef(false);
 const edited=useRef(false);
 const extensions=useMemo(()=>[
  StarterKit.configure({heading:false,paragraph:false,underline:false}),
  CustomHeading.configure({levels:[1,2,3,4,5,6]}),
  CustomParagraph,
  Markdown,
  Image.configure({allowBase64:false}),
  TableWithMarkdown.configure({resizable:false}),TableRowWithMarkdown,TableHeaderWithMarkdown,TableCellWithMarkdown,
  TaskList,TaskItem.configure({nested:true}),
  UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,
  TextAlignWithMarkdown.configure({types:['heading','paragraph'],alignments:['left','center','right']}),
  InlineMath.configure({katexOptions:{throwOnError:false,strict:false}}),
  BlockMath.configure({katexOptions:{throwOnError:false,strict:false}}),
  Placeholder.configure({placeholder:'开始写作…'}),
 ],[]);
 const editor=useEditor({
  extensions,content:value,contentType:'markdown',immediatelyRender:false,
  onUpdate:({editor})=>{if(!applying.current){edited.current=true;onChange(editor.getMarkdown());}},
 },[]);
 const active=useEditorState({editor,selector:({editor:e})=>({
  bold:e?.isActive('bold')??false,italic:e?.isActive('italic')??false,
  heading2:e?.isActive('heading',{level:2})??false,
  bulletList:e?.isActive('bulletList')??false,
  orderedList:e?.isActive('orderedList')??false,
  taskList:e?.isActive('taskList')??false,
  blockquote:e?.isActive('blockquote')??false,
  codeBlock:e?.isActive('codeBlock')??false,
  underline:e?.isActive('underline')??false,
  strike:e?.isActive('strike')??false,
  highlight:e?.isActive('highlight')??false,
  superscript:e?.isActive('superscript')??false,
  subscript:e?.isActive('subscript')??false,
  alignCenter:e?.isActive({textAlign:'center'})??false,
  alignRight:e?.isActive({textAlign:'right'})??false
 })});
 useEffect(()=>{
  if(!editor||checked.current)return;
  checked.current=true;
  applying.current=true;
  try{
   const parsed=(editor as typeof editor&{markdown:{parse:(md:string)=>JSONContent}}).markdown.parse(value);
   const aligned=postProcessTableAlignment(parsed,value);
   if(JSON.stringify(aligned)!==JSON.stringify(editor.getJSON())){
    editor.commands.setContent(aligned,{emitUpdate:false});
   }
   // Read-only fidelity gate: never silently rewrite the stored Markdown when
   // a syntax cannot be represented by the current Tiptap extension set.
   if(!markdownRoundTripSafe(value,editor.getMarkdown()))onUnsafe();
  }catch{
   onUnsafe();
  }finally{
   applying.current=false;
   setReady(true);
  }
 },[editor,value,onUnsafe]);
 useImperativeHandle(ref,()=>({flushEditedMarkdown:()=>{if(!editor)return null;const view=editor.view as typeof editor.view&{domObserver?:{flush:()=>void}};view.domObserver?.flush();return edited.current?editor.getMarkdown():null;}}),[editor]);
 if(!editor||!ready)return <div className="content-loading">正在准备可视化编辑器…</div>;
 const toggle=(name:string,pressed:boolean,run:()=>void,child:React.ReactNode)=>
  <ToggleButton key={name} label={name} size="sm" isPressed={pressed} onPressedChange={run}>{child}</ToggleButton>;
 return <div className="wysiwyg">
  <div className="wysiwyg-toolbar" role="toolbar" aria-label="格式工具栏">
   <div className="wysiwyg-tools">
    {toggle('粗体',active?.bold??false,()=>editor.chain().focus().toggleBold().run(),<strong>B</strong>)}
    {toggle('斜体',active?.italic??false,()=>editor.chain().focus().toggleItalic().run(),<em>I</em>)}
    {toggle('下划线',active?.underline??false,()=>editor.chain().focus().toggleUnderline().run(),<u>U</u>)}
    {toggle('删除线',active?.strike??false,()=>editor.chain().focus().toggleStrike().run(),<s>S</s>)}
    {toggle('高亮',active?.highlight??false,()=>editor.chain().focus().toggleHighlight().run(),<span className="toolbar-highlight">H</span>)}
    {toggle('上标',active?.superscript??false,()=>editor.chain().focus().toggleSuperscript().run(),<>x<sup>2</sup></>)}
    {toggle('下标',active?.subscript??false,()=>editor.chain().focus().toggleSubscript().run(),<>x<sub>2</sub></>)}
   </div>
   <div className="wysiwyg-tools">
    {toggle('二级标题',active?.heading2??false,()=>editor.chain().focus().toggleHeading({level:2}).run(),'H2')}
    {toggle('项目列表',active?.bulletList??false,()=>editor.chain().focus().toggleBulletList().run(),'•')}
    {toggle('编号列表',active?.orderedList??false,()=>editor.chain().focus().toggleOrderedList().run(),'1.')}
    {toggle('任务清单',active?.taskList??false,()=>editor.chain().focus().toggleTaskList().run(),'☑')}
    {toggle('引用',active?.blockquote??false,()=>editor.chain().focus().toggleBlockquote().run(),'❝')}
    {toggle('代码块',active?.codeBlock??false,()=>editor.chain().focus().toggleCodeBlock().run(),'</>')}
    <Button label="插入表格" variant="ghost" size="sm" onClick={()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}>▦</Button>
   </div>
   <div className="wysiwyg-tools">
    {toggle('居中对齐',active?.alignCenter??false,()=>editor.chain().focus().setTextAlign('center').run(),'≡')}
    {toggle('右对齐',active?.alignRight??false,()=>editor.chain().focus().setTextAlign('right').run(),'☰')}
    <Button label="左对齐" variant="ghost" size="sm" onClick={()=>editor.chain().focus().setTextAlign('left').run()}>⇤</Button>
   </div>
  </div>
  <EditorContent editor={editor}/>
 </div>;
});
export default VisualEditor;
