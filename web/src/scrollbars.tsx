import React,{useEffect,useLayoutEffect,useRef} from 'react';
import {OverlayScrollbars,type PartialOptions} from 'overlayscrollbars';
import 'overlayscrollbars/overlayscrollbars.css';

/* JS overlay scrollbars everywhere except Apple WebKit, where native
   scrollbars already overlay content and keep momentum scrolling. */
export type ScrollAxis='x'|'y'|'both';
const theme={theme:'os-theme-recalloom',autoHide:'move',autoHideDelay:520,autoHideSuspend:false} as const;
const optionsFor=(axis:ScrollAxis,persistent=false):PartialOptions=>({
 overflow:{x:axis==='y'?'hidden':'scroll',y:axis==='x'?'hidden':'scroll'},
 scrollbars:{...theme,autoHide:persistent?'leave':theme.autoHide}
});

function isAppleWebKit(){
 const ua=navigator.userAgent||'',platform=navigator.platform||'';
 const iOS=/iPhone|iPad|iPod/i.test(ua)||(platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const otherEngine=/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR|Opera|Brave|Firefox/i.test(ua);
 return /AppleWebKit/i.test(ua)&&(iOS||(!otherEngine&&/Safari/i.test(ua)));
}
/** Runs before the first render so CSS can hide native bars without a flash. */
export function applyScrollbarPolicy(){
 document.documentElement.dataset.scrollbarMode=isAppleWebKit()?'native':'overlay';
}
export const usesNativeScrollbars=()=>document.documentElement.dataset.scrollbarMode==='native';

/** Edge fades tell readers that a horizontal block continues beyond the column. */
function trackEdges(host:HTMLElement,viewport:HTMLElement){
 const sync=()=>{
  const max=viewport.scrollWidth-viewport.clientWidth;
  host.toggleAttribute('data-edge-start',max>1&&viewport.scrollLeft>2);
  host.toggleAttribute('data-edge-end',max>1&&viewport.scrollLeft<max-2);
 };
 viewport.addEventListener('scroll',sync,{passive:true});
 const observer=new ResizeObserver(sync);
 observer.observe(viewport);
 if(viewport.firstElementChild)observer.observe(viewport.firstElementChild);
 sync();
 return()=>{viewport.removeEventListener('scroll',sync);observer.disconnect();};
}

/** Imperative attachment for DOM owned by ProseMirror node views. */
export function attachScrollbars(host:HTMLElement,viewport:HTMLElement,axis:ScrollAxis,{edges=false}:{edges?:boolean}={}){
 let instance:OverlayScrollbars|undefined;
 if(!usesNativeScrollbars())instance=OverlayScrollbars({target:host,elements:{viewport,content:false,padding:false}},optionsFor(axis));
 const untrack=edges?trackEdges(host,viewport):undefined;
 return()=>{untrack?.();if(instance&&OverlayScrollbars.valid(instance))instance.destroy();};
}

type ScrollProps=Omit<React.HTMLAttributes<HTMLDivElement>,'children'>&{
 axis?:ScrollAxis;children:React.ReactNode;viewportClassName?:string;viewportProps?:React.HTMLAttributes<HTMLDivElement>&{[key:`data-${string}`]:string|undefined};
 viewportRef?:React.Ref<HTMLDivElement>;persistent?:boolean;edges?:boolean;
};
function assign<T>(ref:React.Ref<T>|undefined,value:T|null){if(typeof ref==='function')ref(value);else if(ref)(ref as React.RefObject<T|null>).current=value;}

/** React-owned host/viewport pair; OverlayScrollbars never moves React children. */
export function OverlayScroll({axis='y',children,className='',viewportClassName='',viewportProps,viewportRef,persistent=false,edges=false,...props}:ScrollProps){
 const host=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const h=host.current,v=viewport.current;
  if(!h||!v||usesNativeScrollbars())return;
  const instance=OverlayScrollbars({target:h,elements:{viewport:v,content:false,padding:false}},optionsFor(axis,persistent));
  return()=>{if(OverlayScrollbars.valid(instance))instance.destroy();};
 },[axis,persistent]);
 useEffect(()=>{const h=host.current,v=viewport.current;if(edges&&h&&v)return trackEdges(h,v);},[edges]);
 return <div {...props} ref={host} className={('rk-scroll '+className).trim()} data-axis={axis}>
  <div {...viewportProps} ref={node=>{viewport.current=node;assign(viewportRef,node);}} className={('rk-scroll-viewport '+viewportClassName).trim()} data-axis={axis}>{children}</div>
 </div>;
}
