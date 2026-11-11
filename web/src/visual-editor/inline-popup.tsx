import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {FormatHoverKind} from '../tiptap/format-hover-preview';
import type {InlinePopup,InlinePopupItem} from './types';

type Props={
 popup:InlinePopup|null;
 onEnter:()=>void;
 onLeave:()=>void;
 onPreview:(kind:FormatHoverKind|null)=>void;
 onChoose:(item:InlinePopupItem)=>void;
};

export function EditorInlinePopup({popup,onEnter,onLeave,onPreview,onChoose}:Props){
 const previous=useRef<InlinePopup|null>(null);
 const [leaving,setLeaving]=useState<InlinePopup|null>(null);
 useEffect(()=>{
  const last=previous.current;
  // Crossfade between two hover menus. The outgoing one remains mounted,
  // inert and visually distinct until its exit animation completes.
  if(last&&(!popup||last.label!==popup.label)){
   setLeaving(last);
   onPreview(null);
  }
  previous.current=popup;
 },[popup?.label,popup===null]);
 useEffect(()=>{
  if(!leaving)return;
  const delay=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:160;
  const timeout=window.setTimeout(()=>setLeaving(null),delay);
  return()=>window.clearTimeout(timeout);
 },[leaving]);

 const outgoing=leaving??(previous.current&&(!popup||previous.current.label!==popup.label)?previous.current:null);
 const render=(menu:InlinePopup,closing:boolean)=><div
  key={menu.label+(closing?'-out':'-in')} className="rk-inline-popover"
  role="menu" aria-label={menu.label} aria-hidden={closing}
  data-state={closing?'closing':'open'} data-switching={Boolean(!closing&&outgoing)||undefined}
  style={{left:menu.left,top:menu.top}}
  onPointerEnter={!closing?onEnter:undefined}
  onPointerLeave={!closing?()=>{onPreview(null);onLeave();}:undefined}
  onMouseDown={event=>event.preventDefault()}>
  {menu.items.map(item=><button key={item.id} type="button" role="menuitem"
   className="rk-inline-popover-item" data-active={item.active?'true':undefined}
   disabled={item.disabled||closing} title={item.description??item.label}
   onPointerEnter={event=>{if(event.pointerType==='mouse'&&!item.disabled)onPreview(item.preview??null);}}
   onPointerLeave={()=>onPreview(null)}
   onFocus={()=>{if(!item.disabled)onPreview(item.preview??null);}}
   onBlur={()=>onPreview(null)}
   onClick={()=>{onPreview(null);onChoose(item);}}>
    <span className="rk-inline-popover-item-label">{item.label}{item.active&&<span aria-hidden="true" className="rk-menu-item-check">✓</span>}</span>
    {item.description&&<span className="rk-inline-popover-item-description">{item.description}</span>}
   </button>)}
 </div>;

 if(!popup&&!outgoing)return null;
 return createPortal(<>{outgoing&&render(outgoing,true)}{popup&&render(popup,false)}</>,document.body);
}
