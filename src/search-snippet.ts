import {searchTerms} from './search-ranking.js';

/** Bounded source excerpt around the strongest lexical evidence in a hit chunk. */
export function searchSnippet(query:string,content:string,maxChars=350):string{
 const size=Math.max(40,Math.floor(maxChars));
 if(content.length<=size)return content;
 const width=size-2,lower=content.toLowerCase(),needle=query.toLowerCase();
 const exact=needle?lower.indexOf(needle):-1;
 let anchor=Math.max(0,exact);
 if(exact<0){
  const matches:Array<{start:number;end:number;term:number}>=[];
  for(const [term,text] of searchTerms(query).entries()){
   let offset=0;
   // Repeated boilerplate must not dominate the excerpt or its processing cost.
   for(let count=0;count<8;count++){
    const start=lower.indexOf(text,offset);if(start<0)break;
    matches.push({start,end:start+text.length,term});offset=start+text.length;
   }
  }
  matches.sort((a,b)=>a.start-b.start||a.end-b.end);
  const counts=new Map<number,number>();let left=0,best=0;
  for(let right=0;right<matches.length;right++){
   const hit=matches[right]!;counts.set(hit.term,(counts.get(hit.term)??0)+1);
   while(left<right&&hit.end-matches[left]!.start>width-60){
    const term=matches[left++]!.term,count=counts.get(term)!-1;
    if(count)counts.set(term,count);else counts.delete(term);
   }
   if(counts.size>best){best=counts.size;anchor=matches[left]!.start;}
  }
 }
 let start=Math.max(0,anchor-60);
 // Preserve a nearby line or sentence boundary without dropping the evidence.
 const boundary=[...content.slice(start,Math.min(anchor,start+40)).matchAll(/\n|[。！？]|[.!?](?=\s)/g)].at(-1);
 if(boundary?.index!==undefined)start+=boundary.index+1;
 // Keep UTF-16 cuts outside surrogate pairs.
 if(start>0&&/[\uDC00-\uDFFF]/.test(content[start]!))start--;
 let end=Math.min(content.length,start+width);
 if(end<content.length&&/[\uDC00-\uDFFF]/.test(content[end]!))end--;
 return (start?'…':'')+content.slice(start,end).trim()+(end<content.length?'…':'');
}
