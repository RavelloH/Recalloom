import {useSyncExternalStore} from 'react';

/** Small per-browser display preferences, shared by every page. */
const listeners=new Set<()=>void>();
const key='recalloom:full-width';
let fullWidth=(()=>{try{return localStorage.getItem(key)==='1';}catch{return false;}})();
export function setFullWidth(value:boolean){
 fullWidth=value;
 try{localStorage.setItem(key,value?'1':'0');}catch{ /* storage may be unavailable */ }
 listeners.forEach(fn=>fn());
}
export const useFullWidth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>fullWidth,()=>fullWidth);

const outlineListeners=new Set<()=>void>();
const outlineKey='recalloom:outline-open';
let outlineOpen=(()=>{try{return localStorage.getItem(outlineKey)==='1';}catch{return false;}})();
export function setOutlineOpen(value:boolean){
 if(outlineOpen===value)return;
 outlineOpen=value;
 try{localStorage.setItem(outlineKey,value?'1':'0');}catch{ /* storage may be unavailable */ }
 outlineListeners.forEach(fn=>fn());
}
export const useOutlineOpen=()=>useSyncExternalStore(fn=>{outlineListeners.add(fn);return()=>outlineListeners.delete(fn);},()=>outlineOpen,()=>outlineOpen);
