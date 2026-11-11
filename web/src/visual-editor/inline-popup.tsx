import {createPortal} from 'react-dom';
import type {InlinePopup,InlinePopupItem} from './types';

type Props={
 popup:InlinePopup|null;
 onEnter:()=>void;
 onLeave:()=>void;
 onChoose:(item:InlinePopupItem)=>void;
};
export function EditorInlinePopup({popup,onEnter,onLeave,onChoose}:Props){
 if(!popup)return null;
 return createPortal(
  <div className="rk-inline-popover" role="menu" aria-label={popup.label}
   style={{left:popup.left,top:popup.top}}
   onPointerEnter={onEnter} onPointerLeave={onLeave}
   onMouseDown={event=>event.preventDefault()}>
   {popup.items.map(item=>
    <button key={item.id} type="button" role="menuitem" className="rk-inline-popover-item"
     data-active={item.active?'true':undefined}
     disabled={item.disabled} title={item.description??item.label}
     onClick={()=>onChoose(item)}>
     <span className="rk-inline-popover-item-label">{item.label}{item.active&&<span aria-hidden="true" className="rk-menu-item-check">✓</span>}</span>
     {item.description&&<span className="rk-inline-popover-item-description">{item.description}</span>}
    </button>)}
  </div>,document.body);
}
