import type {JSONContent} from '@tiptap/core';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {prepareVisualMarkdown} from './visual-input';
import {rawMarkdownBlock} from './raw-markdown';
import {postProcessTableAlignment} from './table-alignment';
import {findMarkedDisplayMath} from './marked-display-math';

type MarkdownDriver={parse:(source:string)=>JSONContent};
type AstNode={type:string;value?:string;children?:AstNode[];
 position?:{start?:{offset?:number};end?:{offset?:number}}};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const frontmatter=/^\uFEFF?(?:---|\+\+\+)[ \t]*\n[\s\S]*?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?=\n|$)/;


/** Unknown Markdown/HTML is displayed as plain editable text while its
 * original source is retained verbatim when other blocks are edited.
 * An unknown inline token makes only its containing block raw. */
const supportedAstNodes=new Set([
 'root','paragraph','heading','blockquote','list','listItem','thematicBreak',
 'break','code','inlineCode','text','emphasis','strong','delete','link','image',
 'table','tableRow','tableCell','html','inlineMath','math'
]);
function hasUnsupportedSyntax(node:AstNode):boolean{
 if(!supportedAstNodes.has(node.type))return true;
 const htmlChildren=(node.children??[]).filter(child=>child.type==='html').map(child=>child.value?.trim().toLowerCase());
 if(htmlChildren.filter(value=>value==='<mark>').length!==htmlChildren.filter(value=>value==='</mark>').length)return true;
 if(node.type==='html'){
  const value=node.value?.trim()??'';
  const tag=/^<\/?([\w-]+)(?:\s[^>]*)?>$/i.exec(value)?.[1]?.toLowerCase();
  if(!tag||!['mark','u','sup','sub','br'].includes(tag))return true;
 }
 return (node.children??[]).some(hasUnsupportedSyntax);
}

function parseSafe(source:string,manager:MarkdownDriver):JSONContent[]{
 const result=postProcessTableAlignment(manager.parse(prepareVisualMarkdown(source)),source);
 return result.content??[];
}

/** Visual-first conversion with localized verbatim fallback nodes.
 * Supported Markdown is rich text; unsupported syntax remains editable
 * plain text and serializes without invented escapes or formatting. */
export function buildVisualMarkdown(source:string,manager:MarkdownDriver):JSONContent{
 const normalized=source.replace(/\r\n/g,'\n'),metadata=frontmatter.exec(normalized);
 const tail=metadata?normalized.slice(metadata[0].length).replace(/^\n+/,''):normalized;
 const content:JSONContent[]=metadata?[rawMarkdownBlock(metadata[0])]:[];
 try{
  const ast=parser.parse(tail) as AstNode;
  const blocks=ast.children??[];
  const containsMarkedMath=blocks.some((_,index)=>Boolean(findMarkedDisplayMath(blocks,index)));
  if(!blocks.some(hasUnsupportedSyntax)&&!containsMarkedMath){
   content.push(...parseSafe(tail,manager));
  }else{
   // Parse the rest of the document as rich text. Standalone HTML-marked
   // display math must become a real blockMath node, not a literal HTML block.
   for(let i=0;i<blocks.length;i++){
    const matched=findMarkedDisplayMath(blocks,i);
    if(matched){
     content.push({type:'blockMath',attrs:{latex:matched.latex,highlighted:true}});
     i+=matched.length-1;
     continue;
    }
    const block=blocks[i] as AstNode;
    const start=block.position?.start?.offset,end=block.position?.end?.offset;
    if(start===undefined||end===undefined)continue;
    const fragment=tail.slice(start,end);
    if(!fragment.trim())continue;
    if(hasUnsupportedSyntax(block))content.push(rawMarkdownBlock(fragment));
    else{
     try{content.push(...parseSafe(fragment,manager));}
     catch{content.push(rawMarkdownBlock(fragment));}
    }
   }
  }
 }catch{content.push(rawMarkdownBlock(tail));}
 return {type:'doc',content:content.length?content:[{type:'paragraph'}]};
}
