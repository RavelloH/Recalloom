import React,{useEffect,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import type {RefObject} from 'react';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {IconGripVertical,IconDots} from '@tabler/icons-react';
import {blockCanReorder,editableBlockAt,editableBlockFromDocumentPosition,moveBlockTo,topLevelAtDocumentPosition} from './editor-block-actions';
import {blockMenuItems} from './editor-command-menu';
import './block-handle.css';

type HoverBlock={pos:number;x:number;y:number;element:HTMLElement};
function findDirectBlock(view:HTMLElement,target:EventTarget|null):HTMLElement|null{
 if(!(target instanceof Node)||!view.contains(target))return null;
 let node=target instanceof Element?target:target.parentElement;
 while(node&&node.parentElement!==view)node=node.parentElement;
 return node instanceof HTMLElement&&node.parentElement===view?node:null;
}
function hoveredBlock(editor:Editor,surface:HTMLElement,target:EventTarget|null):HoverBlock|null{
 const view=editor.view.dom;
 const source=target instanceof Element?target:target instanceof Node?target.parentElement:null;
 // Prefer a nested child wrapper over its parent. Never expose arbitrary
 // paragraphs as independent structurally movable RMD children.
 const nested=source?.closest<HTMLElement>('.rk-directive[data-rk-kind]');
 if(nested&&view.contains(nested)){
  try{
   const domPos=editor.view.posAtDOM(nested,0),kind=nested.dataset.rkKind;
   for(const position of [domPos,domPos-1,domPos+1]){
    const candidate=editableBlockAt(editor,position)??editableBlockFromDocumentPosition(editor,position);
    if(candidate?.parentKind&&candidate.node.attrs.kind===kind){
     const a=nested.getBoundingClientRect(),s=surface.getBoundingClientRect();
     return {pos:candidate.pos,element:nested,
      x:Math.max(0,Math.min(a.right-s.left+4,s.width-78)),y:Math.max(0,a.top-s.top+3)};
    }
   }
  }catch{/* Fall through to the enclosing top-level block. */}
 }
 const element=findDirectBlock(view,target);
 if(!element)return null;
 let pos:number;
 try{pos=editor.view.posAtDOM(element,0);}catch{return null;}
 const block=topLevelAtDocumentPosition(editor,pos);
 if(!block)return null;
 const a=element.getBoundingClientRect(),s=surface.getBoundingClientRect();
 return {pos:block.pos,element,
  x:Math.max(0,Math.min(a.right-s.left+4,s.width-78)),
  y:Math.max(0,a.top-s.top+3)};
}
export function BlockHandleLayer({editor,surfaceRef,onEditBlock}:{
 editor:Editor;surfaceRef:RefObject<HTMLDivElement|null>;
 onEditBlock:(pos:number)=>void;
}){
 const [hover,setHover]=useState<HoverBlock|null>(null);
 const hoverRef=useRef<HoverBlock|null>(null);hoverRef.current=hover;
 const [menuOpen,setMenuOpen]=useState(false);
 const menuOpenRef=useRef(false);menuOpenRef.current=menuOpen;
 const dragSource=useRef<number|null>(null);
 const dropTarget=useRef<{pos:number;after:boolean}|null>(null);
 useEffect(()=>{
  const surface=surfaceRef.current;
  if(!surface)return;
  const position=(node:HTMLElement,pos:number)=>{
   const a=node.getBoundingClientRect(),s=surface.getBoundingClientRect();
   setHover(last=>{
    const x=Math.max(0,Math.min(a.right-s.left+4,s.width-78)),y=Math.max(0,a.top-s.top+3);
    return last?.pos===pos&&Math.abs(last.x-x)<1&&Math.abs(last.y-y)<1?last:{pos,element:node,x,y};
   });
  };
  const move=(event:PointerEvent)=>{
   if(event.pointerType==='touch'||dragSource.current!==null)return;
   const grip=(event.target as Element)?.closest?.('.rk-block-grip');
   if(grip)return;
   const block=hoveredBlock(editor,surface,event.target);
   if(block)position(block.element,block.pos);
   else if(!menuOpenRef.current)setHover(null);
  };
  const tap=(event:PointerEvent)=>{
   // On touch devices selection replaces hover, without hijacking the native
   // long-press text selection or the editable ProseMirror content.
   if(event.pointerType!=='touch')return;
   const block=hoveredBlock(editor,surface,event.target);
   if(block)position(block.element,block.pos);
  };
  const leave=()=>{if(!menuOpenRef.current&&dragSource.current===null)setHover(null)};
  const scroll=()=>{
   const current=hoverRef.current;
   if(current&&current.element.isConnected)position(current.element,current.pos);
  };
  const dragOver=(event:DragEvent)=>{
   if(dragSource.current===null)return;
   event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';
   const block=hoveredBlock(editor,surface,event.target);
   if(block){
    const r=block.element.getBoundingClientRect();
    dropTarget.current={pos:block.pos,after:event.clientY>r.top+r.height/2};
   }
  };
  const drop=(event:DragEvent)=>{
   if(dragSource.current===null)return;
   event.preventDefault();event.stopPropagation();
   const source=dragSource.current,target=dropTarget.current;
   dragSource.current=null;dropTarget.current=null;
   if(target)moveBlockTo(editor,source,target.pos,target.after);
   setHover(null);
  };
  surface.addEventListener('pointermove',move);
  surface.addEventListener('pointerdown',tap);
  surface.addEventListener('pointerleave',leave);
  surface.addEventListener('dragover',dragOver,true);
  surface.addEventListener('drop',drop,true);
  window.addEventListener('scroll',scroll,true);
  window.addEventListener('resize',scroll);
  return()=>{
   surface.removeEventListener('pointermove',move);
   surface.removeEventListener('pointerdown',tap);
   surface.removeEventListener('pointerleave',leave);
   surface.removeEventListener('dragover',dragOver,true);
   surface.removeEventListener('drop',drop,true);
   window.removeEventListener('scroll',scroll,true);
   window.removeEventListener('resize',scroll);
  };
 },[editor,surfaceRef]);
 const pos=hover?.pos??null;
 return <>{hover&&<div className="rk-block-grip" role="group" aria-label="块把手"
  style={{left:hover.x,top:hover.y}} onPointerDown={e=>e.stopPropagation()}>
  <button type="button" className="rk-block-drag" aria-label="拖动块"
   title={blockCanReorder(editor,hover.pos)?'拖动调整块顺序；点击打开块操作':'点击打开子块操作（此类块不可拖动）'}
   draggable={blockCanReorder(editor,hover.pos)}
   onClick={()=>setMenuOpen(open=>!open)}
   onDragStart={event=>{
    if(!blockCanReorder(editor,hover.pos)){event.preventDefault();return;}
    dragSource.current=hover.pos;dropTarget.current=null;
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('application/x-recalloom-block',String(hover.pos));
    event.dataTransfer.setData('text/plain','移动文档块');
    setMenuOpen(false);
   }}
   onDragEnd={()=>{dragSource.current=null;dropTarget.current=null;setHover(null);}}>
   <IconGripVertical size="var(--rk-icon-md)"/>
  </button>
  <MoreMenu label="块操作" icon={<IconDots size="var(--rk-icon-sm)"/>}
   variant="ghost" size="sm" presentation="adaptive"
   isMenuOpen={menuOpen} onOpenChange={setMenuOpen}
   items={blockMenuItems({editor,pos:hover.pos,onEditBlock,onAction:()=>{setMenuOpen(false);setHover(null);}})}/>
 </div>}</>;
}
