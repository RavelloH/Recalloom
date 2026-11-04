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
