import {Icon} from '../icon';
import React,{useEffect,useRef,useState,useImperativeHandle} from 'react';
import {createPortal} from 'react-dom';
import {useQuery} from '@tanstack/react-query';
import {searchQuery,type SearchHit} from '../queries';
import '../tiptap/editor.css';
import {Button} from '@astryxdesign/core/Button';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {useEditor,EditorContent} from '@tiptap/react';
import {BubbleMenu} from '@tiptap/react/menus';
import {NodeSelection} from '@tiptap/pm/state';
import type {Editor} from '@tiptap/core';
import {parseRmdVisual} from '../rmd-visual';
import {serializeRmdVisual} from '../rmd-serialize';
import {useSketchAnnotations} from '../sketch-annotations';
import {isRmdAttrsEditable} from '../tiptap/rmd-schema-attrs-model';
import {rawMarkdownBlock} from '../tiptap/raw-markdown';
import {decorateEditorLinks} from '../link-metadata-client';
import {selectedLink} from '../tiptap/editor-actions';
import {EditorInsertDialog,type InsertDialogState} from '../tiptap/insert-dialog';
import {filterSlashCommands,groupSlashCommands,matchSlashQuery,type SlashCommand} from '../tiptap/slash-commands';
import {BlockHandleLayer} from '../tiptap/block-handle';
import {BlockEditorPanel} from '../tiptap/block-editor-panel';
import {EditorContextMenu} from '../tiptap/editor-context-menu';
import {editableBlockAt,editableBlockFromDocumentPosition,isExplicitRmdBlock,topLevelAtDocumentPosition} from '../tiptap/editor-block-actions';
import {blockMenuItems} from '../tiptap/editor-command-menu';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {type InlineCommand} from '../tiptap/editor-inline-commands';
import {useCompactLayout,useFinePointer} from '../use-media';
import {safeTableId,cleanTableCaption} from '../table-caption';
import {useVisualEditorExtensions} from './use-extensions';
import {useVisualEditorSelection} from './use-selection';
import {buildMoreInlineItems,buildFormattingToolbar} from './formatting-toolbar';
import {tableToolbarOffset,SLASH_MENU_WIDTH,SLASH_MENU_SPACE} from './geometry';
import {EditorTableControls} from './table-controls';
import {EditorCompletions} from './completions';
import {EditorInlinePopup} from './inline-popup';
import type {SlashState,WikiState,InlinePopupItem,InlinePopup,VisualEditorHandle} from './types';
// Inline atoms (math, images) must not be mistaken for whitespace before "/".
const LEAF_PLACEHOLDER=String.fromCharCode(0xfffc);

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
 const [panelOpenCycle,setPanelOpenCycle]=useState(0);
 const [attributeNodePos,setAttributeNodePos]=useState<number|null>(null);
 const inlineSelectionRef=useRef<{from:number;to:number;doc:ProseMirrorNode}|null>(null);
 const [inlinePopup,setInlinePopup]=useState<InlinePopup|null>(null);
 const inlinePopupClose=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{
  if(!inlinePopup)return;
  const dismiss=(event:PointerEvent)=>{
   const target=event.target;
   if(target instanceof Element&&target.closest('.rk-inline-popover,.rk-inline-menu-trigger'))return;
   setInlinePopup(null);
  };
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){setInlinePopup(null);event.stopPropagation();}
  };
  document.addEventListener('pointerdown',dismiss,true);
  document.addEventListener('keydown',keydown,true);
  return()=>{
   document.removeEventListener('pointerdown',dismiss,true);
   document.removeEventListener('keydown',keydown,true);
  };
 },[inlinePopup]);
 useEffect(()=>()=>{if(inlinePopupClose.current!==null)clearTimeout(inlinePopupClose.current);},[]);
 const lastEditorTextSelection=useRef<{from:number;to:number;doc:ProseMirrorNode}|null>(null);
 const blockPanelRef=useRef<{pos:number;node:ProseMirrorNode}|null>(null);
 const attributeNodeRef=useRef<{pos:number;type:string}|null>(null);
 const compact=useCompactLayout();
 const finePointer=useFinePointer();
 const touchToolbar=!finePointer;
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
 const extensions=useVisualEditorExtensions(recordId,setDialog);
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
 const active=useVisualEditorSelection(editor);
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
    setPanelOpenCycle(n=>n+1);
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
   setPanelOpenCycle(n=>n+1);
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
  if(state.insertOnly)editor.chain().focus().setTextSelection(state.from).run();
  else editor.chain().focus().deleteRange({from:state.from,to:state.to}).run();
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
  // A menu click can call this again after focus has collapsed the native
  // selection. Never overwrite a valid range with null on the same document.
  if(range)inlineSelectionRef.current={...range,doc:editor.state.doc};
  else if(inlineSelectionRef.current?.doc!==editor.state.doc)inlineSelectionRef.current=null;
 };
 const runCapturedInline=(run:()=>void)=>{
  const remembered=lastEditorTextSelection.current;
  const captured=inlineSelectionRef.current;
  const range=(captured?.doc===editor.state.doc?captured:null)??
   (remembered?.doc===editor.state.doc?{from:remembered.from,to:remembered.to}:null);
  inlineSelectionRef.current=null;
  if(range&&range.from<range.to&&range.to<=editor.state.doc.content.size)
   editor.commands.setTextSelection(range);
  run();
 };
 const runInlineFromMenu=(command:InlineCommand)=>runCapturedInline(()=>{command.run(editor);});
 const toggle=(name:string,pressed:boolean,run:()=>void,child:React.ReactNode)=>
  <ToggleButton key={name} label={name} tooltip={name} size="sm" isPressed={pressed}
   onPointerEnter={captureInlineRange} onPointerDown={captureInlineRange} onPressedChange={()=>runCapturedInline(run)}>{child}</ToggleButton>;
 const action=(name:string,run:()=>void,child:React.ReactNode,disabled=false)=>
  <Button key={name} label={name} tooltip={name} variant="ghost" size="sm"
   onMouseDown={event=>event.preventDefault()} onClick={run} isDisabled={disabled}>{child}</Button>;
 const cancelPopupClose=()=>{
  if(inlinePopupClose.current!==null)clearTimeout(inlinePopupClose.current);
  inlinePopupClose.current=null;
 };
 const schedulePopupClose=()=>{
  cancelPopupClose();
  inlinePopupClose.current=setTimeout(()=>setInlinePopup(null),320);
 };
 const showInlinePopup=(anchor:HTMLElement,label:string,items:InlinePopupItem[])=>{
  cancelPopupClose();
  captureInlineRange();
  const rect=anchor.getBoundingClientRect(),height=Math.min(336,items.length*38+20);
  setInlinePopup({label,items,
   left:Math.max(8,Math.min(rect.left,window.innerWidth-248)),
   top:window.innerHeight-rect.bottom>height+10||rect.top<height+12
    ?rect.bottom+6:Math.max(8,rect.top-height-6)});
 };
 const categoryButton=(label:string,child:React.ReactNode,items:InlinePopupItem[],highlightActive=true)=>
  <Button key={label} label={label} tooltip={label} variant="ghost" size="sm"
   className={'rk-inline-menu-trigger'+(highlightActive&&items.some(item=>item.active)?' rk-toolbar-state-selected':'')} icon={menuIcon(child)} isIconOnly
   aria-haspopup="menu" aria-expanded={inlinePopup?.label===label}
   onMouseDown={event=>event.preventDefault()}
   onPointerDown={captureInlineRange}
   onPointerEnter={event=>{if(event.pointerType!=='touch')showInlinePopup(event.currentTarget,label,items);}}
   onPointerLeave={schedulePopupClose}
   onClick={event=>showInlinePopup(event.currentTarget,label,items)}/>;

 const slashItems=slash?filterSlashCommands(editor,slash.query):[];
 const slashGroups=slash?groupSlashCommands(slashItems):[];
 const menuIcon=(icon:React.ReactNode)=><span className="rk-inline-dropdown-icon" aria-hidden="true">
  {icon}<Icon name="chevronDown" className="rk-inline-dropdown-chevron" size="sm"/>
 </span>;
 const moreInlineItems=buildMoreInlineItems(editor,active,runCapturedInline,runInlineFromMenu);
 // Shared ordered toolbar: touch and desktop MUST render the very same
 // controls in DOM/tab order. Put the highest-frequency actions in the first
 // screenful on narrow touch devices; secondary formatting scrolls to the right.
 const sharedFormattingToolbar=buildFormattingToolbar({editor,active,categoryButton,toggle,action,runCapturedInline,runInlineFromMenu,openLink,openMath,moreInlineItems});
 const editBlock=(pos:number)=>{
  const target=editableBlockAt(editor,pos);
  if(!target)return;
  blockPanelRef.current={pos,node:target.node};
  attributeNodeRef.current=isRmdAttrsEditable(target.node.type.name)?{pos,type:target.node.type.name}:null;
  setAttributeNodePos(attributeNodeRef.current?.pos??null);
  setPanelOpenCycle(n=>n+1);
  setBlockPanelPos(pos);
 };
 const touchBlock=touchToolbar?editableBlockFromDocumentPosition(editor,active?.position??editor.state.selection.from):null;
 const touchBlockPos=touchBlock&&isExplicitRmdBlock(editor,touchBlock.pos)?touchBlock.pos:null;
 const openInsertMenu=(targetPos?:number,point?:{x:number;y:number})=>{
  setInlinePopup(null);
  const surface=surfaceRef.current;
  if(!surface)return;
  let pos=targetPos??editor.state.selection.from;
  if(point)pos=editor.view.posAtCoords({left:point.x,top:point.y})?.pos??pos;
  pos=Math.max(0,Math.min(pos,editor.state.doc.content.size));
  const bounds=surface.getBoundingClientRect();
  const rect=editor.view.coordsAtPos(pos);
  const y=point?.y??(touchToolbar?
   surface.querySelector('.wysiwyg-toolbar')?.getBoundingClientRect().bottom??rect.bottom:rect.bottom);
  const x=point?.x??(touchToolbar?bounds.left+12:rect.left);
  const above=innerHeight-y<SLASH_MENU_SPACE&&y>SLASH_MENU_SPACE;
  editor.commands.setTextSelection(pos);
  setSlash({from:pos,to:pos,query:'',index:0,insertOnly:true,
   placement:above?'above':'below',
   offset:above?bounds.bottom-y+8:y-bounds.top+8,
   left:Math.max(0,Math.min(x-bounds.left,bounds.width-SLASH_MENU_WIDTH))});
 };
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
  {touchToolbar&&<div className="wysiwyg-toolbar" role="toolbar" aria-label="格式工具栏">
   <div className="wysiwyg-tools wysiwyg-tools-leading">
    {action('插入内容',()=>openInsertMenu(),<Icon name="plus" size="sm"/>)}
    {touchBlockPos!==null&&<span className="wysiwyg-block-leading" role="group" aria-label="当前块操作">
     {action('编辑当前块',()=>editBlock(touchBlockPos),<Icon name="pencil" size="sm"/>)}
     <MoreMenu label="更多块操作" icon={<Icon name="dots" size="sm"/>}
      variant="ghost" size="sm" presentation="adaptive"
      items={blockMenuItems({editor,pos:touchBlockPos,onEditBlock:editBlock})}/>
    </span>}
   </div>
   <div className="wysiwyg-tools wysiwyg-tools-primary">{sharedFormattingToolbar}</div>
  </div>}
  {finePointer&&<BubbleMenu editor={editor} className="bubble-menu" options={{placement:'top',offset:8}}
   shouldShow={({editor:e,state,from,to})=>{
    if(!e.isEditable)return false;
    const selection=state.selection;
    if(selection instanceof NodeSelection)return selection.node.type.name==='image';
    if(e.isActive('codeBlock'))return false;
    return from!==to||e.isActive('link');
   }}>
   <div className="bubble-menu-inner" role="toolbar" aria-label="文本格式" onMouseDown={event=>event.preventDefault()}>
    {active?.imageSelected
     ?action('插入或编辑图片',openImage,<Icon name="photoPlus" size="sm"/>)
     :!active?.textSelection
      ?action('插入或编辑链接',openLink,<Icon name="link" size="sm"/>)
      :<div className="bubble-group">
       {sharedFormattingToolbar}
      </div>}
   </div>
  </BubbleMenu>}
  <EditorTableControls editor={editor} active={active} tableTarget={tableTarget} tableToolbarTop={tableToolbarTop}
   tableCaptionOpen={tableCaptionOpen} tableCaptionDraft={tableCaptionDraft} tableIdDraft={tableIdDraft}
   column={lastColumn.current} onTableCaptionDraftChange={setTableCaptionDraft} onTableIdDraftChange={setTableIdDraft}
   onCloseCaption={()=>setTableCaptionOpen(false)} applyTableCaption={applyTableCaption} editTableCaption={editTableCaption}
   tableCommand={tableCommand} action={action}/>
  {!finePointer?<EditorContent editor={editor}/>:<EditorContextMenu editor={editor} onEditBlock={editBlock}
   onEditLink={openLink} onInsert={(pos,point)=>openInsertMenu(pos,point)}><EditorContent editor={editor}/></EditorContextMenu>}
  <BlockHandleLayer editor={editor} surfaceRef={surfaceRef} enabled={finePointer} onEditBlock={editBlock}/>
  <EditorCompletions slash={slash} slashItems={slashItems} slashGroups={slashGroups} slashListRef={slashListRef}
   setSlash={setSlash} onRunSlash={command=>runSlashRef.current(command)} wiki={wiki} wikiMatches={wikiMatches}
   wikiFetching={wikiSearch.isFetching} setWiki={setWiki} onChooseWiki={hit=>chooseWikiRef.current(hit)}/>
  {dialog&&<EditorInsertDialog key={dialog.kind+'-'+(dialog.kind==='math'?dialog.position??'new':dialog.kind==='link'?dialog.from:'image')} value={dialog} onClose={()=>setDialog(null)} onApply={applyDialog} onRemove={removeDialog}/>}
 </div>
 </div>
 <EditorInlinePopup popup={inlinePopup} onEnter={cancelPopupClose} onLeave={schedulePopupClose}
  onChoose={item=>{cancelPopupClose();setInlinePopup(null);if(!item.disabled)item.run();}}/>
 {blockPanelPos!==null&&createPortal(
  <BlockEditorPanel key={panelOpenCycle} editor={editor} pos={blockPanelPos} attributePos={attributeNodePos} recordId={recordId} mobile={compact}
   onClose={()=>{blockPanelRef.current=null;attributeNodeRef.current=null;setAttributeNodePos(null);setBlockPanelPos(null);}}/>,document.body)}
 </div>;
});
export default VisualEditor;
