import React,{useEffect,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import type {PartialOptions} from 'overlayscrollbars';

// The static UI policy is lightweight. Load the scrollbar engine only where
// non-native scrollbars are actually needed; Apple WebKit never downloads it.
type ScrollbarEngine=typeof import('overlayscrollbars')['OverlayScrollbars'];
type ScrollbarInstance=ReturnType<ScrollbarEngine>;
let enginePromise:Promise<ScrollbarEngine>|undefined;
let loadedEngine:ScrollbarEngine|undefined;
const readyListeners=new Set<()=>void>();
const notifyReady=()=>{for(const listener of readyListeners)listener();};
const loadEngine=()=>enginePromise??=import('overlayscrollbars').then(m=>{
 loadedEngine=m.OverlayScrollbars;
 notifyReady();
 return loadedEngine;
}).catch(error=>{enginePromise=undefined;throw error;});
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

/** OverlayScrollbars changes viewport DOM on first attachment. Allow React
 * and the login/connection UI to render while its chunk loads, but gate the
 * authenticated shell until the engine is ready for synchronous layout-effect
 * initialization. This preserves the original one-shot row entrance animation. */
const subscribeReady=(listener:()=>void)=>{
 readyListeners.add(listener);
 return()=>{readyListeners.delete(listener);};
};
const scrollbarsReady=()=>usesNativeScrollbars()||Boolean(loadedEngine);
export const useScrollbarsReady=()=>useSyncExternalStore(subscribeReady,scrollbarsReady,()=>false);

/** Native Apple WebKit skips the import. Failed or stalled downloads
 * settle on native scrollbars for this page lifetime: upgrading after paint
 * would re-parent the viewport and repeat all row entrance animations. */
const SCROLLBAR_BOOT_TIMEOUT_MS=3000;
let bootstrapPromise:Promise<void>|undefined;
export function prepareScrollbars():Promise<void>{
 if(scrollbarsReady())return Promise.resolve();
 return bootstrapPromise??=(async()=>{
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([
    loadEngine(),
    new Promise<void>(resolve=>{timeout=setTimeout(resolve,SCROLLBAR_BOOT_TIMEOUT_MS);})
   ]);
  }catch{ /* Dynamic import failed; native scrolling remains available. */ }
  finally{if(timeout!==undefined)clearTimeout(timeout);}
  if(!loadedEngine&&!usesNativeScrollbars()){
   document.documentElement.dataset.scrollbarMode='native';
   notifyReady();
  }
 })();
}

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
 let instance:ScrollbarInstance|undefined,disposed=false;
 if(!usesNativeScrollbars()){
  const initialize=(engine:ScrollbarEngine)=>{
   if(!disposed&&host.isConnected&&viewport.isConnected)
    instance=engine({target:host,elements:{viewport,content:false,padding:false}},optionsFor(axis));
  };
  if(loadedEngine)initialize(loadedEngine);
  else void loadEngine().then(initialize).catch(()=>undefined);
 }
 const untrack=edges?trackEdges(host,viewport):undefined;
 return()=>{disposed=true;untrack?.();instance?.destroy();};
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
  let instance:ScrollbarInstance|undefined,disposed=false;
  const initialize=(engine:ScrollbarEngine)=>{
   if(!disposed&&h.isConnected&&v.isConnected)
    instance=engine({target:h,elements:{viewport:v,content:false,padding:false}},optionsFor(axis,persistent));
  };
  // A primed engine initializes synchronously in layout effect, before the
  // browser paints and starts child-row CSS animations for the first time.
  if(loadedEngine)initialize(loadedEngine);
  else void loadEngine().then(initialize).catch(()=>undefined);
  return()=>{disposed=true;instance?.destroy();};
 },[axis,persistent]);
 useEffect(()=>{const h=host.current,v=viewport.current;if(edges&&h&&v)return trackEdges(h,v);},[edges]);
 return <div {...props} ref={host} className={('rk-scroll '+className).trim()} data-axis={axis}>
  <div {...viewportProps} ref={node=>{viewport.current=node;assign(viewportRef,node);}} className={('rk-scroll-viewport '+viewportClassName).trim()} data-axis={axis}>{children}</div>
 </div>;
}
