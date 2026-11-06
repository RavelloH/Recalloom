import React,{useEffect,useMemo,useRef,useState,useImperativeHandle} from 'react';
import './tiptap/editor.css';
import {Button} from '@astryxdesign/core/Button';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {useEditor,useEditorState,EditorContent} from '@tiptap/react';
import {BubbleMenu} from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {BlockMath,InlineMath} from '@tiptap/extension-mathematics';
import Placeholder from '@tiptap/extension-placeholder';
import {NodeSelection} from '@tiptap/pm/state';
import type {Editor,JSONContent} from '@tiptap/core';
import {Link2,ImagePlus,Sigma,Table2,Rows3,Columns3,Trash2,AlignLeft,AlignCenter,AlignRight,Plus,Minus,Code} from 'lucide-react';
import {CustomHeading} from './tiptap/custom-heading';
import {CustomParagraph} from './tiptap/custom-paragraph';
import {UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,TextAlignWithMarkdown} from './tiptap/markdown-extensions';
import {TableWithMarkdown,TableRowWithMarkdown,TableCellWithMarkdown,TableHeaderWithMarkdown} from './tiptap/table-with-markdown';
import {ScrollCodeBlock,ScrollTableView} from './tiptap/scroll-blocks';
import {buildVisualMarkdown,literalParagraph} from './tiptap/visual-markdown';
import {alignTableColumn,selectedLink} from './tiptap/editor-actions';
import {EditorInsertDialog,type InsertDialogState} from './tiptap/insert-dialog';
import {filterSlashCommands,matchSlashQuery,type SlashCommand} from './tiptap/slash-commands';
import {useCompactLayout} from './use-media';

type SlashState={from:number;to:number;query:string;index:number;placement:'above'|'below';offset:number;left:number};
const SLASH_MENU_WIDTH=300;
const SLASH_MENU_SPACE=280;
// Inline atoms (math, images) must not be mistaken for whitespace before "/".
const LEAF_PLACEHOLDER=String.fromCharCode(0xfffc);

/** The table toolbar floats just above the whole table, so it never covers a row being edited. */
const tableToolbarOffset=(cell:Element,surface:Element,compact:boolean)=>{
 const table=cell.closest('.tableWrapper')??cell;
 const box=table.getBoundingClientRect(),top=surface.getBoundingClientRect().top;
 // No room above (a table opening the document): sit just below it instead.
 return box.top-top-54>=(compact?60:8)?box.top-top-54:box.bottom-top+8;
};
export type VisualEditorHandle={flushEditedMarkdown:()=>string|null};
/** NeutralPress Markdown extensions with Recalloom's authoritative revision/CAS saving. */
const VisualEditor=React.forwardRef<VisualEditorHandle,{value:string;onChange:(v:string)=>void}>(function VisualEditor({value,onChange},ref){
 const checked=useRef(false);
 const [ready,setReady]=useState(false);
 const applying=useRef(false);
 const edited=useRef(false);
 const lastColumn=useRef<number|null>(null);
 const lastCellPos=useRef<number|null>(null);
 const [tableTarget,setTableTarget]=useState(false);
 const [tableToolbarTop,setTableToolbarTop]=useState(58);
 const [dialog,setDialog]=useState<InsertDialogState|null>(null);
 const compact=useCompactLayout();
 const compactRef=useRef(compact);
 compactRef.current=compact;
 const surfaceRef=useRef<HTMLDivElement>(null);
 const slashListRef=useRef<HTMLDivElement>(null);
 const [slash,setSlash]=useState<SlashState|null>(null);
 const slashRef=useRef<SlashState|null>(null);
 slashRef.current=slash;
 const slashDismissedAt=useRef<number|null>(null);
 const runSlashRef=useRef<(command:SlashCommand)=>void>(()=>{});
 const editorRef=useRef<Editor|null>(null);
 const detectSlash=(e:Editor)=>{
  const selection=e.state.selection;
  const $from=selection.$from;
  const query=selection.empty&&e.isEditable&&$from.parent.isTextblock&&!$from.parent.type.spec.code
   ?matchSlashQuery($from.parent.textBetween(0,$from.parentOffset,undefined,LEAF_PLACEHOLDER)):null;
  if(query===null){slashDismissedAt.current=null;setSlash(null);return;}
  const from=$from.pos-query.length-1;
  const surface=surfaceRef.current;
  if(slashDismissedAt.current===from||!surface||!filterSlashCommands(e,query).length){setSlash(null);return;}
  const coords=e.view.coordsAtPos(from),box=surface.getBoundingClientRect();
  const above=innerHeight-coords.bottom<SLASH_MENU_SPACE&&coords.top>SLASH_MENU_SPACE;
  setSlash(previous=>({from,to:$from.pos,query,index:previous?.from===from&&previous.query===query?previous.index:0,
   placement:above?'above':'below',offset:above?box.bottom-coords.top+6:coords.bottom-box.top+6,
   left:Math.max(0,Math.min(coords.left-box.left,box.width-SLASH_MENU_WIDTH))}));
 };
 // Keyboard navigation can move into another cell; keep the table toolbar beside it.
 const followTableSelection=(e:Editor)=>{
  lastCellPos.current=null;lastColumn.current=null;
  if(!e.isActive('table'))return;
  const at=e.view.domAtPos(e.state.selection.from).node;
  const cell=(at instanceof Element?at:at.parentElement)?.closest('td, th');
  const surface=surfaceRef.current;
  if(cell&&surface)setTableToolbarTop(tableToolbarOffset(cell,surface,compactRef.current));
 };
 const extensions=useMemo(()=>[
  StarterKit.configure({heading:false,paragraph:false,underline:false,codeBlock:false,link:{openOnClick:false}}),
  ScrollCodeBlock,
  CustomHeading.configure({levels:[1,2,3,4,5,6]}),
  CustomParagraph,
  Markdown,
  Image.configure({allowBase64:false}),
  TableWithMarkdown.configure({resizable:false,View:ScrollTableView}),TableRowWithMarkdown,TableHeaderWithMarkdown,TableCellWithMarkdown,
  TaskList,TaskItem.configure({nested:true}),
  UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,
  TextAlignWithMarkdown.configure({types:['heading','paragraph'],alignments:['left','center','right']}),
  InlineMath.configure({katexOptions:{throwOnError:false,strict:false},onClick:(node,pos)=>setDialog({kind:'math',type:'inline',latex:String(node.attrs.latex??''),position:pos,existing:true})}),
  BlockMath.configure({katexOptions:{throwOnError:false,strict:false},onClick:(node,pos)=>setDialog({kind:'math',type:'block',latex:String(node.attrs.latex??''),position:pos,existing:true})}),
  Placeholder.configure({placeholder:({editor:e,node})=>node.type.name==='heading'?'标题 '+String(node.attrs.level??''):e.isEmpty?'输入“/”插入内容，或直接开始写作…':'输入“/”插入块'}),
 ],[]);
 const editor=useEditor({
  extensions,content:'',contentType:'markdown',immediatelyRender:false,
  onUpdate:({editor})=>{if(!applying.current){edited.current=true;onChange(editor.getMarkdown());}detectSlash(editor);},
  onSelectionUpdate:({editor})=>{detectSlash(editor);followTableSelection(editor);},
  // Focus without a selection change (Tab, programmatic focus) must still place the table toolbar.
  onFocus:({editor})=>followTableSelection(editor),
  onBlur:()=>{setSlash(null);setTableTarget(false);},
  editorProps:{handleKeyDown:(_view,event)=>{
   const state=slashRef.current,e=editorRef.current;
   if(!state||!e||event.isComposing)return false;
   const items=filterSlashCommands(e,state.query);
   if(!items.length)return false;
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    const step=event.key==='ArrowDown'?1:-1;
    setSlash({...state,index:(state.index+step+items.length)%items.length});
    return true;
   }
   if(event.key==='Enter'||event.key==='Tab'){runSlashRef.current(items[Math.min(state.index,items.length-1)]!);return true;}
   if(event.key==='Escape'){slashDismissedAt.current=state.from;setSlash(null);return true;}
   return false;
  }},
 },[]);
 editorRef.current=editor;
 const active=useEditorState({editor,selector:({editor:e})=>({
  bold:e?.isActive('bold')??false,italic:e?.isActive('italic')??false,
  heading1:e?.isActive('heading',{level:1})??false,
  heading2:e?.isActive('heading',{level:2})??false,
  heading3:e?.isActive('heading',{level:3})??false,
  code:e?.isActive('code')??false,
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
 useEffect(()=>{slashListRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[slash?.index,slash?.query]);
 useEffect(()=>{
  if(!editor||checked.current)return;
  checked.current=true;
  applying.current=true;
  try{
   const manager=(editor as typeof editor&{markdown:{parse:(md:string)=>JSONContent;serialize:(doc:JSONContent)=>string}}).markdown;
   const richDocument=buildVisualMarkdown(value,manager);
   editor.commands.setContent(richDocument,{emitUpdate:false});
  }catch{
   // Even when an extension fails, the user must never be trapped in a
   // source-only island. The fallback stays normal editable paragraph text.
   editor.commands.setContent({type:'doc',content:[literalParagraph(value)]},{emitUpdate:false});
  }
  finally{applying.current=false;setReady(true);}
 },[editor,value]);
 useImperativeHandle(ref,()=>({flushEditedMarkdown:()=>{
  if(!editor)return null;
  const view=editor.view as typeof editor.view&{domObserver?:{flush:()=>void}};
  view.domObserver?.flush();
  return edited.current?editor.getMarkdown():null;
 }}),[editor]);

 const openLink=()=>{
  if(!editor)return;
  const info=selectedLink(editor);
  setDialog({kind:'link',from:info.from,to:info.to,text:info.text,url:info.href,existing:!!info.href});
 };
 const openImage=()=>{
  if(!editor)return;
  const existing=editor.isActive('image'),attrs=editor.getAttributes('image');
  setDialog({kind:'image',src:existing?String(attrs.src??''):'',alt:existing?String(attrs.alt??''):'',title:existing?String(attrs.title??''):'',existing});
 };
 const openMath=(type:'inline'|'block')=>setDialog({kind:'math',type,latex:'',existing:false});
 const applyDialog=(item:InsertDialogState)=>{
  if(!editor)return;
  if(item.kind==='link'){
   const label=item.text.trim()||item.url.trim();
   const current=editor.state.doc.textBetween(item.from,item.to);
   if(item.existing&&label===current){
    editor.chain().focus().setTextSelection({from:item.from,to:item.to}).setLink({href:item.url.trim()}).run();
   }else{
    editor.chain().focus().insertContentAt({from:item.from,to:item.to},{type:'text',text:label,marks:[{type:'link',attrs:{href:item.url.trim()}}]}).run();
   }
  }else if(item.kind==='image'){
   const attrs={src:item.src.trim(),alt:item.alt.trim(),title:item.title.trim()||undefined};
   if(item.existing)editor.chain().focus().updateAttributes('image',attrs).run();
   else editor.chain().focus().setImage(attrs).run();
  }else if(item.existing&&item.position!==undefined){
   const current=editor.state.doc.nodeAt(item.position);
   if(current){
    if(current.type.name===(item.type==='inline'?'inlineMath':'blockMath')){
     if(item.type==='inline')editor.chain().focus().setNodeSelection(item.position).updateInlineMath({latex:item.latex.trim()}).run();
     else editor.chain().focus().setNodeSelection(item.position).updateBlockMath({latex:item.latex.trim()}).run();
    }else{
     editor.chain().focus().setNodeSelection(item.position).deleteSelection().run();
     if(item.type==='inline')editor.chain().focus().insertInlineMath({latex:item.latex.trim()}).run();
     else editor.chain().focus().insertBlockMath({latex:item.latex.trim()}).run();
    }
   }
  }else if(item.kind==='math'){
   if(item.type==='inline')editor.chain().focus().insertInlineMath({latex:item.latex.trim()}).run();
   else editor.chain().focus().insertBlockMath({latex:item.latex.trim()}).run();
  }
  setDialog(null);
 };
 const removeDialog=()=>{
  if(!editor||!dialog)return;
  if(dialog.kind==='link'){
   editor.chain().focus().setTextSelection({from:dialog.from,to:dialog.to}).unsetLink().run();
  }else if(dialog.kind==='image'){
   editor.chain().focus().deleteSelection().run();
  }else if(dialog.kind==='math'&&dialog.existing&&dialog.position!==undefined){
   editor.chain().focus().setNodeSelection(dialog.position).deleteSelection().run();
  }
  setDialog(null);
 };
 const tableCommand=(name:'addRowBefore'|'addRowAfter'|'deleteRow'|'addColumnBefore'|'addColumnAfter'|'deleteColumn')=>{
  if(!editor)return;
  const chain=editor.chain().focus();
  if(lastCellPos.current!==null)chain.setTextSelection(lastCellPos.current);
  chain[name]().run();
 };
 runSlashRef.current=command=>{
  const state=slashRef.current;
  if(!editor||!state)return;
  setSlash(null);slashDismissedAt.current=null;
  editor.chain().focus().deleteRange({from:state.from,to:state.to}).run();
  command.run(editor,{openLink,openImage,openMath});
 };
 if(!editor||!ready)return <div className="content-loading">正在准备可视化编辑器…</div>;
 const toggle=(name:string,pressed:boolean,run:()=>void,child:React.ReactNode)=>
  <ToggleButton key={name} label={name} size="sm" isPressed={pressed} onPressedChange={run}>{child}</ToggleButton>;
 const action=(name:string,run:()=>void,child:React.ReactNode,disabled=false)=>
  <Button key={name} label={name} variant="ghost" size="sm" onMouseDown={event=>event.preventDefault()} onClick={run} isDisabled={disabled}>{child}</Button>;
 const slashItems=slash?filterSlashCommands(editor,slash.query):[];
 const inlineMarks=<>
  {toggle('粗体',active?.bold??false,()=>editor.chain().focus().toggleBold().run(),<strong>B</strong>)}
  {toggle('斜体',active?.italic??false,()=>editor.chain().focus().toggleItalic().run(),<em>I</em>)}
  {toggle('下划线',active?.underline??false,()=>editor.chain().focus().toggleUnderline().run(),<u>U</u>)}
  {toggle('删除线',active?.strike??false,()=>editor.chain().focus().toggleStrike().run(),<s>S</s>)}
  {toggle('高亮',active?.highlight??false,()=>editor.chain().focus().toggleHighlight().run(),<span className="toolbar-highlight">H</span>)}
 </>;
 return <div className="wysiwyg" ref={surfaceRef} onClickCapture={event=>{
  const target=event.target;
  if(!(target instanceof Element))return;
  const cell=target.closest('.tiptap td, .tiptap th') as HTMLTableCellElement|null;
  if(!cell){if(target.closest('.tiptap')){lastColumn.current=null;requestAnimationFrame(()=>setTableTarget(false));}return;}
  const row=cell.parentElement as HTMLTableRowElement;
  lastColumn.current=Array.from(row.cells).slice(0,cell.cellIndex).reduce((count,sibling)=>count+Math.max(1,sibling.colSpan),0);
  lastCellPos.current=editor.view.posAtDOM(cell,0);
  const surface=event.currentTarget.getBoundingClientRect();
  setTableToolbarTop(tableToolbarOffset(cell,event.currentTarget,compact));
  // Align the actual editor selection with the cell the user clicked.
  // Delay layout-changing toolbar visibility until pointer selection has settled.
  requestAnimationFrame(()=>setTableTarget(true));
 }}>
  {compact&&<div className="wysiwyg-toolbar" role="toolbar" aria-label="格式工具栏">
   <div className="wysiwyg-tools">
    {inlineMarks}
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
    {action('插入表格',()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run(),<Table2 size={17}/>)}
   </div>
   <div className="wysiwyg-tools">
    {toggle('居中对齐',active?.alignCenter??false,()=>editor.chain().focus().setTextAlign('center').run(),<AlignCenter size={17}/>)}
    {toggle('右对齐',active?.alignRight??false,()=>editor.chain().focus().setTextAlign('right').run(),<AlignRight size={17}/>)}
    {action('左对齐',()=>editor.chain().focus().setTextAlign('left').run(),<AlignLeft size={17}/>)}
   </div>
   <div className="wysiwyg-tools">
    {action('插入或编辑链接',openLink,<Link2 size={17}/>)}
    {action('插入或编辑图片',openImage,<ImagePlus size={17}/>)}
    {action('插入行内公式',()=>openMath('inline'),<Sigma size={17}/>)}
    {action('插入块级公式',()=>openMath('block'),<>$$</>)}
   </div>
  </div>}
  {!compact&&<BubbleMenu editor={editor} className="bubble-menu" options={{placement:'top',offset:8}}
   shouldShow={({editor:e,state,from,to})=>{
    if(!e.isEditable)return false;
    const selection=state.selection;
    if(selection instanceof NodeSelection)return selection.node.type.name==='image';
    if(e.isActive('codeBlock'))return false;
    return from!==to||e.isActive('link');
   }}>
   <div className="bubble-menu-inner" role="toolbar" aria-label="文本格式" onMouseDown={event=>event.preventDefault()}>
    {active?.imageSelected
     ?action('插入或编辑图片',openImage,<><ImagePlus size={15}/><span>编辑图片</span></>)
     :!active?.textSelection
      ?<>{active?.linkHref&&<span className="bubble-link truncate" title={active.linkHref}>{active.linkHref}</span>}{action('插入或编辑链接',openLink,<><Link2 size={15}/><span>编辑链接</span></>)}</>
      :<>
       <div className="bubble-group">
        {toggle('一级标题',active?.heading1??false,()=>editor.chain().focus().toggleHeading({level:1}).run(),'H1')}
        {toggle('二级标题',active?.heading2??false,()=>editor.chain().focus().toggleHeading({level:2}).run(),'H2')}
        {toggle('三级标题',active?.heading3??false,()=>editor.chain().focus().toggleHeading({level:3}).run(),'H3')}
       </div>
       <div className="bubble-group">
        {inlineMarks}
        {toggle('行内代码',active?.code??false,()=>editor.chain().focus().toggleCode().run(),<Code size={15}/>)}
       </div>
       <div className="bubble-group">
        {toggle('上标',active?.superscript??false,()=>editor.chain().focus().toggleSuperscript().run(),<>x<sup>2</sup></>)}
        {toggle('下标',active?.subscript??false,()=>editor.chain().focus().toggleSubscript().run(),<>x<sub>2</sub></>)}
       </div>
       <div className="bubble-group">{action('插入或编辑链接',openLink,<Link2 size={15}/>)}</div>
      </>}
   </div>
  </BubbleMenu>}
  <div hidden={!((active?.table&&active.focused)||tableTarget)} className="editor-table-actions" role="toolbar" aria-label="表格操作" style={{top:tableToolbarTop}}>
   <span className="muted small table-actions-label">表格</span>
   {action('在上方插入行',()=>tableCommand('addRowBefore'),<><Rows3 size={15}/><Plus size={12}/></>,!tableTarget&&!editor.can().addRowBefore())}
   {action('在下方插入行',()=>tableCommand('addRowAfter'),<><Rows3 size={15}/><Plus size={12}/></>,!tableTarget&&!editor.can().addRowAfter())}
   {action('删除当前行',()=>tableCommand('deleteRow'),<><Rows3 size={15}/><Minus size={12}/></>,!tableTarget&&!editor.can().deleteRow())}
   <span className="editor-table-sep"/>
   {action('在前方插入列',()=>tableCommand('addColumnBefore'),<><Columns3 size={15}/><Plus size={12}/></>,!tableTarget&&!editor.can().addColumnBefore())}
   {action('在后方插入列',()=>tableCommand('addColumnAfter'),<><Columns3 size={15}/><Plus size={12}/></>,!tableTarget&&!editor.can().addColumnAfter())}
   {action('删除当前列',()=>tableCommand('deleteColumn'),<><Columns3 size={15}/><Minus size={12}/></>,!tableTarget&&!editor.can().deleteColumn())}
   <span className="editor-table-sep"/>
   {action('当前列左对齐',()=>alignTableColumn(editor,'left',lastColumn.current??undefined),<AlignLeft size={16}/>)}
   {action('当前列居中对齐',()=>alignTableColumn(editor,'center',lastColumn.current??undefined),<AlignCenter size={16}/>)}
   {action('当前列右对齐',()=>alignTableColumn(editor,'right',lastColumn.current??undefined),<AlignRight size={16}/>)}
   <span className="editor-table-sep"/>
   {action('删除表格',()=>editor.chain().focus().deleteTable().run(),<Trash2 size={16}/>,!tableTarget&&!editor.can().deleteTable())}
  </div>
  <EditorContent editor={editor}/>
  {slash&&slashItems.length>0&&<div className="slash-menu" ref={slashListRef} role="listbox" aria-label="插入块" style={{...(slash.placement==='above'?{bottom:slash.offset}:{top:slash.offset}),left:slash.left,width:SLASH_MENU_WIDTH}} onMouseDown={event=>event.preventDefault()}>
   <div className="slash-menu-heading">{slash.query?'匹配的块':'基础块'}</div>
   {slashItems.map((command,index)=>{const Icon=command.icon;const selected=index===Math.min(slash.index,slashItems.length-1);return <div key={command.id} role="option" aria-selected={selected} className={'slash-item'+(selected?' is-selected':'')}
    onMouseEnter={()=>setSlash(current=>current&&{...current,index})} onClick={()=>runSlashRef.current(command)}>
    <span className="slash-icon"><Icon size={18}/></span><span className="slash-copy"><strong>{command.title}</strong><small>{command.description}</small></span></div>;})}
  </div>}
  {dialog&&<EditorInsertDialog key={dialog.kind+'-'+(dialog.kind==='math'?dialog.position??'new':dialog.kind==='link'?dialog.from:'image')} value={dialog} onClose={()=>setDialog(null)} onApply={applyDialog} onRemove={removeDialog}/>}
 </div>;
});
export default VisualEditor;
