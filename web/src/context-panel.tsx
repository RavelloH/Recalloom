import React,{useEffect,useState} from 'react';
import {Drawer} from '@astryxdesign/core/Drawer';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';

/**
 * Astryx-owned overlay semantics: full-height inspector on large screens,
 * a touch-friendly bottom sheet on narrow screens. Both retain focus and
 * scrolling behavior without inserting controls below long documents.
 */
export function ContextPanel({open,onOpenChange,label,children}:{open:boolean;onOpenChange:(value:boolean)=>void;label:string;children:React.ReactNode}){
 const [mobile,setMobile]=useState(()=>typeof window!=='undefined'&&matchMedia('(max-width:720px)').matches);
 useEffect(()=>{
  const query=matchMedia('(max-width:720px)');
  const handle=()=>setMobile(query.matches);
  query.addEventListener('change',handle);
  handle();
  return()=>query.removeEventListener('change',handle);
 },[]);
 const inner=<div className="context-panel-inner">{children}</div>;
 return mobile
  ?<BottomSheet isOpen={open} onOpenChange={onOpenChange} label={label} height="tall" padding={4}>{inner}</BottomSheet>
  :<Drawer isOpen={open} onOpenChange={onOpenChange} label={label} side="end" width={420} padding={4}>{inner}</Drawer>;
}
