import {useEffect,useState} from 'react';

export const COMPACT_QUERY='(max-width:720px)';

export function useMediaQuery(query:string){
 const [matches,setMatches]=useState(()=>typeof window!=='undefined'&&matchMedia(query).matches);
 useEffect(()=>{
  const media=matchMedia(query);
  const handle=()=>setMatches(media.matches);
  media.addEventListener('change',handle);
  handle();
  return()=>media.removeEventListener('change',handle);
 },[query]);
 return matches;
}

export const useCompactLayout=()=>useMediaQuery(COMPACT_QUERY);
/** Pointer capability, NOT screen width: a keyboard/mouse-equipped iPad may
 * opt into desktop interactions while a touch-only tablet keeps native UI. */
export const FINE_POINTER_QUERY='(hover: hover) and (pointer: fine)';
export const useFinePointer=()=>useMediaQuery(FINE_POINTER_QUERY);
