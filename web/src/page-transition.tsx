import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useBlocker,useRouter,useRouterState} from '@tanstack/react-router';
import {hasActiveEditorDirty} from './session-drafts';

/* InsightFlare-style route transition: the outgoing page eases out while the
   destination's loader warms its data, then the new page eases in complete.
   A router blocker that always resolves `false` delays every navigation
   (links, programmatic, back/forward) without ever cancelling one. */
const EXIT_MS=240,ENTER_MS=320;
type Phase='idle'|'exit'|'enter';
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export function PageTransition({children,scrollTarget}:{children:React.ReactNode;scrollTarget:()=>HTMLElement|null}){
 const router=useRouter();
 const pathname=useRouterState({select:state=>state.matches[state.matches.length-1]?.pathname??state.location.pathname});
 const pending=useRouterState({select:state=>state.status==='pending'});
 const [phase,setPhase]=useState<Phase>('idle');
 const exiting=useRef(false),lastPath=useRef(pathname),timer=useRef<ReturnType<typeof setTimeout>>(undefined);
 const enter=()=>{clearTimeout(timer.current);setPhase('enter');timer.current=setTimeout(()=>setPhase('idle'),ENTER_MS);};
 useBlocker({
  enableBeforeUnload:false,
  shouldBlockFn:async({current,next})=>{
   // Unsaved editors ask first; fading out behind that dialog would hide the page being kept.
   if(current.pathname===next.pathname||reduced()||hasActiveEditorDirty()||exiting.current)return false;
   exiting.current=true;
   clearTimeout(timer.current);
   setPhase('exit');
   void router.preloadRoute({to:next.fullPath,params:next.params,search:next.search} as Parameters<typeof router.preloadRoute>[0]).catch(()=>undefined);
   await wait(EXIT_MS);
   // A later blocker may still cancel the navigation; never leave the current page hidden.
   timer.current=setTimeout(()=>{
    if(exiting.current&&router.state.location.pathname===current.pathname&&router.state.status!=='pending'){exiting.current=false;enter();}
   },160);
   return false;
  }
 });
 useLayoutEffect(()=>{
  if(lastPath.current===pathname)return;
  lastPath.current=pathname;
  scrollTarget()?.scrollTo({top:0,left:0});
  const animate=exiting.current;
  exiting.current=false;
  if(animate)enter();else setPhase('idle');
 },[pathname]);
 useEffect(()=>{document.documentElement.dataset.routePhase=phase;},[phase]);
 useEffect(()=>()=>{clearTimeout(timer.current);delete document.documentElement.dataset.routePhase;},[]);
 return <>
  <div className="route-progress" aria-hidden="true" data-active={pending||undefined}/>
  <div className="page-transition" data-phase={phase}>{children}</div>
 </>;
}
