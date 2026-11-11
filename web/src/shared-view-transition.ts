import {useSyncExternalStore,type MouseEvent} from 'react';

/**
 * Each navigation may animate ONE selected resource. Keeping persistent names
 * on every list row causes the browser to snapshot all rows as separate old
 * layers, even though those rows have no destination match (visible ghosting).
 */
export type SharedResourceKind='record'|'folder';

export function sharedViewTransitionName(kind:SharedResourceKind,id:string):string {
 return 'rk-'+kind+'-'+Array.from(id,character=>
  /^[a-z\d_-]$/i.test(character)?character:'_'+character.codePointAt(0)!.toString(16)+'_'
 ).join('');
}

const listeners=new Set<()=>void>();
let selected:string|null=null;
let source:HTMLElement|null=null;
let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
const notify=()=>listeners.forEach(listener=>listener());
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const snapshot=()=>selected;
const serverSnapshot=()=>null;

/** The destination alone opts in, and only while its matching source is active. */
export function useSharedTransitionTarget(kind:SharedResourceKind,id:string):string|undefined {
 const current=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
 return current===kind+':'+id?sharedViewTransitionName(kind,id):undefined;
}

export function hasPendingSharedTransition():boolean {
 return selected!==null;
}

export function clearSharedTransition():void {
 if(cleanupTimer!==undefined){clearTimeout(cleanupTimer);cleanupTimer=undefined;}
 if(source){source.style.removeProperty('view-transition-name');source=null;}
 if(selected!==null){selected=null;notify();}
}

/**
 * Called synchronously in the Link capture phase, before TanStack Router
 * takes the outgoing snapshot. React renders the new target via the store.
 * Modified clicks and same-page links must not leave stale snapshot names.
 */
export function selectSharedTransition(event:MouseEvent<HTMLElement>,kind:SharedResourceKind,id:string,selector?:string):void {
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 if(typeof document.startViewTransition!=='function'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const targetPath=kind==='folder'?'/library/'+id:'/records/'+id;
 if(window.location.pathname===targetPath)return;
 const element=selector?event.currentTarget.querySelector<HTMLElement>(selector):event.currentTarget;
 if(!element)return;
 clearSharedTransition();
 selected=kind+':'+id;
 source=element;
 source.style.viewTransitionName=sharedViewTransitionName(kind,id);
 notify();
 // Native navigation may be blocked or its loader may be slow. Never retain
 // active snapshot names beyond one navigation, even after a failed attempt.
 cleanupTimer=setTimeout(clearSharedTransition,6000);
}
