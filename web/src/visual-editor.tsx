import React,{useEffect,useMemo} from 'react';
import {useEditor,EditorContent} from '@tiptap/react';
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
 useEffect(()=>{if(editor&&normalize(editor.getMarkdown())!==normalize(value))onUnsafe();},[editor]);
 if(!editor)return <div className="content-loading">正在加载可视化编辑器…</div>;
 return <div className="wysiwyg"><div className="wysiwyg-toolbar" aria-label="格式工具栏">
  <button type="button" aria-label="粗体" className={editor.isActive('bold')?'selected':''} onClick={()=>editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
  <button type="button" aria-label="斜体" className={editor.isActive('italic')?'selected':''} onClick={()=>editor.chain().focus().toggleItalic().run()}><em>I</em></button>
  <button type="button" aria-label="二级标题" onClick={()=>editor.chain().focus().toggleHeading({level:2}).run()}>H2</button>
  <button type="button" aria-label="项目列表" onClick={()=>editor.chain().focus().toggleBulletList().run()}>•</button>
  <button type="button" aria-label="编号列表" onClick={()=>editor.chain().focus().toggleOrderedList().run()}>1.</button>
  <button type="button" aria-label="任务清单" onClick={()=>editor.chain().focus().toggleTaskList().run()}>☑</button>
  <button type="button" aria-label="引用" onClick={()=>editor.chain().focus().toggleBlockquote().run()}>❝</button>
  <button type="button" aria-label="代码块" onClick={()=>editor.chain().focus().toggleCodeBlock().run()}>{'</>'}</button>
  <button type="button" aria-label="插入表格" onClick={()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}>▦</button>
  <button type="button" aria-label="下划线" onClick={()=>editor.chain().focus().toggleUnderline().run()}>U̲</button>
  <button type="button" aria-label="删除线" onClick={()=>editor.chain().focus().toggleStrike().run()}>S̶</button>
 </div><EditorContent editor={editor}/></div>;
}
