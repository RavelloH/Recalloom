import React,{useEffect,useMemo,useRef,useState,useImperativeHandle} from 'react';
import {createPortal} from 'react-dom';
import {useQuery} from '@tanstack/react-query';
import {searchQuery,type SearchHit} from './queries';
import './tiptap/editor.css';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {useEditor,useEditorState,EditorContent} from '@tiptap/react';
import {BubbleMenu} from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import {RichImage} from './tiptap/rich-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {RmdBlockMath} from './tiptap/rmd-block-math';
import {InlineMath} from '@tiptap/extension-mathematics';
import Placeholder from '@tiptap/extension-placeholder';
import {NodeSelection} from '@tiptap/pm/state';
import type {Editor,JSONContent} from '@tiptap/core';
import {IconLink,IconPhotoPlus,IconMathFunction,IconTable,IconTableRow,IconColumns3,IconTrash,IconAlignLeft,IconAlignCenter,IconAlignRight,IconPlus,IconMinus,IconCode,IconPencil,IconBold,IconItalic,IconUnderline,IconStrikethrough,IconHighlight,IconSuperscript,IconSubscript,IconH2,IconList,IconListNumbers,IconListCheck,IconQuote,IconCodeDots,IconBrackets,IconSum,IconChevronDown,IconMessageCircle,IconDots} from '@tabler/icons-react';
import {CustomHeading} from './tiptap/custom-heading';
import {CustomParagraph} from './tiptap/custom-paragraph';
import {UnderlineWithMarkdown,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,TextAlignWithMarkdown} from './tiptap/markdown-extensions';
import {TableWithMarkdown,TableRowWithMarkdown,TableCellWithMarkdown,TableHeaderWithMarkdown} from './tiptap/table-with-markdown';
import {WikiLinkNode,WikiEmbedNode} from './tiptap/wiki-nodes';
import {CrossReferenceNode} from './tiptap/cross-reference';
import {ScrollCodeBlock,CaptionedScrollTableView} from './tiptap/scroll-blocks';
import {parseRmdVisual} from './rmd-visual';
import {serializeRmdVisual} from './rmd-serialize';
import {RmdMark} from './tiptap/rmd-mark';
import {RmdSketchMark} from './tiptap/rmd-sketch';
import {useSketchAnnotations} from './sketch-annotations';
import {RmdAttrsDecorations} from './tiptap/rmd-attrs-decoration';
import {isRmdAttrsEditable} from './tiptap/rmd-schema-attrs-model';
import {RawMarkdown,RawInline,rawMarkdownBlock} from './tiptap/raw-markdown';
import {RichContainer,RichBadge,RichAbbr,RichTooltip,RichKbd,RichCloze} from './tiptap/rich-directives';
import {RichLinkCard} from './tiptap/rich-link-card';
import {RichFootnoteRef,RichFootnoteDefinition} from './tiptap/rich-footnotes';
import {RichCritic} from './tiptap/rich-critic';
import {VisibleComment} from './tiptap/comment-mark';
import Link from '@tiptap/extension-link';
import {decorateEditorLinks} from './link-metadata-client';
import {alignTableColumn,selectedLink} from './tiptap/editor-actions';
import {EditorInsertDialog,type InsertDialogState} from './tiptap/insert-dialog';
import {filterSlashCommands,groupSlashCommands,matchSlashQuery,type SlashCommand} from './tiptap/slash-commands';
import {BlockHandleLayer} from './tiptap/block-handle';
import {BlockEditorPanel} from './tiptap/block-editor-panel';
import {EditorContextMenu} from './tiptap/editor-context-menu';
import {editableBlockAt,topLevelAtDocumentPosition} from './tiptap/editor-block-actions';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {inlineCommandsByGroup,runInlineRmdCommand,type InlineCommand} from './tiptap/editor-inline-commands';
import {useCompactLayout} from './use-media';
import {safeTableId,cleanTableCaption} from './table-caption';

type SlashState={from:number;to:number;query:string;index:number;placement:'above'|'below';offset:number;left:number};
type WikiState=SlashState&{kind:'link'|'embed'};
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
/** Shared RMD AST with Recalloom's authoritative revision/CAS saving. */
const VisualEditor=React.forwardRef<VisualEditorHandle,{value:string;onChange:(v:string)=>void;recordId?:string}>(function VisualEditor({value,onChange,recordId},ref){
 const checked=useRef(false);
 const [ready,setReady]=useState(false);
 const applying=useRef(false);
 const edited=useRef(false);
 const lastColumn=useRef<number|null>(null);
 const lastCellPos=useRef<number|null>(null);
 const [tableTarget,setTableTarget]=useState(false);
 const [tableCaptionOpen,setTableCaptionOpen]=useState(false);
 const [tableCaptionDraft,setTableCaptionDraft]=useState('');
 const [tableIdDraft,setTableIdDraft]=useState('');
 const [tableToolbarTop,setTableToolbarTop]=useState(58);
 const [dialog,setDialog]=useState<InsertDialogState|null>(null);
 const [blockPanelPos,setBlockPanelPos]=useState<number|null>(null);
 const [attributeNodePos,setAttributeNodePos]=useState<number|null>(null);
 const inlineSelectionRef=useRef<{from:number;to:number}|null>(null);
 const lastEditorTextSelection=useRef<{from:number;to:number;doc:ProseMirrorNode}|null>(null);
 const blockPanelRef=useRef<{pos:number;node:ProseMirrorNode}|null>(null);
 const attributeNodeRef=useRef<{pos:number;type:string}|null>(null);
 const compact=useCompactLayout();
 const compactRef=useRef(compact);
 compactRef.current=compact;
 const surfaceRef=useRef<HTMLDivElement>(null);
 useSketchAnnotations(surfaceRef,ready);
 const slashListRef=useRef<HTMLDivElement>(null);
 const [slash,setSlash]=useState<SlashState|null>(null);
 const slashRef=useRef<SlashState|null>(null);
 slashRef.current=slash;
 const slashDismissedAt=useRef<number|null>(null);
 const runSlashRef=useRef<(command:SlashCommand)=>void>(()=>{});
 const [wiki,setWiki]=useState<WikiState|null>(null);
 const wikiRef=useRef<WikiState|null>(null);
 wikiRef.current=wiki;
 const chooseWikiRef=useRef<(hit:SearchHit)=>void>(()=>{});
 const wikiSearch=useQuery({...searchQuery(wiki?.query.trim()??'','metadata',12),enabled:Boolean(wiki&&wiki.query.trim())});
 const wikiMatches=(wikiSearch.data?.items??[]).filter(hit=>hit.kind==='document'||hit.kind==='task_list');
 const wikiHitsRef=useRef<SearchHit[]>([]);
 wikiHitsRef.current=wikiMatches;
 const detectWiki=(e:Editor)=>{
  const sel=e.state.selection,$from=sel.$from;
  if(!sel.empty||!e.isEditable||!$from.parent.isTextblock||$from.parent.type.spec.code){setWiki(null);return false;}
  const before=$from.parent.textBetween(0,$from.parentOffset,undefined,LEAF_PLACEHOLDER);
  const embed=/^::: embed ([^\n]{0,120})$/.exec(before.trimStart());
  const link=/(?:^|[\s(])\[\[([^\]\n]{0,120})$/.exec(before);
  const kind=embed?'embed':link?'link':null;
  if(!kind){setWiki(null);return false;}
  const query=embed?.[1]??link?.[1]??'';
  const from=$from.pos-query.length-(kind==='embed'?10:2);
  const surface=surfaceRef.current;
  if(!surface){setWiki(null);return true;}
  const coords=e.view.coordsAtPos(from),box=surface.getBoundingClientRect();
  const above=innerHeight-coords.bottom<SLASH_MENU_SPACE&&coords.top>SLASH_MENU_SPACE;
  setSlash(null);
  setWiki(last=>({kind,query,from,to:$from.pos,index:last?.from===from?last.index:0,
   placement:above?'above':'below',offset:above?box.bottom-coords.top+6:coords.bottom-box.top+6,
   left:Math.max(0,Math.min(coords.left-box.left,box.width-SLASH_MENU_WIDTH))}));
  return true;
 };
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
  StarterKit.configure({heading:false,paragraph:false,underline:false,codeBlock:false,link:false}),
  Link.configure({openOnClick:false}),
  ScrollCodeBlock.configure({defaultTheme:'github-light-high-contrast',themes:{light:'github-light-high-contrast',dark:'github-dark-high-contrast'}}),
  CustomHeading.configure({levels:[1,2,3,4,5,6]}),
  CustomParagraph,
  RawMarkdown,RawInline,RmdAttrsDecorations,
  WikiLinkNode.configure({sourceId:recordId}),WikiEmbedNode.configure({sourceId:recordId}),CrossReferenceNode,
  RichImage.configure({allowBase64:false}),
  TableWithMarkdown.configure({resizable:false,View:CaptionedScrollTableView}),TableRowWithMarkdown,TableHeaderWithMarkdown,TableCellWithMarkdown,
  TaskList,TaskItem.configure({nested:true}),
  UnderlineWithMarkdown,RmdMark,RmdSketchMark,HighlightWithMarkdown,SubscriptWithMarkdown,SuperscriptWithMarkdown,
  RichContainer,RichBadge,RichAbbr,RichTooltip,RichKbd,RichCloze,RichCritic,RichLinkCard,RichFootnoteRef,RichFootnoteDefinition,VisibleComment,
  TextAlignWithMarkdown.configure({types:['heading','paragraph'],alignments:['left','center','right']}),
  InlineMath.configure({katexOptions:{throwOnError:false,strict:false},onClick:(node,pos)=>setDialog({kind:'math',type:'inline',latex:String(node.attrs.latex??''),position:pos,existing:true})}),
  RmdBlockMath.configure({katexOptions:{throwOnError:false,strict:false},onClick:(node,pos)=>setDialog({kind:'math',type:'block',latex:String(node.attrs.latex??''),position:pos,existing:true,equationId:String(node.attrs.equationId??'')})}),
  Placeholder.configure({placeholder:({editor:e,node})=>node.type.name==='heading'?'标题 '+String(node.attrs.level??''):e.isEmpty?'输入“/”插入内容，或直接开始写作…':'输入“/”插入块'}),
 ],[recordId]);
 const editor=useEditor({
  extensions,content:{type:'doc',content:[{type:'paragraph'}]},immediatelyRender:false,
  onUpdate:({editor})=>{if(!applying.current){edited.current=true;onChange(serializeRmdVisual(editor.getJSON()));}if(!detectWiki(editor))detectSlash(editor);},
  onSelectionUpdate:({editor})=>{if(!detectWiki(editor))detectSlash(editor);followTableSelection(editor);},
  // Focus without a selection change (Tab, programmatic focus) must still place the table toolbar.
  onFocus:({editor})=>followTableSelection(editor),
  onBlur:()=>{setSlash(null);setWiki(null);setTableTarget(false);},
  editorProps:{handleKeyDown:(_view,event)=>{
   const e=editorRef.current;
   if(event.isComposing||!e)return false;
   const pending=wikiRef.current;
   if(pending){
    const hits=wikiHitsRef.current;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
     if(!hits.length)return true;
     const step=event.key==='ArrowDown'?1:-1;
     setWiki({...pending,index:(pending.index+step+hits.length)%hits.length});
     return true;
    }
    if(event.key==='Escape'){setWiki(null);return true;}
    if((event.key==='Enter'||event.key==='Tab')&&hits.length){
     chooseWikiRef.current(hits[Math.min(pending.index,hits.length-1)]!);
     return true;
    }
   }
   const state=slashRef.current;
   if(!state)return false;
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
 useEffect(()=>{slashListRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[slash?.index,slash?.query]);
 useEffect(()=>{
  if(!editor||checked.current)return;
  checked.current=true;
  applying.current=true;
  try{
   const richDocument=parseRmdVisual(value);
   // Loading a persisted document is not an undoable user edit. Without
   // this flag, a fast first drag can group with initialization history and
   // Ctrl+Z may erase the entire document instead of reverting the drag.
   editor.chain().setMeta('addToHistory',false).setContent(richDocument,{emitUpdate:false}).run();
  }catch{
   // Even when an extension fails, the user must never be trapped in a
   // source-only island. The fallback stays normal editable paragraph text.
   editor.chain().setMeta('addToHistory',false)
    .setContent({type:'doc',content:[rawMarkdownBlock(value)]},{emitUpdate:false}).run();
  }
  finally{applying.current=false;setReady(true);}
 },[editor,value]);
 useEffect(()=>{
  if(!editor||!ready)return;
  return decorateEditorLinks(editor.view.dom);
 },[editor,ready]);
 useEffect(()=>{
  if(!editor||!ready)return;
  const root=editor.view.dom;
  const open=(event:Event)=>{
   const position=(event as CustomEvent<{pos:number}>).detail?.pos;
   if(!Number.isInteger(position))return;
   const node=editor.state.doc.nodeAt(position);
   if(node&&isRmdAttrsEditable(node.type.name)){
    const owner=topLevelAtDocumentPosition(editor,position);
    if(!owner)return;
    blockPanelRef.current={pos:owner.pos,node:owner.node};
    attributeNodeRef.current={pos:position,type:node.type.name};
    setBlockPanelPos(owner.pos);
    setAttributeNodePos(position);
   }
  };
  const openDirectBlock=(event:Event)=>{
   const pos=(event as CustomEvent<{pos:number}>).detail?.pos;
   if(!Number.isInteger(pos))return;
   const target=editableBlockAt(editor,pos);
   if(!target)return;
   blockPanelRef.current={pos,node:target.node};
   attributeNodeRef.current=isRmdAttrsEditable(target.node.type.name)?{pos,type:target.node.type.name}:null;
   setAttributeNodePos(attributeNodeRef.current?.pos??null);
   setBlockPanelPos(pos);
  };
  root.addEventListener('rmd-edit-attrs',open);
  root.addEventListener('rmd-open-block-editor',openDirectBlock);
  return()=>{
   root.removeEventListener('rmd-edit-attrs',open);
   root.removeEventListener('rmd-open-block-editor',openDirectBlock);
  };
 },[editor,ready]);
 // Keep the inspected top-level block anchored as unrelated edits shift its
 // position. Close safely if an external transaction replaces/deletes it.
 useEffect(()=>{
  if(!editor)return;
  const listener=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(!transaction.docChanged||!blockPanelRef.current)return;
   const previous=blockPanelRef.current;
   // External edits: association +1 follows the block when content is
   // inserted at its former start. Our panel explicitly replaces its own
   // node, which mapping marks deleted; association -1 retains that anchor.
   const fromPanel=transaction.getMeta('rk-block-panel-edit')===true;
   const mapped=transaction.mapping.mapResult(previous.pos,fromPanel?-1:1);
   const current=editableBlockAt(editor,mapped.pos);
   if(!current||current.node.type!==previous.node.type||
    current.node.type.name==='richContainer'&&current.node.attrs.kind!==previous.node.attrs.kind||
    (!fromPanel&&mapped.deleted)){
    blockPanelRef.current=null;attributeNodeRef.current=null;
    setBlockPanelPos(null);setAttributeNodePos(null);return;
   }
   blockPanelRef.current={pos:current.pos,node:current.node};
   if(current.pos!==previous.pos)setBlockPanelPos(current.pos);
   const attrs=attributeNodeRef.current;
   if(attrs){
    const next=transaction.mapping.mapResult(attrs.pos,fromPanel?-1:1);
    const nextNode=editor.state.doc.nodeAt(next.pos);
    if(!nextNode||nextNode.type.name!==attrs.type||(!fromPanel&&next.deleted)){
     attributeNodeRef.current=null;setAttributeNodePos(null);
    }else if(next.pos!==attrs.pos){
     attributeNodeRef.current={pos:next.pos,type:attrs.type};setAttributeNodePos(next.pos);
    }
   }
  };
  editor.on('transaction',listener);
  return()=>{editor.off('transaction',listener);};
 },[editor]);
 // The selected text can disappear when the compact toolbar scrolls into
 // view or the menu trigger takes focus. Keep the last valid selection from
 // ProseMirror and only reuse it while the document itself is unchanged.
 useEffect(()=>{
  if(!editor)return;
  const remember=()=>{
   const {from,to}=editor.state.selection;
   if(from<to)lastEditorTextSelection.current={from,to,doc:editor.state.doc};
   else if(editor.isFocused)lastEditorTextSelection.current=null;
  };
  const invalidate=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(transaction.docChanged)lastEditorTextSelection.current=null;
  };
  editor.on('selectionUpdate',remember);
  editor.on('transaction',invalidate);
  return()=>{
   editor.off('selectionUpdate',remember);
   editor.off('transaction',invalidate);
  };
 },[editor]);
 useImperativeHandle(ref,()=>({flushEditedMarkdown:()=>{
  if(!editor)return null;
  const view=editor.view as typeof editor.view&{domObserver?:{flush:()=>void}};
  view.domObserver?.flush();
  return edited.current?serializeRmdVisual(editor.getJSON()):null;
 }}),[editor]);

 chooseWikiRef.current=hit=>{
  const selection=wikiRef.current;
  if(!editor||!selection)return;
  setWiki(null);
  editor.chain().focus().insertContentAt({from:selection.from,to:selection.to},{
   type:selection.kind==='link'?'wikiLink':'wikiEmbed',
   attrs:{target:'id:'+hit.id,anchor:null,alias:null}
  }).run();
 };
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
 const openWikiEmbed=()=>{
  // Reuse the existing UUID-pinned Wiki document selector.
  editor?.chain().focus().insertContent('::: embed ').run();
 };
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
     else editor.chain().focus().setNodeSelection(item.position).updateAttributes('blockMath',{latex:item.latex.trim(),equationId:item.equationId?.trim().toLowerCase()||null}).run();
    }else{
     editor.chain().focus().setNodeSelection(item.position).deleteSelection().run();
     if(item.type==='inline')editor.chain().focus().insertInlineMath({latex:item.latex.trim()}).run();
     else editor.chain().focus().insertContent({type:'blockMath',attrs:{latex:item.latex.trim(),equationId:item.equationId?.trim().toLowerCase()||null}}).run();
    }
   }
  }else if(item.kind==='math'){
   if(item.type==='inline')editor.chain().focus().insertInlineMath({latex:item.latex.trim()}).run();
   else editor.chain().focus().insertContent({type:'blockMath',attrs:{latex:item.latex.trim(),equationId:item.equationId?.trim().toLowerCase()||null}}).run();
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
 const editTableCaption=()=>{
  if(!editor)return;
  const attrs=editor.getAttributes('table');
  setTableCaptionDraft(String(attrs.caption??''));
  setTableIdDraft(String(attrs.tableId??''));
  setTableCaptionOpen(true);
 };
 const applyTableCaption=()=>{
  if(!editor)return;
  const tableId=tableIdDraft.trim().toLowerCase(),caption=cleanTableCaption(tableCaptionDraft);
  if((tableId&&!safeTableId(tableId))||Boolean(tableId)!==Boolean(caption))return;
  const attrs=editor.getAttributes('table');
  if(String(attrs.tableId??'')===tableId&&String(attrs.caption??'')===caption){setTableCaptionOpen(false);return;}
  const chain=editor.chain().focus();
  if(lastCellPos.current!==null)chain.setTextSelection(lastCellPos.current);
  chain.updateAttributes('table',{tableId:tableId||null,caption}).run();
  setTableCaptionOpen(false);
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
  command.run(editor,{openLink,openImage,openMath,openWikiEmbed});
 };
 if(!editor||!ready)return <div className="content-loading">正在准备可视化编辑器…</div>;
 const captureInlineRange=()=>{
  const dom=window.getSelection();
  let range:{from:number;to:number}|null=null;
  if(dom&&!dom.isCollapsed&&dom.anchorNode&&dom.focusNode&&
    editor.view.dom.contains(dom.anchorNode)&&editor.view.dom.contains(dom.focusNode)){
   try{
    const a=editor.view.posAtDOM(dom.anchorNode,dom.anchorOffset);
    const b=editor.view.posAtDOM(dom.focusNode,dom.focusOffset);
    if(a!==b)range={from:Math.min(a,b),to:Math.max(a,b)};
   }catch{/* fall back to the last ProseMirror selection */}
  }
  if(!range){const {from,to}=editor.state.selection;if(from!==to)range={from,to};}
  const remembered=lastEditorTextSelection.current;
  if(!range&&remembered?.doc===editor.state.doc)range={from:remembered.from,to:remembered.to};
  inlineSelectionRef.current=range;
 };
 const runCapturedInline=(run:()=>void)=>{
  const remembered=lastEditorTextSelection.current;
  const range=inlineSelectionRef.current??
   (remembered?.doc===editor.state.doc?{from:remembered.from,to:remembered.to}:null);
  inlineSelectionRef.current=null;
  if(range&&range.from<range.to&&range.to<=editor.state.doc.content.size)
   editor.commands.setTextSelection(range);
  run();
 };
 const runInlineFromMenu=(command:InlineCommand)=>runCapturedInline(()=>{command.run(editor);});
 const toggle=(name:string,pressed:boolean,run:()=>void,child:React.ReactNode)=>
  <ToggleButton key={name} label={name} size="sm" isPressed={pressed}
   onPointerEnter={captureInlineRange} onPointerDown={captureInlineRange} onPressedChange={()=>runCapturedInline(run)}>{child}</ToggleButton>;
 const action=(name:string,run:()=>void,child:React.ReactNode,disabled=false)=>
  <Button key={name} label={name} variant="ghost" size="sm" onMouseDown={event=>event.preventDefault()} onClick={run} isDisabled={disabled}>{child}</Button>;
 const slashItems=slash?filterSlashCommands(editor,slash.query):[];
 const slashGroups=slash?groupSlashCommands(slashItems):[];
 const menuIcon=(icon:React.ReactNode)=><span className="rk-inline-dropdown-icon" aria-hidden="true">
  {icon}<IconChevronDown className="rk-inline-dropdown-chevron" size="var(--rk-icon-xs)"/>
 </span>;
 const inlineMarks=<>
  {toggle('粗体',active?.bold??false,()=>editor.chain().focus().toggleBold().run(),<IconBold size="var(--rk-icon-sm)"/>)}
  {toggle('斜体',active?.italic??false,()=>editor.chain().focus().toggleItalic().run(),<IconItalic size="var(--rk-icon-sm)"/>)}
  {toggle('下划线',active?.underline??false,()=>editor.chain().focus().toggleUnderline().run(),<IconUnderline size="var(--rk-icon-sm)"/>)}
  {toggle('删除线',active?.strike??false,()=>editor.chain().focus().toggleStrike().run(),<IconStrikethrough size="var(--rk-icon-sm)"/>)}
  {toggle('语义 Mark',active?.mark??false,()=>runInlineRmdCommand(editor,'mark'),<IconHighlight size="var(--rk-icon-sm)"/>)}
  <DropdownMenu button={{label:'手绘标记',variant:'ghost',size:'sm',isIconOnly:true,icon:menuIcon(<IconPencil size="var(--rk-icon-sm)"/>),onPointerEnter:captureInlineRange,onPointerDown:captureInlineRange}}
   presentation="adaptive" items={inlineCommandsByGroup('hand-drawn').map(command=>({
    id:command.id,label:command.title,description:command.description,
    isDisabled:!command.isAvailable(editor),onClick:()=>{runInlineFromMenu(command);}
   }))}/>
  <DropdownMenu button={{label:'行内组件',variant:'ghost',size:'sm',isIconOnly:true,icon:menuIcon(<IconPlus size="var(--rk-icon-sm)"/>),onPointerEnter:captureInlineRange,onPointerDown:captureInlineRange}}
   presentation="adaptive" items={inlineCommandsByGroup('inline-component').map(command=>({
    id:command.id,label:command.title,description:command.description,
    isDisabled:!command.isAvailable(editor),onClick:()=>{runInlineFromMenu(command);}
   }))}/>
  <DropdownMenu button={{label:'更多行内功能',variant:'ghost',size:'sm',isIconOnly:true,icon:menuIcon(<IconDots size="var(--rk-icon-sm)"/>),onPointerEnter:captureInlineRange,onPointerDown:captureInlineRange}}
   presentation="adaptive" items={[
    {id:'inline-more-link',label:'链接',description:'为选中文字添加或编辑网页链接',
     onClick:()=>runCapturedInline(openLink)},
    {id:'inline-more-math',label:'行内公式',description:'插入可编辑 LaTeX 公式',
     onClick:()=>runCapturedInline(()=>openMath('inline'))},
    {id:'inline-more-wiki',label:'Wiki 引用',description:'在光标处输入 [[ 并搜索知识库文档',
     isDisabled:!editor.state.selection.empty,
     onClick:()=>runCapturedInline(()=>{editor.chain().focus().insertContent('[[').run();})},
    {id:'inline-more-footnote',label:'脚注引用',description:'在光标处插入可关联脚注定义的引用',
     isDisabled:!editor.state.selection.empty,
     onClick:()=>runCapturedInline(()=>{editor.chain().focus().insertContent({type:'richFootnoteRef',attrs:{id:'note'}}).run();})},
    {id:'inline-more-comment',label:'弱化注释',description:'把选中文字标记为可见注释',
     isDisabled:editor.state.selection.empty,
     onClick:()=>runCapturedInline(()=>{editor.chain().focus().setMark('visibleComment').run();})},
    {id:'inline-more-super',label:'上标',description:'将选中文字转换为上标',
     onClick:()=>runCapturedInline(()=>{editor.chain().focus().toggleSuperscript().run();})},
    {id:'inline-more-sub',label:'下标',description:'将选中文字转换为下标',
     onClick:()=>runCapturedInline(()=>{editor.chain().focus().toggleSubscript().run();})}
   ]}/>
 </>;
 return <div className="rk-editor-block-workspace" data-panel-open={blockPanelPos!==null?'true':'false'}>
  <div className="rk-editor-block-canvas">
  <div className="wysiwyg" ref={surfaceRef} onClickCapture={event=>{
  const target=event.target;
  if(!(target instanceof Element))return;
  const cell=target.closest('.tiptap td, .tiptap th') as HTMLTableCellElement|null;
  if(!cell){if(target.closest('.tiptap')){lastColumn.current=null;setTableCaptionOpen(false);requestAnimationFrame(()=>setTableTarget(false));}return;}
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
    {toggle('行内代码',active?.code??false,()=>editor.chain().focus().toggleCode().run(),<IconCode size="var(--rk-icon-sm)"/>)}
    {toggle('上标',active?.superscript??false,()=>editor.chain().focus().toggleSuperscript().run(),<IconSuperscript size="var(--rk-icon-sm)"/>)}
    {toggle('下标',active?.subscript??false,()=>editor.chain().focus().toggleSubscript().run(),<IconSubscript size="var(--rk-icon-sm)"/>)}
   </div>
   <div className="wysiwyg-tools">
    {toggle('二级标题',active?.heading2??false,()=>editor.chain().focus().toggleHeading({level:2}).run(),<IconH2 size="var(--rk-icon-sm)"/>)}
    {toggle('项目列表',active?.bulletList??false,()=>editor.chain().focus().toggleBulletList().run(),<IconList size="var(--rk-icon-sm)"/>)}
    {toggle('编号列表',active?.orderedList??false,()=>editor.chain().focus().toggleOrderedList().run(),<IconListNumbers size="var(--rk-icon-sm)"/>)}
    {toggle('任务清单',active?.taskList??false,()=>editor.chain().focus().toggleTaskList().run(),<IconListCheck size="var(--rk-icon-sm)"/>)}
    {toggle('引用',active?.blockquote??false,()=>editor.chain().focus().toggleBlockquote().run(),<IconQuote size="var(--rk-icon-sm)"/>)}
    {toggle('代码块',active?.codeBlock??false,()=>editor.chain().focus().toggleCodeBlock().run(),<IconCodeDots size="var(--rk-icon-sm)"/>)}
    {action('插入表格',()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run(),<IconTable size="var(--rk-icon-sm)"/>)}
   </div>
   <div className="wysiwyg-tools">
    {toggle('居中对齐',active?.alignCenter??false,()=>editor.chain().focus().setTextAlign('center').run(),<IconAlignCenter size="var(--rk-icon-sm)"/>)}
    {toggle('右对齐',active?.alignRight??false,()=>editor.chain().focus().setTextAlign('right').run(),<IconAlignRight size="var(--rk-icon-sm)"/>)}
    {action('左对齐',()=>editor.chain().focus().setTextAlign('left').run(),<IconAlignLeft size="var(--rk-icon-sm)"/>)}
   </div>
   <div className="wysiwyg-tools">
    {action('插入或编辑链接',openLink,<IconLink size="var(--rk-icon-sm)"/>)}
    {action('引用 Wiki 文档',()=>editor.chain().focus().insertContent('[[').run(),<IconBrackets size="var(--rk-icon-sm)"/>)}
    {action('嵌入 Wiki 文档',()=>editor.chain().focus().insertContent({type:'paragraph',content:[{type:'text',text:'::: embed '}]}).run(),<IconCodeDots size="var(--rk-icon-sm)"/>)}
    {action('插入或编辑图片',openImage,<IconPhotoPlus size="var(--rk-icon-sm)"/>)}
    {action('插入行内公式',()=>openMath('inline'),<IconMathFunction size="var(--rk-icon-sm)"/>)}
    {action('插入块级公式',()=>openMath('block'),<IconSum size="var(--rk-icon-sm)"/>)}
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
     ?action('插入或编辑图片',openImage,<IconPhotoPlus size="var(--rk-icon-sm)"/>)
     :!active?.textSelection
      ?action('插入或编辑链接',openLink,<IconLink size="var(--rk-icon-sm)"/>)
      :<div className="bubble-group">
       {inlineMarks}
       {toggle('行内代码',active?.code??false,()=>editor.chain().focus().toggleCode().run(),<IconCode size="var(--rk-icon-sm)"/>)}
       {toggle('弱化注释',editor.isActive('visibleComment'),()=>editor.chain().focus().toggleMark('visibleComment').run(),<IconMessageCircle size="var(--rk-icon-sm)"/>)}
       {action('插入或编辑链接',()=>runCapturedInline(openLink),<IconLink size="var(--rk-icon-sm)"/>)}
       {action('插入行内公式',()=>runCapturedInline(()=>openMath('inline')),<IconMathFunction size="var(--rk-icon-sm)"/>)}
      </div>}
   </div>
  </BubbleMenu>}
  <div hidden={!((active?.table&&active.focused)||tableTarget)} className="editor-table-actions" role="toolbar" aria-label="表格操作" style={{top:tableToolbarTop}}>
   <span className="muted small table-actions-label">表格</span>
   {action('在上方插入行',()=>tableCommand('addRowBefore'),<><IconTableRow size="var(--rk-icon-sm)"/><IconPlus size="var(--rk-icon-xs)"/></>,!tableTarget&&!editor.can().addRowBefore())}
   {action('在下方插入行',()=>tableCommand('addRowAfter'),<><IconTableRow size="var(--rk-icon-sm)"/><IconPlus size="var(--rk-icon-xs)"/></>,!tableTarget&&!editor.can().addRowAfter())}
   {action('删除当前行',()=>tableCommand('deleteRow'),<><IconTableRow size="var(--rk-icon-sm)"/><IconMinus size="var(--rk-icon-xs)"/></>,!tableTarget&&!editor.can().deleteRow())}
   <span className="editor-table-sep"/>
   {action('在前方插入列',()=>tableCommand('addColumnBefore'),<><IconColumns3 size="var(--rk-icon-sm)"/><IconPlus size="var(--rk-icon-xs)"/></>,!tableTarget&&!editor.can().addColumnBefore())}
   {action('在后方插入列',()=>tableCommand('addColumnAfter'),<><IconColumns3 size="var(--rk-icon-sm)"/><IconPlus size="var(--rk-icon-xs)"/></>,!tableTarget&&!editor.can().addColumnAfter())}
   {action('删除当前列',()=>tableCommand('deleteColumn'),<><IconColumns3 size="var(--rk-icon-sm)"/><IconMinus size="var(--rk-icon-xs)"/></>,!tableTarget&&!editor.can().deleteColumn())}
   <span className="editor-table-sep"/>
   {action('当前列左对齐',()=>alignTableColumn(editor,'left',lastColumn.current??undefined),<IconAlignLeft size="var(--rk-icon-sm)"/>)}
   {action('当前列居中对齐',()=>alignTableColumn(editor,'center',lastColumn.current??undefined),<IconAlignCenter size="var(--rk-icon-sm)"/>)}
   {action('当前列右对齐',()=>alignTableColumn(editor,'right',lastColumn.current??undefined),<IconAlignRight size="var(--rk-icon-sm)"/>)}
   <span className="editor-table-sep"/>
   {action('编辑表格图注与 ID',editTableCaption,<><IconPencil size="var(--rk-icon-sm)"/><span>表注</span></>)}
   {action('删除表格',()=>editor.chain().focus().deleteTable().run(),<IconTrash size="var(--rk-icon-sm)"/>,!tableTarget&&!editor.can().deleteTable())}
  </div>
  {tableCaptionOpen&&<div className="rk-table-caption-editor" role="group" aria-label="编辑表格图注与 ID" style={{top:tableToolbarTop+55}}>
   <TextInput label="表格 ID（tbl-...）" value={tableIdDraft} onChange={setTableIdDraft} placeholder="tbl-parameters"/>
   <TextInput label="表格图注" value={tableCaptionDraft} onChange={setTableCaptionDraft} placeholder="系统参数"/>
   <div className="rk-table-caption-editor-actions">
    <Button label="取消表注编辑" size="sm" variant="ghost" onClick={()=>setTableCaptionOpen(false)}>取消</Button>
    <Button label="保存表注" size="sm" onClick={applyTableCaption}
      isDisabled={Boolean(tableIdDraft.trim())!==Boolean(tableCaptionDraft.trim())||Boolean(tableIdDraft.trim())&&!safeTableId(tableIdDraft.trim().toLowerCase())}>保存</Button>
   </div>
  </div>}
  {compact?<EditorContent editor={editor}/>:<EditorContextMenu editor={editor} onEditBlock={pos=>{
   const target=editableBlockAt(editor,pos);
   if(!target)return;
   blockPanelRef.current={pos,node:target.node};
   attributeNodeRef.current=isRmdAttrsEditable(target.node.type.name)?{pos,type:target.node.type.name}:null;
   setAttributeNodePos(attributeNodeRef.current?.pos??null);
   setBlockPanelPos(pos);
  }}><EditorContent editor={editor}/></EditorContextMenu>}
  <BlockHandleLayer editor={editor} surfaceRef={surfaceRef} onEditBlock={pos=>{
   const target=editableBlockAt(editor,pos);
   if(!target)return;
   blockPanelRef.current={pos,node:target.node};
   attributeNodeRef.current=isRmdAttrsEditable(target.node.type.name)?{pos,type:target.node.type.name}:null;
   setAttributeNodePos(attributeNodeRef.current?.pos??null);
   setBlockPanelPos(pos);
  }}/>
  {slash&&slashItems.length>0&&<div className="slash-menu" ref={slashListRef} role="listbox" aria-label="插入内容" style={{...(slash.placement==='above'?{bottom:slash.offset}:{top:slash.offset}),left:slash.left,width:SLASH_MENU_WIDTH}} onMouseDown={event=>event.preventDefault()}>
   <div className="slash-menu-heading">{slash.query?'匹配的命令':'插入内容'}</div>
   {slashGroups.map(group=><div className="slash-category" key={group.id}>
    <div className="slash-category-heading">{group.label}</div>
    {group.commands.map(command=>{const index=slashItems.findIndex(item=>item.id===command.id);const Icon=command.icon;const selected=index===Math.min(slash.index,slashItems.length-1);return <div key={command.id} role="option" aria-selected={selected} className={'slash-item'+(selected?' is-selected':'')}
     onMouseEnter={()=>setSlash(current=>current&&{...current,index})} onClick={()=>runSlashRef.current(command)}>
     <span className="slash-icon"><Icon size="var(--rk-icon-md)"/></span><span className="slash-copy"><strong>{command.title}</strong><small>{command.description}</small></span></div>;})}
   </div>)}
  </div>}
  {wiki&&<div className="slash-menu wiki-completion" role="listbox" aria-label="引用文档"
   style={{...(wiki.placement==='above'?{bottom:wiki.offset}:{top:wiki.offset}),left:wiki.left,width:SLASH_MENU_WIDTH}}
   onMouseDown={event=>event.preventDefault()}>
   <div className="slash-menu-heading">{wiki.kind==='embed'?'嵌入文档':'引用文档'} · {wiki.query?'搜索结果':'输入名称搜索'}</div>
   {wikiSearch.isFetching&&<p className="muted small wiki-completion-status">搜索中…</p>}
   {wikiMatches.map((hit,index)=><div key={hit.id} role="option" aria-selected={index===Math.min(wiki.index,wikiMatches.length-1)}
    className={'slash-item'+(index===Math.min(wiki.index,wikiMatches.length-1)?' is-selected':'')}
    onMouseEnter={()=>setWiki(state=>state?{...state,index}:state)}
    onClick={()=>chooseWikiRef.current(hit)}>
    <span className="slash-copy"><strong>{hit.name}</strong><small>{hit.path??hit.id}</small></span>
   </div>)}
   {Boolean(wiki.query)&&!wikiSearch.isFetching&&!wikiMatches.length&&<p className="muted small wiki-completion-status">没有匹配文档，请更换关键词。</p>}
  </div>}
  {dialog&&<EditorInsertDialog key={dialog.kind+'-'+(dialog.kind==='math'?dialog.position??'new':dialog.kind==='link'?dialog.from:'image')} value={dialog} onClose={()=>setDialog(null)} onApply={applyDialog} onRemove={removeDialog}/>}
 </div>
 </div>
 {blockPanelPos!==null&&createPortal(
  <BlockEditorPanel editor={editor} pos={blockPanelPos} attributePos={attributeNodePos} recordId={recordId} mobile={compact}
   onClose={()=>{blockPanelRef.current=null;attributeNodeRef.current=null;setAttributeNodePos(null);setBlockPanelPos(null);}}/>,document.body)}
 </div>;
});
export default VisualEditor;
