import React,{useEffect,useState} from 'react';
import {Drawer} from '@astryxdesign/core/Drawer';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {useCompactLayout} from './use-media';

/**
 * Astryx-owned overlay semantics: full-height inspector on large screens,
 * a touch-friendly bottom sheet on narrow screens. Both retain focus and
 * scrolling behavior without inserting controls below long documents.
 */
export function ContextPanel({open,onOpenChange,label,children}:{open:boolean;onOpenChange:(value:boolean)=>void;label:string;children:React.ReactNode}){
 const mobile=useCompactLayout();
 // Changing native overlay hosts while open reorders the browser top layer:
 // a responsive inspector would cover a comparison opened above it. Choose
 // the presentation once per opening, preserving focus and child overlays.
 const [presentation,setPresentation]=useState(()=>({open,mobile,ready:false}));
 if(presentation.open!==open)setPresentation({open,mobile:open?mobile:presentation.mobile,ready:false});
 // Native modal focus, scroll locking and a long document's layout can use
 // the first frame. Hold the panel offscreen until its top-layer host has
 // painted, then let Astryx run the full entry transition. Closing still
 // uses the component's own presence, timing and focus restoration.
 useEffect(()=>{
  if(!open)return;
  let frame=requestAnimationFrame(()=>{
   frame=requestAnimationFrame(()=>setPresentation(current=>current.open?{...current,ready:true}:current));
  });
  return()=>cancelAnimationFrame(frame);
 },[open]);
 const compact=presentation.mobile;
 const className='rk-context-panel-'+(compact?'sheet':'drawer')+(open&&!presentation.ready?' rk-context-panel-entering':'');
 const inner=<div className="context-panel-inner">{children}</div>;
 return compact
  ?<BottomSheet className={className} isOpen={open} onOpenChange={onOpenChange} label={label} height="tall" padding={4}>{inner}</BottomSheet>
  :<Drawer className={className} isOpen={open} onOpenChange={onOpenChange} label={label} side="end" width={420} padding={4}>{inner}</Drawer>;
}
