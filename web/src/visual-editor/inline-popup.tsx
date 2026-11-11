import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import type {InlinePopup,InlinePopupItem} from './types';

type Props={
 popup:InlinePopup|null;
 onEnter:()=>void;
 onLeave:()=>void;
 onChoose:(item:InlinePopupItem)=>void;
};
export function EditorInlinePopup({popup,onEnter,onLeave,onChoose}:Props){
 const [retained,setRetained]=useState<InlinePopup|null>(popup);
 useEffect(()=>{
  if(popup){setRetained(popup);return;}
  if(!retained)return;
  // Keep the portal mounted until its exit transition completes.
  // Closing menus must be inert so an immediate trigger re-click works on touch.
  const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:160;
  const timeout=window.setTimeout(()=>setRetained(null),duration);
  return()=>window.clearTimeout(timeout);
 },[popup,retained]);
 const visible=popup??retained;
 if(!visible)return null;
 return createPortal(
  <div className="rk-inline-popover" role="menu" aria-label={visible.label}
   data-state={popup?'open':'closing'} aria-hidden={!popup}
   style={{left:visible.left,top:visible.top}}
   onPointerEnter={popup?onEnter:undefined} onPointerLeave={popup?onLeave:undefined}
   onMouseDown={event=>event.preventDefault()}>
   {visible.items.map(item=>
    <button key={item.id} type="button" role="menuitem" className="rk-inline-popover-item"
     data-active={item.active?'true':undefined}
     disabled={item.disabled} title={item.description??item.label}
     onClick={()=>onChoose(item)}>
     <span className="rk-inline-popover-item-label">{item.label}{item.active&&<span aria-hidden="true" className="rk-menu-item-check">✓</span>}</span>
     {item.description&&<span className="rk-inline-popover-item-description">{item.description}</span>}
    </button>)}
  </div>,document.body);
}
