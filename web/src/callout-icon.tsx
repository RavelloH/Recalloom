import React from 'react';
import {StickyNote,Info,Lightbulb,CheckCircle2,AlertTriangle,ShieldAlert,BookOpen,HelpCircle} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

/** Preserve every callout type, while sharing the four Astryx Banner statuses. */
const icons:Record<string,LucideIcon>={
 note:StickyNote,info:Info,tip:Lightbulb,success:CheckCircle2,
 warning:AlertTriangle,danger:ShieldAlert,example:BookOpen,question:HelpCircle
};
/** Supply the semantic icon through Banner's own `icon` prop.
 * Putting another icon in title duplicates Banner's status icon. */
export function calloutIcon(kind:string):React.ReactNode{
 const Icon=icons[kind];
 return Icon?<Icon size={17} strokeWidth={2} aria-hidden="true"/>:undefined;
}
