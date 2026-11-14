import {useRef,useState,type ReactNode} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {DropdownMenu,DropdownMenuItem} from '@astryxdesign/core/DropdownMenu';
import type {FormatHoverKind} from '../tiptap/format-hover-preview';
import type {InlinePopupItem} from './types';

type Props={
 label:string;
 icon:ReactNode;
 items:InlinePopupItem[];
 isOpen:boolean;
 finePointer:boolean;
 selected:boolean;
 onOpenChange:(open:boolean)=>void;
 onCapture:()=>void;
 onEnter:()=>void;
 onLeave:()=>void;
 onPreview:(kind:FormatHoverKind|null)=>void;
 onChoose:(item:InlinePopupItem)=>void;
};

/** Adapts the public menu-button contract to a selection editor's hover menus. */
export function EditorInlinePopup({label,icon,items,isOpen,finePointer,selected,onOpenChange,onCapture,onEnter,onLeave,onPreview,onChoose}:Props){
 const [hoverSession,setHoverSession]=useState(0);
 const hovering=useRef(false);
 const hoverPress=useRef(false);
 const enter=()=>{
  onEnter();
  if(isOpen)return;
  onCapture();onPreview(null);
  hovering.current=true;
  // Astryx leaves focus alone when mounted already open. Each hover session
  // uses that controlled-state contract; keyboard/touch retain normal focus.
  setHoverSession(value=>value+1);
  onOpenChange(true);
 };
 return <span className="rk-inline-menu-anchor"
  onPointerEnter={event=>{if(finePointer&&event.pointerType==='mouse')enter();}}
  onPointerLeave={()=>{if(finePointer){onPreview(null);if(hovering.current)onLeave();}}}>
  <DropdownMenu key={hoverSession} isMenuOpen={isOpen}
   onOpenChange={open=>{onPreview(null);onOpenChange(open);}}
   placement="below" alignment="start" menuWidth={218} menuMaxHeight={336}
   className="rk-editor-format-menu" aria-label={label}
   onPointerEnter={onEnter}
   onPointerLeave={()=>{onPreview(null);if(finePointer&&hovering.current)onLeave();}}
   onMouseDown={event=>event.preventDefault()}
   renderTrigger={props=><Button {...props} label={label} variant="ghost" size="sm"
    className={'rk-inline-menu-trigger'+(selected?' rk-toolbar-state-selected':'')}
    onMouseDown={event=>event.preventDefault()}
    onPointerDown={event=>{
     onCapture();
     hoverPress.current=hovering.current&&isOpen&&event.pointerType==='mouse';
     if(hoverPress.current)return;
     hovering.current=false;props.onPointerDown(event);
    }}
    onClick={event=>{
     if(hoverPress.current){
      hoverPress.current=false;
      // A native auto-popover can light-dismiss on its outside trigger's
      // release. A click on an already-hovered category keeps it open, as
      // the editor did before, without adopting keyboard autofocus.
      setHoverSession(value=>value+1);onOpenChange(true);return;
     }
     hovering.current=false;props.onClick(event);
    }}
    onKeyDown={event=>{onCapture();hovering.current=false;props.onKeyDown(event);}}>{icon}</Button>}>
   {items.map(item=><DropdownMenuItem key={item.id}
    label={<span className="rk-inline-popover-item-label">{item.label}</span>}
    description={item.description?<span className="rk-inline-popover-item-description">{item.description}</span>:undefined} isDisabled={item.disabled}
    className="rk-editor-format-menu-item" data-active={item.active?'true':undefined}
    endContent={item.active?<span aria-hidden="true" className="rk-menu-item-check">✓</span>:undefined}
    onPointerEnter={event=>{if(event.pointerType==='mouse'&&!item.disabled)onPreview(item.preview??null);}}
    onPointerLeave={()=>onPreview(null)}
    onPointerMoveCapture={event=>{
     // Pure hover previews retain editor focus. A press or keyboard entry
     // returns ownership to Astryx; nested menu hover is never intercepted.
     if(hovering.current&&event.pointerType==='mouse'&&event.buttons===0)event.stopPropagation();
    }}
    onPointerDownCapture={()=>{onCapture();hovering.current=false;}}
    onFocus={()=>{if(!item.disabled)onPreview(item.preview??null);}}
    onBlur={()=>onPreview(null)}
    onClick={()=>{onPreview(null);onChoose(item);}}/>)}
  </DropdownMenu>
 </span>;
}
