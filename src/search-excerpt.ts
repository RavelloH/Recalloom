import {paragraphChunkSpans} from './search-ranking.js';
import {searchSnippet,searchSnippetRange} from './search-snippet.js';

export type SearchDocument={name:string;content:string;revision:number};

/** Read a bounded source region while retaining enclosing code/math context. */
function sourceRegion(content:string,start:number,end:number){
 const lineStart=Math.max(content.lastIndexOf('\n',start-1),content.lastIndexOf('\r',start-1))+1;
 const following=[content.indexOf('\n',end),content.indexOf('\r',end)].filter(offset=>offset>=0);
 const lineEnd=following.length?Math.min(...following):content.length;
 if(lineEnd-lineStart>8192)return {source:content.slice(start,end),start,end,plain:true};
 start=lineStart;end=lineEnd;
 let fence='',math=false,contextStart=start,contextLine=1,lineNumber=1;
 let previous:{text:string;start:number;line:number}|undefined;
 let header:{text:string;start:number;line:number}|undefined;
 const separator=/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
 const lines=/([^\r\n]*)(?:\r\n|\r|\n|$)/g;
 let match:RegExpExecArray|null;
 for(;(match=lines.exec(content))&&match.index<start;lineNumber++){
  const text=match[1]!;
  const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
  if(marker&&!math){
   if(!fence){fence=marker[1]!;contextStart=match.index;contextLine=lineNumber;}
   else if(marker[1]![0]===fence[0]&&marker[1]!.length>=fence.length&&!marker[2]!.trim())fence='';
  }else if(!fence&&/^\s*\${2,}/.test(text)){
   if(math)math=false;
   else if(!/^\s*\${2,}.*\${2,}\s*$/.test(text)){math=true;contextStart=match.index;contextLine=lineNumber;}
  }
  if(!text.includes('|'))header=undefined;
  else if(separator.test(text)&&previous)header={text:previous.text+'\n'+text,start:previous.start,line:previous.line};
  previous={text,start:match.index,line:lineNumber};
  if(!match[0].length)break;
 }
 if(!fence&&!math){contextStart=start;contextLine=lineNumber;}
 let prefix=fence?fence+'\n':math?'$$\n':'';
 if(!prefix&&header&&content.slice(start,end).split('\n')[0]?.includes('|')){
  prefix=header.text+'\n';contextStart=header.start;contextLine=header.line;
 }
 const lineEndNumber=lineNumber+(content.slice(start,end).match(/\r\n|\r|\n/g)?.length??0);

 return {source:prefix+content.slice(start,end),start:contextStart,end,plain:false,lineStart:contextLine,lineEnd:lineEndNumber};
}

export function searchExcerpt(query:string,raw:string,document?:SearchDocument,chunkIndex?:number){
 let range=document&&chunkIndex===undefined?searchSnippetRange(query,document.content,1200):undefined;
 if(document&&chunkIndex!==undefined){
  const span=paragraphChunkSpans(document.name+'\n'+document.content,1200,chunkIndex+1)[chunkIndex];
  if(span?.text===raw){
   const prefix=document.name.length+1;
   range={start:Math.max(0,span.start-prefix),end:Math.max(0,span.end-prefix)};
  }
 }
 if(document&&range){
  const region=sourceRegion(document.content,range.start,range.end);
  return {snippet:region.plain?searchSnippet(query,region.source):region.source,snippetFormat:region.plain?'text' as const:'markdown' as const,
   lineStart:region.lineStart??1+(document.content.slice(0,region.start).match(/\r\n|\r|\n/g)?.length??0),
   lineEnd:region.lineEnd??1+(document.content.slice(0,region.end).match(/\r\n|\r|\n/g)?.length??0)};
 }
 const window=searchSnippetRange(query,raw,1200);
 const region=sourceRegion(raw,window.start,window.end);
 return {snippet:region.plain?searchSnippet(query,region.source):region.source,snippetFormat:region.plain?'text' as const:'markdown' as const};
}
