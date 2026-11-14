import React,{memo,useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Drawer} from '@astryxdesign/core/Drawer';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {api} from './api';
import {Icon} from './icon';
import type {RecordDetail} from './types';
import './revision-diff.css';

const RevisionDiffContent=React.lazy(()=>import('./revision-diff-content'));
export type RevisionComparison={recordId:string;name:string;from:number;to:number};

/** Immutable revision reads are separate from the editor's live record query. */
export const RevisionDiffDrawer=memo(function RevisionDiffDrawer({comparison,isOpen,onOpenChange}:{
 comparison:RevisionComparison;isOpen:boolean;onOpenChange:(open:boolean)=>void
}){
 const drawerRef=useRef<HTMLDialogElement>(null);
 const [ready,setReady]=useState(false);
 const {recordId,from,to}=comparison;
 const query=useQuery({
  queryKey:['revision-comparison',recordId,from,to],enabled:isOpen,
  staleTime:Infinity,gcTime:10*60*1000,retry:false,
  queryFn:({signal})=>Promise.all([from,to].map(revision=>
   api<RecordDetail>('/records/'+recordId+'?revision='+revision,{signal})))
 });
 useEffect(()=>{
  if(!isOpen){
   // Native close also fires when reduced motion skips transition events.
   const dialog=drawerRef.current,release=()=>setReady(false);
   dialog?.addEventListener('close',release);
   return()=>dialog?.removeEventListener('close',release);
  }
  setReady(false);
  let disposed=false,secondFrame=0;
  // Let the native Drawer finish sliding before parsing and laying out math.
  // Observe its real animations so reduced-motion and instant entry also work.
  const firstFrame=requestAnimationFrame(()=>{
   secondFrame=requestAnimationFrame(()=>{
    const animations=drawerRef.current?.getAnimations?.()??[];
    void Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{
     if(!disposed)setReady(true);
    });
   });
  });
  return()=>{disposed=true;cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame);};
 },[isOpen,recordId,from,to]);

 return <Drawer ref={drawerRef} isOpen={isOpen} onOpenChange={onOpenChange}
  label="版本对比" side="end" width={1040} padding={0}
  experimental={{isFullWidthOnMobile:true}} className="revision-diff-drawer">
  <div className="revision-diff">
   <header className="revision-diff-header">
    <div className="revision-diff-heading">
     <span className="revision-diff-icon"><Icon name="arrowsDiff" size="md"/></span>
     <div><h2>版本对比</h2><p title={comparison.name}>{comparison.name}</p></div>
    </div>
    <div className="revision-diff-summary" aria-label={'Revision '+from+' 对比 Revision '+to}>
     <span>R{from}</span><Icon name="arrowRight" size="sm"/><span>R{to}</span>
    </div>
    <IconButton label="关闭版本对比" icon={<Icon name="x"/>} size="sm" variant="ghost"
     onClick={()=>onOpenChange(false)}/>
   </header>
   {query.isError?<div className="revision-diff-message"><Banner status="error" container="section"
     title="版本对比加载失败" description={query.error.message}
     endContent={<Button label="重试" size="sm" onClick={()=>void query.refetch()}/>}/></div>
    :query.data&&ready?<React.Suspense fallback={<ComparisonPending/>}>
      <RevisionDiffContent key={recordId+':'+from+':'+to} before={query.data[0]!.content}
       after={query.data[1]!.content} sourceId={recordId}/>
     </React.Suspense>:<ComparisonPending/>}
  </div>
 </Drawer>;
});
function ComparisonPending(){
 return <div className="revision-diff-pending" role="status" aria-live="polite">
  <span>正在准备版本对比…</span>
  <div aria-hidden="true" className="revision-diff-skeleton"><i/><i/><i/><i/></div>
 </div>;
}
