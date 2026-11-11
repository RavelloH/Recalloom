import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useRouterState} from '@tanstack/react-router';
import {clearSharedTransition,hasPendingSharedTransition} from './shared-view-transition';

/** Route presentation never blocks navigation, loaders or unsaved-draft guards.
 * A brief enter animation begins only after the destination is committed.
 * React Router/Query own data readiness, rather than a hard-coded exit timer.
 */
const ENTER_MS=180;
const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

export function PageTransition({children,scrollTarget}:{children:React.ReactNode;scrollTarget:()=>HTMLElement|null}){
 const pathname=useRouterState({select:state=>state.matches[state.matches.length-1]?.pathname??state.location.pathname});
 const pending=useRouterState({select:state=>state.status==='pending'});
 const [phase,setPhase]=useState<'idle'|'enter'>('idle');
 const lastPath=useRef(pathname);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useLayoutEffect(()=>{
  if(lastPath.current===pathname)return;
  lastPath.current=pathname;
  scrollTarget()?.scrollTo({top:0,left:0});
  clearTimeout(timer.current);
  // Router owns the native animation; never layer the legacy entrance on it.
  // The source selection survives long enough for the destination snapshot.
  const selected=hasPendingSharedTransition();
  if(selected)setTimeout(clearSharedTransition,650);
  if(reduced()||typeof document.startViewTransition==='function'){setPhase('idle');return;}
  setPhase('enter');
  timer.current=setTimeout(()=>setPhase('idle'),ENTER_MS);
 },[pathname,scrollTarget]);
 useEffect(()=>{document.documentElement.dataset.routePhase=phase;},[phase]);
 useEffect(()=>()=>{clearTimeout(timer.current);delete document.documentElement.dataset.routePhase;},[]);
 return <>
  <div className="route-progress" aria-hidden="true" data-active={pending||undefined}/>
  <div className="page-transition" data-phase={phase}>{children}</div>
 </>;
}
