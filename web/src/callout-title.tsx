import React from 'react';
import {StickyNote,Info,Lightbulb,CheckCircle2,AlertTriangle,ShieldAlert,BookOpen,HelpCircle} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

/** Preserve every callout type, while sharing the four Astryx Banner statuses. */
const icons:Record<string,LucideIcon>={
 note:StickyNote,info:Info,tip:Lightbulb,success:CheckCircle2,
 warning:AlertTriangle,danger:ShieldAlert,example:BookOpen,question:HelpCircle
};
export function calloutTitle(kind:string,title:React.ReactNode):React.ReactNode{
 const Icon=icons[kind];
 return Icon?<span className="rk-callout-heading" data-callout-kind={kind}>
  <Icon size={16} strokeWidth={2} aria-hidden="true"/><span>{title}</span>
 </span>:title;
}
