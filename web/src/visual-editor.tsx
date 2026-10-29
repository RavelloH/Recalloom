import React,{useEffect,useMemo} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {useEditor,useEditorState,EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import {Table,TableRow,TableCell,TableHeader} from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import {BlockMath,InlineMath} from '@tiptap/extension-mathematics';

const normalize=(value:string)=>value.replace(/\r\n/g,'\n').replace(/\n+$/,'');
export default function VisualEditor({value,onChange,onUnsafe}:{value:string;onChange:(v:string)=>void;onUnsafe:()=>void}){
 const extensions=useMemo(()=>[
  StarterKit,Markdown,Image.configure({allowBase64:false}),
  Table.configure({resizable:false}),TableRow,TableHeader,TableCell,
  TaskList,TaskItem.configure({nested:true}),Highlight,Subscript,Superscript,
  InlineMath,BlockMath,
 ],[]);
 const editor=useEditor({extensions,content:value,contentType:'markdown',immediatelyRender:false,onUpdate:({editor})=>onChange(editor.getMarkdown())},[]);
 // Formatting is transaction-driven: useEditor alone may not re-render on a mark-only change.
 const active=useEditorState({editor,selector:({editor:e})=>({
  bold:e?.isActive('bold')??false,
  italic:e?.isActive('italic')??false,
  heading2:e?.isActive('heading',{level:2})??false,
  bulletList:e?.isActive('bulletList')??false,
  orderedList:e?.isActive('orderedList')??false,
  taskList:e?.isActive('taskList')??false,
  blockquote:e?.isActive('blockquote')??false,
  codeBlock:e?.isActive('codeBlock')??false,
  underline:e?.isActive('underline')??false,
  strike:e?.isActive('strike')??false
 })});
 useEffect(()=>{if(editor&&normalize(editor.getMarkdown())!==normalize(value))onUnsafe();},[editor]);
 if(!editor)return <div className="content-loading">正在加载可视化编辑器…</div>;
 return <div className="wysiwyg"><div className="wysiwyg-toolbar" aria-label="格式工具栏">
  <ToggleButton label="粗体" size="sm" isPressed={active?.bold??false} onPressedChange={()=>editor.chain().focus().toggleBold().run()}><strong>B</strong></ToggleButton>
  <ToggleButton label="斜体" size="sm" isPressed={active?.italic??false} onPressedChange={()=>editor.chain().focus().toggleItalic().run()}><em>I</em></ToggleButton>
  <ToggleButton label="二级标题" size="sm" isPressed={active?.heading2??false} onPressedChange={()=>editor.chain().focus().toggleHeading({level:2}).run()}>H2</ToggleButton>
  <ToggleButton label="项目列表" size="sm" isPressed={active?.bulletList??false} onPressedChange={()=>editor.chain().focus().toggleBulletList().run()}>•</ToggleButton>
  <ToggleButton label="编号列表" size="sm" isPressed={active?.orderedList??false} onPressedChange={()=>editor.chain().focus().toggleOrderedList().run()}>1.</ToggleButton>
  <ToggleButton label="任务清单" size="sm" isPressed={active?.taskList??false} onPressedChange={()=>editor.chain().focus().toggleTaskList().run()}>☑</ToggleButton>
  <ToggleButton label="引用" size="sm" isPressed={active?.blockquote??false} onPressedChange={()=>editor.chain().focus().toggleBlockquote().run()}>❝</ToggleButton>
  <ToggleButton label="代码块" size="sm" isPressed={active?.codeBlock??false} onPressedChange={()=>editor.chain().focus().toggleCodeBlock().run()}>{'</>'}</ToggleButton>
  <Button label="插入表格" variant="ghost" size="sm" onClick={()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}>▦</Button>
  <ToggleButton label="下划线" size="sm" isPressed={active?.underline??false} onPressedChange={()=>editor.chain().focus().toggleUnderline().run()}>U̲</ToggleButton>
  <ToggleButton label="删除线" size="sm" isPressed={active?.strike??false} onPressedChange={()=>editor.chain().focus().toggleStrike().run()}>S̶</ToggleButton>
 </div><EditorContent editor={editor}/></div>;
}
