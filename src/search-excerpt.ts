import {paragraphChunkSpans} from './search-ranking.js';
import {searchSnippet,searchSnippetRange} from './search-snippet.js';
import {searchMarkdownText} from './search-markdown.js';
import {parseMarkdownOutline} from './outline.js';

export type SearchDocument={name:string;content:string;revision:number};
export type SearchProjection={version:1;text:string;start:number;end:number;lineStart:number;lineEnd:number;heading?:string};

/** Stored alongside an immutable chunk, so search only selects a query window. */
export function projectSearchChunk(document:SearchDocument,span:{start:number;end:number}):SearchProjection{
 const prefix=document.name.length+1;
 const start=Math.max(0,span.start-prefix),end=Math.max(0,span.end-prefix);
 const region=sourceRegion(document.content,start,end);
 const heading=start===0?parseMarkdownOutline(document.content.slice(0,8192),1).headings[0]:undefined;
 return {version:1,text:region.plain?region.source:searchMarkdownText(region.source),start,end,
  ...(start===0?{heading:heading?.level===1?heading.title:''}:{}),
  lineStart:1+(document.content.slice(0,region.start).match(/\r\n|\r|\n/g)?.length??0),
  lineEnd:1+(document.content.slice(0,region.end).match(/\r\n|\r|\n/g)?.length??0)};
}

export function readSearchProjection(value:string|null|undefined):SearchProjection|undefined{
 if(!value)return;
 try{
  const projection=JSON.parse(value) as SearchProjection;
  if(projection.version===1&&typeof projection.text==='string'&&
   [projection.start,projection.end,projection.lineStart,projection.lineEnd].every(Number.isInteger)&&
   projection.start>=0&&projection.end>=projection.start&&projection.lineStart>=1&&projection.lineEnd>=projection.lineStart)return projection;
 }catch{/* Older or incomplete projections fall back to the authoritative source. */}
}

export function projectedSearchExcerpt(query:string,projection:SearchProjection){
 return {snippet:searchSnippet(query,projection.text),snippetFormat:'text' as const,lineStart:projection.lineStart,lineEnd:projection.lineEnd};
}

/** Read a bounded source region while retaining enclosing code/math context. */
function sourceRegion(content:string,start:number,end:number){
 const lineStart=Math.max(content.lastIndexOf('\n',start-1),content.lastIndexOf('\r',start-1))+1;
 const following=[content.indexOf('\n',end),content.indexOf('\r',end)].filter(offset=>offset>=0);
 const lineEnd=following.length?Math.min(...following):content.length;
 if(lineEnd-lineStart>8192)return {source:content.slice(start,end),start,end,plain:true};
 start=lineStart;end=lineEnd;
 const preceding=[...content.slice(0,start).matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)].map(match=>({text:match[1]!,start:match.index!}));
 let fence='',math=false,contextStart=start;
 for(const line of preceding){
  const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
  if(marker&&!math){
   if(!fence){fence=marker[1]!;contextStart=line.start;}
   else if(marker[1]![0]===fence[0]&&marker[1]!.length>=fence.length&&!marker[2]!.trim())fence='';
  }else if(!fence&&/^\s*\${2,}/.test(line.text)){
   if(math)math=false;
   else if(!/^\s*\${2,}.*\${2,}\s*$/.test(line.text)){math=true;contextStart=line.start;}
  }
 }
 if(!fence&&!math)contextStart=start;
 let prefix=fence?fence+'\n':math?'$$\n':'';
 // A hit in the middle of a GFM table needs its column labels.
 if(!prefix&&content.slice(start,end).split('\n')[0]?.includes('|')){
  const separator=/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
  for(let i=preceding.length-2;i>0&&preceding[i]?.text.includes('|');i--){
   if(separator.test(preceding[i]!.text)){prefix=preceding[i-1]!.text+'\n'+preceding[i]!.text+'\n';contextStart=preceding[i-1]!.start;break;}
  }
 }
 return {source:prefix+content.slice(start,end),start:contextStart,end,plain:false};
}

export function searchExcerpt(query:string,raw:string,document?:SearchDocument,chunkIndex?:number){
 let range=document&&chunkIndex===undefined?searchSnippetRange(query,document.content,1200):undefined;
 if(document&&chunkIndex!==undefined){
  const span=paragraphChunkSpans(document.name+'\n'+document.content)[chunkIndex];
  if(span?.text===raw){
   const prefix=document.name.length+1;
   range={start:Math.max(0,span.start-prefix),end:Math.max(0,span.end-prefix)};
  }
 }
 if(document&&range){
  const region=sourceRegion(document.content,range.start,range.end);
  const text=region.plain?region.source:searchMarkdownText(region.source);
  return {snippet:searchSnippet(query,text),snippetFormat:'text' as const,
   lineStart:1+(document.content.slice(0,region.start).match(/\r\n|\r|\n/g)?.length??0),
   lineEnd:1+(document.content.slice(0,region.end).match(/\r\n|\r|\n/g)?.length??0)};
 }
 const window=searchSnippetRange(query,raw,1200);
 const region=sourceRegion(raw,window.start,window.end);
 return {snippet:searchSnippet(query,region.plain?region.source:searchMarkdownText(region.source)),snippetFormat:'text' as const};
}
