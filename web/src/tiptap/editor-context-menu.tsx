import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '@tiptap/core';
import {CellSelection} from '@tiptap/pm/tables';
import {undo,redo,undoDepth,redoDepth} from '@tiptap/pm/history';
import type {ReactNode} from 'react';
import {ContextMenu,type ContextMenuOption} from '@astryxdesign/core/ContextMenu';
import type {DropdownMenuItemData} from '@astryxdesign/core/DropdownMenu';
import {
 IconArrowBackUp,IconArrowDown,IconArrowForwardUp,IconArrowUp,
 IconBold,IconCode,IconCopy,IconCut,IconDots,IconEdit,IconHighlight,
 IconItalic,IconNotes,IconPencil,IconPlus,IconStrikethrough,
 IconSubscript,IconSuperscript,IconTrash,IconUnderline,IconLink,IconPhoto,IconTable,IconClipboard,IconArrowBarToDown
} from '@tabler/icons-react';
import {blockMenuItems,inlineContextItems,runWithTextSelection} from './editor-command-menu';
import {editableBlockFromDocumentPosition,isExplicitRmdBlock} from './editor-block-actions';
import {inlineCommandsByGroup} from './editor-inline-commands';
import {pasteFromClipboard,linkContextItems,imageContextItems,tableContextItems,codeContextItems} from './editor-context-actions';
import './editor-context-menu.css';

const icons:Record<string,React.ComponentType<{size?:string|number}>>={
 'copy-selected-text':IconCopy,'cut-selected-text':IconCut,
 'delete-selected-text':IconTrash,'selection-bold':IconBold,
 'selection-italic':IconItalic,'selection-underline':IconUnderline,
 'selection-strike':IconStrikethrough,'selection-code':IconCode,
 'selection-superscript':IconSuperscript,'selection-subscript':IconSubscript,
 'selection-rmd-mark':IconHighlight,
 'rmd-inline-sketch':IconPencil,'rmd-inline-components':IconPlus,
 'edit-block':IconEdit,'copy-block-rmd':IconCopy,'duplicate-block':IconCopy,
 'move-block-up':IconArrowUp,'move-block-down':IconArrowDown,
  'link-open':IconLink,'link-copy':IconCopy,'link-edit':IconEdit,'link-unset':IconTrash,
  'image-download':IconArrowBarToDown,'image-copy':IconPhoto,
  'table-row-before':IconTable,'table-row-after':IconTable,'table-col-before':IconTable,'table-col-after':IconTable,
  'code-copy':IconCopy,'code-language':IconCode,'paste-clipboard':IconClipboard,'insert-here':IconPlus,
 'remove-block':IconTrash,'undo':IconArrowBackUp,'redo':IconArrowForwardUp
};
function iconOption(item:DropdownMenuItemData):DropdownMenuItemData{
 const Icon=icons[item.id??'']??IconDots;
 return item.id==='selection-rmd-mark'?{...item,icon:<span className="toolbar-highlight" aria-hidden="true">H</span>}:{...item,icon:<Icon size="var(--rk-icon-sm)"/>};
}
function isAction(item:ContextMenuOption):item is DropdownMenuItemData{
 return !('type' in item);
}
function grouped(title:string,items:ContextMenuOption[]):ContextMenuOption|null{
 const actions=items.filter(isAction).map(iconOption);
 return actions.length?{type:'section',title,items:actions}:null;
}
function getMenuPos(editor:Editor,event:React.MouseEvent<HTMLElement>):number{
 if(event.detail===0&&event.clientX===0&&event.clientY===0)return editor.state.selection.from;
 return editor.view.posAtCoords({left:event.clientX,top:event.clientY})?.pos??editor.state.selection.from;
}
/** A selection is contextual ONLY when the pointer is over its glyph rects.
 * A non-empty document selection elsewhere is not enough: right-clicking a
 * nearby block must not expose format/cut commands for unrelated text. */
type TextRange={from:number;to:number;doc:Editor['state']['doc']};
function currentTextRange(editor:Editor):TextRange|null{
 const {from,to}=editor.state.selection;
 return from<to?{from,to,doc:editor.state.doc}:null;
}
function nativeTextRange(editor:Editor):TextRange|null{
 const dom=window.getSelection(),view=editor.view.dom;
 if(!dom||dom.isCollapsed||!dom.anchorNode||!dom.focusNode||
  !view.contains(dom.anchorNode)||!view.contains(dom.focusNode))return null;
 try{
  const a=editor.view.posAtDOM(dom.anchorNode,dom.anchorOffset);
  const b=editor.view.posAtDOM(dom.focusNode,dom.focusOffset);
  return a===b?null:{from:Math.min(a,b),to:Math.max(a,b),doc:editor.state.doc};
 }catch{return null;}
}
/** Context actions are allowed only when the pointer intersects selected
 * glyph rectangles, not merely because a selection exists somewhere.
 * Accept snapshots because the browser can collapse the PM/native selection
 * before firing contextmenu after a right-button pointerdown. */
function clickedSelectedText(editor:Editor,event:React.MouseEvent<HTMLElement>,
 selection:TextRange|null):boolean{
 if(!selection||selection.doc!==editor.state.doc||selection.from>=selection.to||
  selection.to>editor.state.doc.content.size)return false;
 if(event.detail===0&&event.clientX===0&&event.clientY===0)return true;
 try{
  const start=editor.view.domAtPos(selection.from),end=editor.view.domAtPos(selection.to);
  const range=document.createRange();
  range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
  return Array.from(range.getClientRects()).some(rect=>
   event.clientX>=rect.left-2&&event.clientX<=rect.right+2&&
   event.clientY>=rect.top-2&&event.clientY<=rect.bottom+2);
 }catch{return false;}
}
/** Desktop-only: on touch, keep the native OS selection/callout behaviour. */
export function EditorContextMenu({editor,onEditBlock,onEditLink,onInsert,children}:{
 editor:Editor;onEditBlock:(pos:number)=>void;
 onEditLink:()=>void;onInsert:(pos:number,point:{x:number;y:number})=>void;
 children:ReactNode;
}){
 const [items,setItems]=useState<ContextMenuOption[]>([]);
 const [cursor,setCursor]=useState({x:0,y:0});
 const [feedback,setFeedback]=useState('');
 useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(''),3700);return()=>clearTimeout(timer);},[feedback]);
 const notify=(message:string)=>setFeedback(message);
 const rightPointerSelection=useRef<(TextRange&{x:number;y:number})|null>(null);
 const recentTextSelection=useRef<TextRange|null>(null);
 useEffect(()=>{
  const remember=()=>{const selected=currentTextRange(editor);if(selected)recentTextSelection.current=selected;};
  const invalidate=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(transaction.docChanged)recentTextSelection.current=null;
  };
  editor.on('selectionUpdate',remember);editor.on('transaction',invalidate);
  remember();
  return()=>{editor.off('selectionUpdate',remember);editor.off('transaction',invalidate);};
 },[editor]);
 const hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const hoverRow=useRef<HTMLElement|null>(null);
 useEffect(()=>()=>{if(hoverTimer.current!==null)clearTimeout(hoverTimer.current);},[]);
 const hoverNestedMenu=(event:React.PointerEvent<HTMLDivElement>)=>{
  if(event.pointerType!=='mouse')return;
  const target=event.target instanceof Element?event.target:null;
  const row=target?.closest<HTMLElement>('.rk-editor-context-popover [role="menuitem"][aria-haspopup="menu"]');
  if(!row||row===hoverRow.current)return;
  if(hoverTimer.current!==null)clearTimeout(hoverTimer.current);
  hoverRow.current=row;
  // Astryx ContextMenu's data flyouts sometimes miss hover-intent after the
  // outer layer is positioned manually. Preserve click semantics and add a
  // guarded hover-open fallback without stealing focus from text selection.
  hoverTimer.current=setTimeout(()=>{
   hoverTimer.current=null;
   if(row.isConnected&&hoverRow.current===row&&row.getAttribute('aria-expanded')!=='true')
    row.click();
  },180);
 };
 const leaveNestedMenu=(event:React.PointerEvent<HTMLDivElement>)=>{
  const row=hoverRow.current;
  if(!row||!(event.target instanceof Node)||!row.contains(event.target))return;
  if(event.relatedTarget instanceof Node&&row.contains(event.relatedTarget))return;
  hoverRow.current=null;
  if(hoverTimer.current!==null){clearTimeout(hoverTimer.current);hoverTimer.current=null;}
 };
 const captureRightPointer=(event:React.PointerEvent<HTMLDivElement>)=>{
  if(event.button===0){recentTextSelection.current=null;rightPointerSelection.current=null;return;}
  if(event.button!==2)return;
  const evt=event as unknown as React.MouseEvent<HTMLElement>;
  const choices=[currentTextRange(editor),nativeTextRange(editor),recentTextSelection.current];
  const matched=choices.find(range=>clickedSelectedText(editor,evt,range));
  rightPointerSelection.current=matched?{...matched,x:event.clientX,y:event.clientY}:null;
 };
 useLayoutEffect(()=>{
  // The third-party layer positions its container near the anchor and may
  // establish a containing block for a fixed child. Correct against the
  // ACTUAL viewport rect after the menu mounts, not guessed DOM ancestry.
  let frame=0;
  const start=performance.now();
  const align=()=>{
   const menu=document.querySelector<HTMLElement>('.rk-editor-context-popover[role="menu"]');
   if(menu){
    const rect=menu.getBoundingClientRect();
    if(rect.width>1&&rect.height>1){
     const left=Math.max(8,Math.min(cursor.x,innerWidth-rect.width-8));
     const top=Math.max(8,Math.min(cursor.y,innerHeight-rect.height-8));
     const dx=left-rect.left,dy=top-rect.top;
     if(Math.abs(dx)>1)menu.style.left=((Number.parseFloat(menu.style.left)||0)+dx)+'px';
     if(Math.abs(dy)>1)menu.style.top=((Number.parseFloat(menu.style.top)||0)+dy)+'px';
    }
   }
   // The third-party popover flips/re-sizes while its entrance animation and
   // nested menu rows settle. Keep it at the clicked viewport point just
   // during that short entrance, then stop all layout reads.
   if(performance.now()-start<480)frame=requestAnimationFrame(align);
  };
  frame=requestAnimationFrame(align);
  return()=>cancelAnimationFrame(frame);
 },[cursor]);
 const createMenu=(event:React.MouseEvent<HTMLElement>)=>{
  const keyboard=event.detail===0&&event.clientX===0&&event.clientY===0;
  const keyboardRect=keyboard?editor.view.coordsAtPos(editor.state.selection.from):null;
  const px=keyboardRect?keyboardRect.left:event.clientX;
  const py=keyboardRect?keyboardRect.bottom:event.clientY;
  // Astryx cursor-anchor positioning can resolve to the trigger's left edge
  // when the ProseMirror NodeView is nested/scrolling. Give the portaled menu
  // an explicit viewport coordinate, clamped to the visible screen.
  setCursor({x:Math.max(8,Math.min(px,innerWidth-252)),
   y:Math.max(8,Math.min(py,innerHeight-160))});
  const position=getMenuPos(editor,event);
  const current=editableBlockFromDocumentPosition(editor,position);
  const explicit=!!current&&isExplicitRmdBlock(editor,current.pos);
  const element=(event.target instanceof Element?
   event.target.closest<HTMLElement>('.rk-directive[data-rk-kind],.rk-rich-link-card,.wiki-editor-embed'):null);
  editor.view.dom.dispatchEvent(new CustomEvent('rk-block-select',{bubbles:true,
   detail:{pos:explicit?current!.pos:null,element}}));
  const captured=rightPointerSelection.current;
  const samePoint=captured&&Math.abs(captured.x-event.clientX)<3&&Math.abs(captured.y-event.clientY)<3;
  const matched=samePoint&&captured.doc===editor.state.doc?captured:
   [currentTextRange(editor),nativeTextRange(editor),recentTextSelection.current].find(range=>
    clickedSelectedText(editor,event,range));
  rightPointerSelection.current=null;
  // Object-specific targets outrank stale selections from another paragraph.
   const contextTarget=event.target instanceof Element?event.target:null;
   const selected=!!matched&&!contextTarget?.closest('img,td,th,pre');
  if(matched&&selected)editor.commands.setTextSelection({from:matched.from,to:matched.to});
  const selection={from:editor.state.selection.from,to:editor.state.selection.to};
  const formats=selected?inlineContextItems(editor):[];
  const copyActions=formats.filter(item=>isAction(item)&&['copy-selected-text','cut-selected-text','delete-selected-text'].includes(item.id??''));
  const textFormats=formats.filter(item=>isAction(item)&&!['copy-selected-text','cut-selected-text','delete-selected-text'].includes(item.id??''));
  const basicIds=['selection-bold','selection-italic','selection-underline','selection-rmd-mark'];
  const basicFormats=textFormats.filter(item=>isAction(item)&&basicIds.includes(item.id??''));
  const advancedFormats=textFormats.filter(item=>isAction(item)&&!basicIds.includes(item.id??''));
  const handDrawn:ContextMenuOption={id:'rmd-inline-sketch',label:'荧光笔与手绘标记',icon:<IconPencil size="var(--rk-icon-sm)"/>,
   items:inlineCommandsByGroup('hand-drawn').map(cmd=>({
    id:cmd.id,label:cmd.title,isDisabled:!cmd.isAvailable(editor),icon:<IconPencil size="var(--rk-icon-sm)"/>,
    onClick:()=>runWithTextSelection(editor,selection,()=>cmd.run(editor))
   }))};
  const components:DropdownMenuItemData[]=
   inlineCommandsByGroup('inline-component').map(cmd=>({
    id:cmd.id,label:cmd.title,isDisabled:!cmd.isAvailable(editor),icon:<IconNotes size="var(--rk-icon-sm)"/>,
    onClick:()=>runWithTextSelection(editor,selection,()=>cmd.run(editor))
   }));
  const actions=current?blockMenuItems({editor,pos:current.pos,onEditBlock}):[];
  const history=actions.filter(item=>isAction(item)&&['undo','redo'].includes(item.id??''));
  const blockActions=selected?[]:actions.filter(item=>isAction(item)&&!['undo','redo'].includes(item.id??''));
  const fallbackHistory:ContextMenuOption[]=history.length?history:[
   {id:'undo',label:'撤销',isDisabled:undoDepth(editor.state)===0,
    onClick:()=>{undo(editor.state,editor.view.dispatch);editor.view.focus();}},
   {id:'redo',label:'重做',isDisabled:redoDepth(editor.state)===0,
    onClick:()=>{redo(editor.state,editor.view.dispatch);editor.view.focus();}}
  ];
  const rawTarget=event.target instanceof Element?event.target:null;
   const link=rawTarget?.closest<HTMLAnchorElement>('a[href]');
   const image=rawTarget?.closest<HTMLImageElement>('img[src]');
   const tableCell=rawTarget?.closest<HTMLTableCellElement>('td,th');
   const codeBlock=rawTarget?.closest<HTMLElement>('pre');
   const context:ContextMenuOption[]=[];
   if(link?.getAttribute('href')){
    const group=grouped('链接',linkContextItems(editor,link.getAttribute('href')!,position,onEditLink,notify));
    if(group)context.push(group);
   }
   if(image?.getAttribute('src')){
    const group=grouped('图片',imageContextItems(image.src,notify));
    if(group)context.push(group);
   }
   if(tableCell){
    try{
     const cellPos=editor.view.posAtDOM(tableCell,0);
     if(!(editor.state.selection instanceof CellSelection))editor.commands.setTextSelection(cellPos);
     const group=grouped('表格',tableContextItems(editor,cellPos));
     if(group)context.push(group);
    }catch{/* Ignore non-content table chrome. */}
   }else if(codeBlock){
    try{
     const codePos=editor.view.posAtDOM(codeBlock.querySelector('code')??codeBlock,0);
     const codeActions=codeContextItems(editor,
      codeBlock.querySelector('code')?.textContent??codeBlock.textContent??'',codePos,notify);
     // Astryx sections intentionally render leaf items only. Submenus such as
     // language selection must live at the menu root to render their flyout.
     const copy=grouped('代码块',codeActions.filter(item=>item.id==='code-copy'));
     if(copy)context.push(copy);
     const language=codeActions.find(item=>item.id==='code-language');
     if(language)context.push(language);
    }catch{/* Ignore malformed code view. */}
   }
   const pasteAction:ContextMenuOption={id:'paste-clipboard',label:'粘贴',
    icon:<IconClipboard size="var(--rk-icon-sm)"/>,
    onClick:()=>{void pasteFromClipboard(editor,notify);}};
   const structure:ContextMenuOption[]=[];
  if(selected){
   const clipboard=grouped('剪贴板',[...copyActions,pasteAction]);
   const common=grouped('常用文字格式',basicFormats);
   if(clipboard)structure.push(clipboard);
   if(common)structure.push(common);
   // Related commands are a hierarchy, not a flat 15-row context menu.
   // Astryx nested items support both hover and click flyouts.
   structure.push({id:'selection-more',label:'更多文字格式',
    icon:<IconDots size="var(--rk-icon-sm)"/>,items:[...advancedFormats.filter(isAction).map(iconOption),...components]});
   structure.push(handDrawn);
   structure.push({type:'divider'});
  }
  if(!selected)structure.push(grouped('剪贴板',[pasteAction])!);
   if(context.length){structure.push(...context);structure.push({type:'divider'});}
   if(!selected&&!link&&!image&&!tableCell&&!codeBlock&&!explicit){
    structure.push({id:'insert-here',label:'插入',icon:<IconPlus size="var(--rk-icon-sm)"/>,
     onClick:()=>onInsert(position,{x:px,y:py})});
   }
   const blocks=grouped('块操作',blockActions);
  if(blocks)structure.push(blocks);
  const edits=grouped('历史',fallbackHistory);
  if(edits)structure.push(edits);
  setItems(structure);
 };
 return <div className="rk-editor-context-area"
   onContextMenuCapture={event=>{
    // Shift+right-click or a second right-click lets the browser handle
    // native spelling, translation, inspect and clipboard features.
    const menu=document.querySelector<HTMLElement>('.rk-editor-context-popover[role="menu"]');
    const menuVisible=!!menu&&menu.getClientRects().length>0&&
     getComputedStyle(menu).visibility!=='hidden'&&menu.getBoundingClientRect().width>1;
    if(event.shiftKey||menuVisible){
     event.stopPropagation();setItems([]);
    }
   }}
  onPointerDownCapture={captureRightPointer} onPointerOverCapture={hoverNestedMenu}
  onPointerOutCapture={leaveNestedMenu}>
  <ContextMenu label="编辑器右键菜单" menuWidth={244} size="sm"
   className="rk-editor-context-popover" presentation="popover"
   items={items} onContextMenu={createMenu}
   style={{position:'fixed',left:cursor.x,top:cursor.y,right:'auto',bottom:'auto'}}>
   {children}
  </ContextMenu>
   {feedback&&createPortal(<div className="rk-editor-context-feedback" role="status"
    style={{left:Math.max(8,Math.min(cursor.x,innerWidth-300)),top:Math.min(cursor.y+18,innerHeight-72)}}>
    {feedback}</div>,document.body)}
 </div>;
}
