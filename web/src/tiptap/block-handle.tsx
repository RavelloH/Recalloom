import {Icon} from '../icon';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '@tiptap/core';
import type {RefObject} from 'react';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {IconButton} from '@astryxdesign/core/IconButton';

import {blockCanReorder,blockSiblings,editableBlockAt,editableBlockFromDocumentPosition,isExplicitRmdBlock,moveBlockTo,topLevelAtDocumentPosition} from './editor-block-actions';
import {blockMenuItems} from './editor-command-menu';
import {SKETCH_DRAG_PREVIEW_EVENT,type SketchDragPreview} from '../sketch-drag-preview';
import './block-handle.css';

type HoverBlock={pos:number;x:number;y:number;element:HTMLElement};
type DragEntry={pos:number;element:HTMLElement;rect:DOMRect;selector:string};
type DragSession={
 source:HoverBlock;sourceIndex:number;entries:DragEntry[];
 target:{pos:number;after:boolean}|null;floating:HTMLElement;slot:HTMLElement;css:HTMLStyleElement;
 indexMap:Map<number,number>;lastPreviewIndex:number;
 styleRules:CSSStyleRule[];shiftValues:number[];
};
const explicitSelector='.rk-directive[data-rk-kind], .rk-rich-link-card[data-rk-link-card], .wiki-editor-embed';
function gripPosition(element:HTMLElement){
 const r=element.getBoundingClientRect();
 const width=38;
 const height=112;
 // The vertical handle belongs on the right. On narrow desktops clamp it
 // rather than jumping to the left edge of a wide paragraph.
 const x=Math.max(6,Math.min(r.right+8,innerWidth-width-6));
 const top=r.top+4;
 // Programmatic selection of an offscreen block (or virtual keyboard resize)
 // must not strand the grip in an unreachable viewport coordinate.
 const y=Math.max(6,Math.min(innerHeight-height-6,top));
 return {x,y};
}
function findExplicitBlock(editor:Editor,target:EventTarget|null):HoverBlock|null{
 const view=editor.view.dom;
 const source=target instanceof Element?target:target instanceof Node?target.parentElement:null;
 const element=source?.closest<HTMLElement>(explicitSelector);
 if(!element||!view.contains(element))return null;
 let pos:number;
 try{
  const domPos=editor.view.posAtDOM(element,0);
  // NodeView wrappers sometimes report the position immediately inside the
  // wrapper. Probe the boundary without ever selecting an arbitrary paragraph.
  const kind=element.dataset.rkKind;
  const candidates=[domPos,domPos-1,domPos+1].map(p=>
   editableBlockAt(editor,p)??editableBlockFromDocumentPosition(editor,p));
  const match=candidates.find(block=>block&&isExplicitRmdBlock(editor,block.pos)&&
   (kind?block.node.type.name==='richContainer'&&block.node.attrs.kind===kind:
    element.matches('.rk-rich-link-card')?block.node.type.name==='richLinkCard':
    block.node.type.name==='wikiEmbed'));
  if(!match)return null;
  pos=match.pos;
 }catch{return null;}
 return {pos,element,...gripPosition(element)};
}
function blockNode(editor:Editor,pos:number):HTMLElement|null{
 const node=editor.view.nodeDOM(pos);
 return node instanceof HTMLElement?node:node instanceof Element?node.closest<HTMLElement>(explicitSelector):null;
}
/** A temporary stylesheet moves ProseMirror-owned paragraphs and list nodes.
 * Changing className/style on those nodes directly makes ProseMirror restore
 * their attributes during drag, causing jitter and lost transforms. */
function nodeSelector(element:HTMLElement,root:HTMLElement):string|null{
 if(!root.contains(element))return null;
 let current:HTMLElement|null=element;
 const steps:string[]=[];
 while(current&&current!==root){
  const parent:HTMLElement|null=current.parentElement;
  if(!parent)return null;
  steps.unshift(' > :nth-child('+(Array.from(parent.children).indexOf(current)+1)+')');
  current=parent;
 }
 return '.record-main .tiptap'+steps.join('');
}
function makeDragSession(editor:Editor,source:HoverBlock,handle:HTMLElement):DragSession|null{
 const siblings=blockSiblings(editor,source.pos);
 const entries=siblings.map(item=>{
  const node=editor.view.nodeDOM(item.pos);
  const element=node instanceof HTMLElement?node:null;
  const selector=element?nodeSelector(element,editor.view.dom):null;
  return element&&selector?{pos:item.pos,element,rect:element.getBoundingClientRect(),selector}:null;
 }).filter((value):value is DragEntry=>value!==null);
 const sourceIndex=entries.findIndex(item=>item.pos===source.pos);
 if(sourceIndex<0||entries.length<2)return null;
 const floating=document.createElement('div');
 floating.className='rk-block-drag-floating';
 const icon=document.createElement('span');icon.className='rk-block-drag-floating-icon';
 const gripIcon=handle.querySelector('.rk-icon')?.cloneNode(true);
 if(gripIcon)icon.appendChild(gripIcon);
 const copy=document.createElement('span');copy.className='rk-block-drag-floating-copy';
 const title=document.createElement('strong');
 title.textContent=source.element.querySelector('.rk-directive-title-hit,.rk-link-card-title')?.textContent?.trim()||
  source.element.dataset.rkKind||'RMD 块';
 const summary=document.createElement('span');
 summary.className='rk-block-drag-floating-summary';
 summary.textContent=source.element.querySelector('.rk-directive-body')?.textContent?.trim().slice(0,94)||'拖动以调整块的位置';
 copy.append(title,summary);floating.append(icon,copy);
 document.body.appendChild(floating);
 document.body.classList.add('rk-block-drag-active');
 const slot=document.createElement('div');
 slot.className='rk-block-drop-slot';slot.setAttribute('aria-hidden','true');
 document.body.appendChild(slot);
 const css=document.createElement('style');
 css.setAttribute('data-rk-drag-styles','');document.head.appendChild(css);
 // One CSSOM rule per sibling. Never rewrite style.textContent or touch PM
 // contentDOM while the pointer moves. Update only siblings whose offset
 // actually changed; this reduces O(n) stylesheet reparses to O(delta).
 const styleRules:CSSStyleRule[]=[];
 const sheet=css.sheet;
 for(let i=0;i<entries.length;i++){
  if(!sheet)break;
  const selector=entries[i]!.selector;
  const opacity=i===sourceIndex?'opacity:.07!important;':'';
  sheet.insertRule(selector+'{'+opacity+
   'transition:transform .18s cubic-bezier(.2,.8,.2,1)!important;}',sheet.cssRules.length);
  styleRules.push(sheet.cssRules[sheet.cssRules.length-1] as CSSStyleRule);
 }
 const rect=entries[sourceIndex]!.rect;
 slot.style.left=rect.left+'px';slot.style.top=rect.top+'px';
 slot.style.width=rect.width+'px';slot.style.height=Math.max(rect.height,24)+'px';
 return {source,sourceIndex,entries,target:null,floating,slot,css,
  indexMap:new Map(entries.map((entry,i)=>[entry.pos,i])),lastPreviewIndex:-1,
  styleRules,shiftValues:entries.map(()=>0)};
}
function paintDrag(session:DragSession,index:number,clientX:number,clientY:number){
 // Pointer tracking is compositor-only: moving the thumbnail must not
 // repaint or re-layout the entire editor on every dragover event.
 const x=Math.max(6,Math.min(innerWidth-120,clientX+16));
 const y=Math.max(6,Math.min(innerHeight-65,clientY+14));
 session.floating.style.transform='translate3d('+x+'px,'+y+'px,0) rotate(-1.5deg)';
 if(index===session.lastPreviewIndex)return;
 session.lastPreviewIndex=index;
 const source=session.entries[session.sourceIndex]!;
 // Include the existing block gap so the displaced neighbours move into
 // the vacated slot without touching ProseMirror's DOM or transaction history.
 const below=session.entries[session.sourceIndex+1];
 const above=session.entries[session.sourceIndex-1];
 const downGap=below?Math.max(source.rect.height,below.rect.top-source.rect.top):source.rect.height;
 const upGap=above?Math.max(source.rect.height,source.rect.bottom-above.rect.bottom):source.rect.height;
 const delta=index>session.sourceIndex?downGap:index<session.sourceIndex?upGap:0;
 for(let i=0;i<session.entries.length;i++){
  if(i===session.sourceIndex)continue;
  const shift=index>session.sourceIndex&&i>session.sourceIndex&&i<=index?-delta:
   index<session.sourceIndex&&i>=index&&i<session.sourceIndex?delta:0;
  if(shift===session.shiftValues[i])continue;
  session.shiftValues[i]=shift;
  const rule=session.styleRules[i];
  if(!rule)continue;
  if(shift)rule.style.setProperty('transform','translate3d(0,'+shift+'px,0)','important');
  else rule.style.removeProperty('transform');
 }
 const top=index<session.sourceIndex?session.entries[index]!.rect.top:
  index>session.sourceIndex?session.entries[index]!.rect.bottom-delta:source.rect.top;
 session.slot.style.left=source.rect.left+'px';session.slot.style.top=top+'px';
 session.slot.style.width=source.rect.width+'px';
 session.slot.style.height=Math.max(24,source.rect.height)+'px';
 session.slot.dataset.moved=String(index!==session.sourceIndex);
 // The hand-drawn SVGs live in a separate layer outside ProseMirror.
 // Notify it only when the preview destination changes; the layer follows
 // the same compositor shifts without remeasuring/repainting every glyph.
 session.source.element.dispatchEvent(new CustomEvent<SketchDragPreview>(
  SKETCH_DRAG_PREVIEW_EVENT,{bubbles:true,detail:{
   source:session.source.element,
   shifts:session.entries.map((entry,i)=>({element:entry.element,offsetY:session.shiftValues[i]??0}))
  }}
 ));
}
function clearDrag(session:DragSession|null){
 if(!session)return;
 session.css.remove();
 session.floating.remove();session.slot.remove();
 document.body.classList.remove('rk-block-drag-active');
 // An aborted drag does not cause an editor document update; explicitly
 // reset and re-anchor SVGs for both cancel and successful drop.
 session.source.element.dispatchEvent(new CustomEvent<null>(
  SKETCH_DRAG_PREVIEW_EVENT,{bubbles:true,detail:null}
 ));
}

export function BlockHandleLayer({editor,surfaceRef,onEditBlock,enabled}:{
 editor:Editor;surfaceRef:RefObject<HTMLDivElement|null>;enabled:boolean;
 onEditBlock:(pos:number)=>void;
}){
 const [hover,setHover]=useState<HoverBlock|null>(null);
 const hoverRef=useRef<HoverBlock|null>(null);hoverRef.current=hover;
 const [menuOpen,setMenuOpen]=useState(false);
 const menuOpenRef=useRef(false);menuOpenRef.current=menuOpen;
 const dragRef=useRef<DragSession|null>(null);
 const selectedElement=useRef<HTMLElement|null>(null);
 const selectedPos=useRef<number|null>(null);
 const select=(pos:number|null,element:HTMLElement|null)=>{
  selectedElement.current?.classList.remove('rk-block-selected');
  selectedElement.current=null;selectedPos.current=null;
  if(pos!==null&&element&&isExplicitRmdBlock(editor,pos)){
   selectedElement.current=element;selectedPos.current=pos;
   element.classList.add('rk-block-selected');
  }
 };
 const selectRef=useRef(select);selectRef.current=select;
 useEffect(()=>{
  const surface=surfaceRef.current;
  if(!surface||!enabled)return;
  const place=(block:HoverBlock)=>{
   const next={...block,...gripPosition(block.element)};
   setHover(last=>last?.pos===next.pos&&last.element===next.element&&
    Math.abs(last.x-next.x)<1&&Math.abs(last.y-next.y)<1?last:next);
  };
  const move=(event:PointerEvent)=>{
   if(event.pointerType==='touch'||dragRef.current)return;
   if((event.target as Element)?.closest?.('.rk-block-grip'))return;
   const block=findExplicitBlock(editor,event.target);
   if(block)place(block);
   else if(!menuOpenRef.current)setHover(null);
  };
  const tap=(event:PointerEvent)=>{
   if(event.pointerType==='touch'){
    const block=findExplicitBlock(editor,event.target);
    if(block)place(block);
    return;
   }
   if(event.button===0&&!dragRef.current){
    const target=event.target as Element;
    if(!target?.closest?.('.rk-block-grip'))selectRef.current(null,null);
   }
  };
  const outsideMove=(event:PointerEvent)=>{
   const current=hoverRef.current;
   if(!current||event.pointerType==='touch'||dragRef.current||menuOpenRef.current)return;
   const target=event.target;
   // ProseMirror handles all pointer movement *inside* its surface.
   if(target instanceof Node&&surface.contains(target))return;
   if(target instanceof Element&&target.closest('.rk-block-grip'))return;
   const block=current.element.getBoundingClientRect();
   const gWidth=38;
   const gHeight=112;
   const left=Math.min(block.left,current.x)-13;
   const right=Math.max(block.right,current.x+gWidth)+13;
   const top=Math.min(block.top,current.y)-13;
   const bottom=Math.max(block.bottom,current.y+gHeight)+13;
   // Keep a continuous hover corridor between the block and its portaled
   // handle. Otherwise pointerleave kills the handle while crossing the gap.
   if(event.clientX<left||event.clientX>right||event.clientY<top||event.clientY>bottom)
    setHover(null);
  };
  const scroll=()=>{
   const current=hoverRef.current;
   if(current?.element.isConnected)place(current);
  };
  const selectFromContext=(event:Event)=>{
   const detail=(event as CustomEvent<{pos:number;element?:HTMLElement|null}>).detail;
   const block=Number.isInteger(detail?.pos)&&isExplicitRmdBlock(editor,detail.pos)?
    detail.pos:null;
   const element=block!==null?(detail.element??blockNode(editor,block)):null;
   selectRef.current(block,element);
  };
  const dragOver=(event:DragEvent)=>{
   const session=dragRef.current;
   if(!session)return;
   event.preventDefault();
   if(event.dataTransfer)event.dataTransfer.dropEffect='move';
   const at=editor.view.posAtCoords({left:event.clientX,top:event.clientY});
   const source=editableBlockAt(editor,session.source.pos);
   const top=at?topLevelAtDocumentPosition(editor,at.pos):null;
   const candidate=at&&source?(source.parentPos===null?
    (top?{...top,parentPos:null,parentKind:null}:null):
    editableBlockFromDocumentPosition(editor,at.pos)):null;
   if(!source||!candidate||!blockCanReorder(editor,source.pos)||
    (source.parentPos===null?false:
      candidate.parentPos!==source.parentPos||candidate.node.attrs.kind!==source.node.attrs.kind)){
    session.target=null;paintDrag(session,session.sourceIndex,event.clientX,event.clientY);return;
   }
   const targetIndex=session.indexMap.get(candidate.pos)??-1;
   if(targetIndex<0){session.target=null;paintDrag(session,session.sourceIndex,event.clientX,event.clientY);return;}
   const target=session.entries[targetIndex]!;
   const after=event.clientY>=target.rect.top+target.rect.height/2;
   const rawIndex=targetIndex+(after?1:0);
   const newIndex=Math.max(0,Math.min(session.entries.length-1,rawIndex>session.sourceIndex?rawIndex-1:rawIndex));
   session.target=newIndex===session.sourceIndex?null:{pos:target.pos,after};
   paintDrag(session,newIndex,event.clientX,event.clientY);
  };
  const drop=(event:DragEvent)=>{
   const session=dragRef.current;
   if(!session)return;
   event.preventDefault();event.stopPropagation();
   dragRef.current=null;
   const target=session.target;
   clearDrag(session);
   if(target)moveBlockTo(editor,session.source.pos,target.pos,target.after);
   selectRef.current(null,null);setHover(null);
  };
  surface.addEventListener('pointermove',move);
  surface.addEventListener('pointerdown',tap);
  window.addEventListener('pointermove',outsideMove,true);
  surface.addEventListener('dragover',dragOver,true);
  surface.addEventListener('drop',drop,true);
  surface.addEventListener('rk-block-select',selectFromContext);
  window.addEventListener('scroll',scroll,true);
  window.addEventListener('resize',scroll);
  return()=>{
   surface.removeEventListener('pointermove',move);
   surface.removeEventListener('pointerdown',tap);
   window.removeEventListener('pointermove',outsideMove,true);
   surface.removeEventListener('dragover',dragOver,true);
   surface.removeEventListener('drop',drop,true);
   surface.removeEventListener('rk-block-select',selectFromContext);
   window.removeEventListener('scroll',scroll,true);
   window.removeEventListener('resize',scroll);
   clearDrag(dragRef.current);dragRef.current=null;
   selectedElement.current?.classList.remove('rk-block-selected');
  };
 },[editor,surfaceRef,enabled]);
 useEffect(()=>{
  const element=hover?.element;
  if(!element)return;
  element.classList.add('rk-block-hovered');
  return()=>element.classList.remove('rk-block-hovered');
 },[hover?.element]);
 const startDrag=(event:React.DragEvent<HTMLButtonElement>)=>{
  if(!hover||!blockCanReorder(editor,hover.pos)){event.preventDefault();return;}
  const session=makeDragSession(editor,hover,event.currentTarget);
  if(!session){event.preventDefault();return;}
  dragRef.current=session;selectRef.current(hover.pos,hover.element);
  paintDrag(session,session.sourceIndex,event.clientX,event.clientY);
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('application/x-recalloom-block',String(hover.pos));
  event.dataTransfer.setData('text/plain','移动 RMD 块');
  // The browser's default semi-transparent screenshot obscures the live
  // placeholder, so use our own small floating block card instead.
  const transparent=document.createElement('canvas');transparent.width=1;transparent.height=1;
  event.dataTransfer.setDragImage(transparent,0,0);
  setMenuOpen(false);
 };
 const finishDrag=()=>{
  clearDrag(dragRef.current);dragRef.current=null;
  selectRef.current(null,null);setHover(null);
 };
 return <>{enabled&&hover&&createPortal(<div className="rk-block-grip" role="group" aria-label="块把手"
  style={{left:hover.x,top:hover.y}} onPointerDown={event=>event.stopPropagation()}>
  <IconButton className="rk-block-drag" label="拖动块" variant="ghost" size="sm"
   tooltip={blockCanReorder(editor,hover.pos)?'拖动调整块顺序；点击打开块操作':'点击打开子块操作（此类块不可拖动）'}
   icon={<Icon name="gripVertical" size="md"/>}
   draggable={blockCanReorder(editor,hover.pos)}
   onClick={()=>{selectRef.current(hover.pos,hover.element);setMenuOpen(open=>!open);}}
   onDragStart={startDrag} onDragEnd={finishDrag}/>
  <IconButton className="rk-block-edit" label="编辑块" variant="ghost" size="sm" icon={<Icon name="pencil" size="sm"/>}
    onClick={()=>{selectRef.current(hover.pos,hover.element);onEditBlock(hover.pos);setMenuOpen(false);}}/>
   <MoreMenu label="块操作" icon={<Icon name="dots" size="sm"/>}
   variant="ghost" size="sm" presentation="adaptive"
   isMenuOpen={menuOpen} onOpenChange={setMenuOpen}
   items={blockMenuItems({editor,pos:hover.pos,onEditBlock,onAction:()=>{setMenuOpen(false);setHover(null);}})}/>
 </div>,document.body)}</>;
}
