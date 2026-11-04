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
