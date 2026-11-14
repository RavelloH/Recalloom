import React,{useState} from 'react';
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
 const [presentation,setPresentation]=useState(()=>({open,mobile}));
 if(presentation.open!==open)setPresentation({open,mobile:open?mobile:presentation.mobile});
 const compact=presentation.mobile;
 const inner=<div className="context-panel-inner">{children}</div>;
 return compact
  ?<BottomSheet isOpen={open} onOpenChange={onOpenChange} label={label} height="tall" padding={4}>{inner}</BottomSheet>
  :<Drawer isOpen={open} onOpenChange={onOpenChange} label={label} side="end" width={420} padding={4}>{inner}</Drawer>;
}
