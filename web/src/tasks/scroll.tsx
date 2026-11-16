import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Spinner} from '@astryxdesign/core/Spinner';
import {AutoResizer,AutoTransition} from '../motion-primitives';

/** A single observer follows the real scroll viewport on native and overlay bars. */
export function useTaskIntersection(root:HTMLElement|null,enabled:boolean,onVisible:()=>void){
 const ref=useRef<HTMLDivElement>(null),callback=useRef(onVisible);callback.current=onVisible;
 useEffect(()=>{
  const target=ref.current;if(!target||!root||!enabled)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))callback.current();},{root,rootMargin:'180px'});
  observer.observe(target);return()=>observer.disconnect();
 },[root,enabled]);
 return ref;
}
export function TaskLoadMore({root,hasMore,loading,error,onLoad,animateWidth=true,loadingLabel='正在加载更多任务…'}:{root:HTMLElement|null;hasMore:boolean;loading:boolean;error:boolean;onLoad:()=>void;animateWidth?:boolean;loadingLabel?:string}){
 const ref=useTaskIntersection(root,hasMore&&!loading&&!error,onLoad);
 const state=loading?'loading':error?'error':hasMore?'more':'done';
 return <div className="tasks-load-more" ref={ref}><AutoResizer animateWidth={animateWidth}><AutoTransition transitionKey={state}>
  {loading?<Spinner size="sm" label={loadingLabel}/>:error?<Button label="加载失败，重试" variant="ghost" size="sm" onClick={onLoad}/>:hasMore?<Button label="加载更多" variant="ghost" size="sm" onClick={onLoad}/>:null}
 </AutoTransition></AutoResizer></div>;
}
/** Measure the remaining shell viewport, including record headers above an embedded list. */
export function useTaskViewHeight(){
 const ref=useRef<HTMLDivElement>(null),[height,setHeight]=useState<number>();
 useLayoutEffect(()=>{
  const host=ref.current,viewport=host?.closest<HTMLElement>('.main-scroll');if(!host||!viewport)return;
  let frame=0;
  const measure=()=>{
   cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
    const offset=host.getBoundingClientRect().top-viewport.getBoundingClientRect().top+viewport.scrollTop;
    setHeight(Math.max(180,Math.floor(viewport.clientHeight-offset-16)));
   });
  };
  const observer=new ResizeObserver(measure);observer.observe(viewport);if(host.parentElement)observer.observe(host.parentElement);
  window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);measure();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
 },[]);
 return {ref,height};
}
