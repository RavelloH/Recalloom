import {startTransition,useEffect,useLayoutEffect,useRef} from 'react';
import {createDocumentCharacterCounter,type DocumentCharacterCounter} from './document-character-counter';
import {markdownCharacterCount} from './document-heading';

/** Publishes counts without rendering the editor for intermediate results. */
export function useDocumentCharacterCount(markdown:string,onCount:(characters:number)=>void):void{
 const initial=useRef<{markdown:string;characters:number}|null>(null);
 if(initial.current===null){
  initial.current={markdown,characters:markdownCharacterCount(markdown)};
 }
 const counted=useRef(initial.current);
 const publish=useRef(onCount);
 const latestMarkdown=useRef(markdown);
 const lastRequestedMarkdown=useRef(initial.current.markdown);
 const counterRef=useRef<DocumentCharacterCounter|null>(null);

 useEffect(()=>{
  const counter=createDocumentCharacterCounter((source,count)=>{
   if(latestMarkdown.current!==source)return;
   counted.current={markdown:source,characters:count};
   // Metadata updates should leave typing and selection work at normal priority.
   startTransition(()=>publish.current(count));
  });
  counterRef.current=counter;
  return()=>{
   counter.dispose();
   if(counterRef.current===counter)counterRef.current=null;
  };
 },[]);

 useLayoutEffect(()=>{
  latestMarkdown.current=markdown;
  publish.current=onCount;
 },[markdown,onCount]);

 // Also publish after the caller's record/revision changes, without recounting.
 useEffect(()=>{
  const result=counted.current;
  if(result.markdown===latestMarkdown.current)startTransition(()=>onCount(result.characters));
 },[onCount]);

 useEffect(()=>{
  if(markdown===lastRequestedMarkdown.current)return;
  lastRequestedMarkdown.current=markdown;
  counterRef.current?.request(markdown);
 },[markdown]);
}
