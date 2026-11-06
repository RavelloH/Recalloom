import type {JSONContent} from '@tiptap/core';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {prepareVisualMarkdown} from './fidelity';
import {postProcessTableAlignment} from './table-alignment';
import {findMarkedDisplayMath} from './marked-display-math';

type MarkdownDriver={parse:(source:string)=>JSONContent};
type AstNode={type:string;value?:string;children?:AstNode[];
 position?:{start?:{offset?:number};end?:{offset?:number}}};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const frontmatter=/^\uFEFF?(?:---|\+\+\+)[ \t]*\n[\s\S]*?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?=\n|$)/;

/** Plainly editable ProseMirror content, not a special source-only widget. */
export function literalParagraph(source:string):JSONContent{
 const lines=source.replace(/\r\n/g,'\n').split('\n'),content:JSONContent[]=[];
 for(let i=0;i<lines.length;i++){
  if(i)content.push({type:'hardBreak'});
  if(lines[i])content.push({type:'text',text:lines[i]});
 }
 return {type:'paragraph',content};
}

/** Unknown HTML is never silently discarded by Tiptap's HTML DOM parser.
 * Paired known inline formatting tags stay rich text; other HTML syntax
 * appears as ordinary editable text. Code spans are not HTML AST nodes. */
function hasUnsupportedHtml(node:AstNode):boolean{
 const htmlChildren=(node.children??[]).filter(child=>child.type==='html').map(child=>child.value?.trim().toLowerCase());
 if(htmlChildren.filter(value=>value==='<mark>').length!==htmlChildren.filter(value=>value==='</mark>').length)return true;
 if(node.type==='html'){
  const value=node.value?.trim()??'';
  const tag=/^<\/?([\w-]+)(?:\s[^>]*)?>$/i.exec(value)?.[1]?.toLowerCase();
  if(!tag||!['mark','u','sup','sub','br'].includes(tag))return true;
 }
 return (node.children??[]).some(hasUnsupportedHtml);
}

function parseSafe(source:string,manager:MarkdownDriver):JSONContent[]{
 const result=postProcessTableAlignment(manager.parse(prepareVisualMarkdown(source)),source);
 return result.content??[];
}

/** Visual-first conversion. No source-only nodes, no special protection,
 * and no equivalence gate that can replace a whole note with a code island.
 * The editor does not persist normalizations until a real user edit. */
export function buildVisualMarkdown(source:string,manager:MarkdownDriver):JSONContent{
 const normalized=source.replace(/\r\n/g,'\n'),metadata=frontmatter.exec(normalized);
 const tail=metadata?normalized.slice(metadata[0].length).replace(/^\n+/,''):normalized;
 const content:JSONContent[]=metadata?[literalParagraph(metadata[0])]:[];
 try{
  const ast=parser.parse(tail) as AstNode;
  const blocks=ast.children??[];
  const containsMarkedMath=blocks.some((_,index)=>Boolean(findMarkedDisplayMath(blocks,index)));
  if(!blocks.some(hasUnsupportedHtml)&&!containsMarkedMath){
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
    if(hasUnsupportedHtml(block))content.push(literalParagraph(fragment));
    else{
     try{content.push(...parseSafe(fragment,manager));}
     catch{content.push(literalParagraph(fragment));}
    }
   }
  }
 }catch{content.push(literalParagraph(tail));}
 return {type:'doc',content:content.length?content:[{type:'paragraph'}]};
}
