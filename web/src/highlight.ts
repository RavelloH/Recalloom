/** True lexical matches only; semantic similarity has no character-level span. */
export function highlightedSegments(text:string,term:string){
 const q=term.trim();if(!q)return [{text,matched:false}];
 const lower=text.toLocaleLowerCase(),needle=q.toLocaleLowerCase();
 const parts:{text:string;matched:boolean}[]=[];let start=0,at:number;
 while((at=lower.indexOf(needle,start))!==-1){if(at>start)parts.push({text:text.slice(start,at),matched:false});parts.push({text:text.slice(at,at+q.length),matched:true});start=at+q.length;}
 if(start<text.length)parts.push({text:text.slice(start),matched:false});return parts.length?parts:[{text,matched:false}];
}
