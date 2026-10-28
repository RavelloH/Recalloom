import React,{useEffect} from 'react';
import {useEditor,EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
const normalized=(value:string)=>value.replace(/\r\n/g,'\n').replace(/\n+$/,'');
export default function VisualEditor({value,onChange,onUnsafe}:{value:string;onChange:(v:string)=>void;onUnsafe:()=>void}){
 const editor=useEditor({extensions:[StarterKit,Markdown],content:value,contentType:'markdown',immediatelyRender:false,onUpdate:({editor})=>onChange(editor.getMarkdown())},[]);
 useEffect(()=>{if(editor&&normalized(editor.getMarkdown())!==normalized(value))onUnsafe();},[editor]);
 if(!editor)return <div className="content-loading">正在加载可视化编辑器…</div>;
 return <div className="wysiwyg"><div className="wysiwyg-toolbar"><button title="粗体" aria-label="粗体" className={editor.isActive('bold')?'selected':''} onClick={()=>editor.chain().focus().toggleBold().run()}><strong>B</strong></button><button title="斜体" aria-label="斜体" className={editor.isActive('italic')?'selected':''} onClick={()=>editor.chain().focus().toggleItalic().run()}><em>I</em></button><button title="二级标题" aria-label="二级标题" onClick={()=>editor.chain().focus().toggleHeading({level:2}).run()}>H2</button><button title="列表" aria-label="项目列表" onClick={()=>editor.chain().focus().toggleBulletList().run()}>•</button><button title="代码块" aria-label="代码块" onClick={()=>editor.chain().focus().toggleCodeBlock().run()}>{'</>'}</button></div><EditorContent editor={editor}/></div>;
}
