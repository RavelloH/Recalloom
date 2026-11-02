import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type {JSONContent} from '@tiptap/core';
import {markdownRoundTripSafe,prepareVisualMarkdown} from './fidelity';
import {postProcessTableAlignment} from './table-alignment';

type MarkdownDriver={parse:(source:string)=>JSONContent;serialize:(doc:JSONContent)=>string};
type TopNode={position?:{start?:{offset?:number};end?:{offset?:number}}};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const raw=(source:string):JSONContent=>({type:'rawMarkdown',attrs:{source}});
const document=(content:JSONContent[]):JSONContent=>({type:'doc',content:content.length?content:[{type:'paragraph'}]});
const frontmatter=/^\uFEFF?(?:---|\+\+\+)[ \t]*\n[\s\S]*?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?=\n|$)/;

function sourceBlocks(source:string):string[]{
 const text=source.replace(/\r\n/g,'\n');
 const result:string[]=[];
 let offset=0;
 const metadata=frontmatter.exec(text);
 if(metadata){result.push(metadata[0]);offset=metadata[0].length;}
 const rest=text.slice(offset);
 const tree=parser.parse(rest);
 for(const item of tree.children as TopNode[]){
  const start=item.position?.start?.offset,end=item.position?.end?.offset;
  if(start===undefined||end===undefined||end<=start)continue;
  const chunk=rest.slice(start,end);
  if(chunk.trim())result.push(chunk);
 }
 // A parser may return no top-level nodes for an otherwise nonempty dialect.
 if(!result.length&&text.trim())result.push(text);
 return result;
}

/**
 * Only use rich-text nodes for blocks Tiptap can reconstruct faithfully.
 * Unsupported syntax is always a literal source atom, never silently dropped.
 * An ambiguous cross-block construct falls back to a single raw source atom.
 */
export function buildLosslessMarkdown(source:string,manager:MarkdownDriver):
 {doc:JSONContent;protectedCount:number;totalBlocks:number;wholeSource:boolean}{
 const prepared=prepareVisualMarkdown(source);
 try{
  const converted=postProcessTableAlignment(manager.parse(prepared),source);
  if(markdownRoundTripSafe(source,manager.serialize(converted))){
   return {doc:converted,protectedCount:0,totalBlocks:converted.content?.length??0,wholeSource:false};
  }
 }catch{/* Continue with block isolation. */}
 const blocks=sourceBlocks(source);
 const converted:JSONContent[]=[];
 let protectedCount=0;
 for(const block of blocks){
  try{
   // Front matter is never a normal thematic break.
   if(frontmatter.test(block))throw new Error('Front matter must remain literal');
   const parsed=postProcessTableAlignment(manager.parse(prepareVisualMarkdown(block)),block);
   if(!markdownRoundTripSafe(block,manager.serialize(parsed)))throw new Error('Unsupported Markdown');
   if(!parsed.content?.length)throw new Error('Empty parsing result');
   converted.push(...parsed.content);
  }catch{
   converted.push(raw(block));
   protectedCount++;
  }
 }
 const mixed=document(converted);
 try{
  const rendered=manager.serialize(mixed);
  const originPrefix=frontmatter.exec(source.replace(/\r\n/g,'\n'))?.[0];
  const comparableSource=originPrefix?source.replace(/\r\n/g,'\n').slice(originPrefix.length).trim():source;
  const comparableRendered=originPrefix&&rendered.startsWith(originPrefix)?rendered.slice(originPrefix.length).trim():rendered;
  if((!originPrefix||rendered.startsWith(originPrefix))&&markdownRoundTripSafe(comparableSource,comparableRendered)){
   return {doc:mixed,protectedCount,totalBlocks:blocks.length,wholeSource:false};
  }
 }catch{/* Cross-block Markdown syntax cannot be safely isolated. */}
 // No Markdown may be lost, including unfamiliar future dialects.
 return {doc:document([raw(source)]),protectedCount:1,totalBlocks:1,wholeSource:true};
}
