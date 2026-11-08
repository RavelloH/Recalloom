import type {JSONContent} from '@tiptap/core';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import {richContainerKinds,richInlineKinds,richLeafKinds,validContainerParent} from './rich-schema';
import {prepareVisualMarkdown} from './visual-input';
import {normalizeKnownMarkdown} from '../markdown-normalize';
import {rawMarkdownBlock} from './raw-markdown';
import {postProcessTableAlignment} from './table-alignment';
import {findMarkedDisplayMath} from './marked-display-math';
import {extractFootnoteBody,safeFootnoteId} from './rich-footnote-utils';
import {explicitHeadingAnchor,explicitBlockAnchor} from '../wiki-slug';
import {extractWikiReferences} from '../../../src/wiki-syntax.js';
import {parseFigureSuffix,safeFigureImageSrc} from '../figure-syntax';
import {parseEquationId,shieldEquationIdClosers} from '../cross-reference';
import {parseTableCaption} from '../table-caption';

type MarkdownDriver={parse:(source:string)=>JSONContent};
function parseStandaloneFigure(block:AstNode,source:string):JSONContent|null{
 if(block.type!=='paragraph'||block.children?.length!==2)return null;
 const [image,tail]=block.children;
 if(image?.type!=='image'||tail?.type!=='text'||!image.position?.end?.offset||
  !block.position?.start?.offset&&block.position?.start?.offset!==0)return null;
 const offset=image.position.end.offset-block.position.start.offset;
 const sourceText=source.slice(offset);
 const attrs=parseFigureSuffix(sourceText);
 if(!attrs||!image.url||!safeFigureImageSrc(image.url))return null;
 return {type:'image',attrs:{src:image.url,alt:image.alt??'',title:image.title??null,
  width:attrs.width,height:attrs.height,caption:attrs.caption,figureId:attrs.id??null}};
}

type AstNode={type:string;name?:string;value?:string;url?:string;alt?:string;title?:string;children?:AstNode[];data?:{directiveLabel?:boolean};
 position?:{start?:{offset?:number};end?:{offset?:number}}};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective);
const frontmatter=/^\uFEFF?(?:---|\+\+\+)[ \t]*\n[\s\S]*?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?=\n|$)/;


/** Unknown Markdown/HTML is displayed as plain editable text while its
 * original source is retained verbatim when other blocks are edited.
 * Unsupported inline tokens can remain literal without downgrading the paragraph. */
const supportedAstNodes=new Set([
 'root','paragraph','heading','blockquote','list','listItem','thematicBreak',
 'break','code','inlineCode','text','emphasis','strong','delete','link','image',
 'table','tableRow','tableCell','html','inlineMath','math',
 'containerDirective','textDirective','leafDirective','footnoteReference','footnoteDefinition'
]);
type SafeSpan={start:number;end:number};
function hasUnsupportedSyntax(node:AstNode,allowedWiki:SafeSpan[]=[]):boolean{
 // remark-directive also treats the colon in [[id:UUID]] and
 // {{embed:id:UUID}} as a directive. Restore the Wiki grammar priority for
 // spans that our shared authoritative Wiki parser has already validated.
 if((node.type==='textDirective'||node.type==='leafDirective')&&node.position?.start?.offset!==undefined&&node.position?.end?.offset!==undefined&&
   allowedWiki.some(span=>span.start<=node.position!.start!.offset!&&span.end>=node.position!.end!.offset!))return false;
 if(!supportedAstNodes.has(node.type))return true;
 if(node.type==='containerDirective'&&!richContainerKinds.has(node.name??''))return true;
 if(node.type==='textDirective'&&!richInlineKinds.has(node.name??''))return true;
 if(node.type==='leafDirective'&&!richLeafKinds.has(node.name??''))return true;
 const htmlChildren=(node.children??[]).filter(child=>child.type==='html').map(child=>child.value?.trim().toLowerCase());
 if(htmlChildren.filter(value=>value==='<mark>').length!==htmlChildren.filter(value=>value==='</mark>').length)return true;
 if(node.type==='html'){
  const value=node.value?.trim()??'';
  const tag=/^<\/?([\w-]+)(?:\s[^>]*)?\s*\/?>$/i.exec(value)?.[1]?.toLowerCase();
  if(!tag||!['mark','u','sup','sub','br'].includes(tag))return true;
 }
 return (node.children??[]).some(child=>hasUnsupportedSyntax(child,allowedWiki));
}

/* Nested directives must use a strictly longer outer fence. Remark can
 * otherwise consume the inner close as the outer close and leave a trailing
 * ::: paragraph. Never turn such ambiguous input into an empty edit node:
 * preserve the malformed source verbatim until the author fixes the fences. */
function ambiguousNestedFence(block:AstNode,source:string):boolean{
 if(block.type!=='containerDirective')return false;
 const start=block.position?.start?.offset;
 if(start===undefined)return false;
 const outer=/^(:{3,})[\w-]+/.exec(source.slice(start))?.[1]?.length;
 if(!outer)return false;
 return (block.children??[]).some(child=>{
  if(child.type!=='containerDirective')return false;
  const offset=child.position?.start?.offset;
  if(offset===undefined)return false;
  const inner=/^(:{3,})[\w-]+/.exec(source.slice(offset))?.[1]?.length;
  return inner!==undefined&&inner>=outer;
 });
}
function tableCaptionFollowing(blocks:readonly AstNode[],index:number,source:string){
 if(blocks[index]?.type!=='table')return null;
 const after=blocks[index+1];
 const start=after?.position?.start?.offset,end=after?.position?.end?.offset;
 if(after?.type!=='paragraph'||start===undefined||end===undefined)return null;
 const result=parseTableCaption(source.slice(start,end));
 return result;
}
function assignExplicitHeadingIds(nodes:JSONContent[]):JSONContent[]{
 for(const node of nodes){
  if(node.type==='heading'){
   const last=node.content?.at(-1);
   if(last?.type==='text'&&last.text){
    const match=explicitHeadingAnchor(last.text);
    if(match&&(match.body||node.content!.length>1)){
     last.text=match.body;
     if(!last.text)node.content?.pop();
     node.attrs={...node.attrs,id:match.id};
    }
   }
  }
  if(node.type==='paragraph'){
   const last=node.content?.at(-1);
   if(last?.type==='text'&&last.text){
    const match=explicitBlockAnchor(last.text);
    if(match&&(match.body||node.content!.length>1)){
     last.text=match.body;
     if(!last.text)node.content?.pop();
     node.attrs={...node.attrs,blockId:match.id};
    }
   }
  }
  if(node.content)assignExplicitHeadingIds(node.content);
 }
 return nodes;
}
function parseSafe(source:string,manager:MarkdownDriver):JSONContent[]{
 const result=postProcessTableAlignment(manager.parse(prepareVisualMarkdown(source)),source);
 return assignExplicitHeadingIds(result.content??[]);
}

/** In ordinary paragraphs, preserve only unknown spans as literal editable
 * inline nodes. Do not downgrade adjacent formatting to a whole raw block.
 * Complex unsupported structures still use the conservative block fallback.
 */
function parseWithInlineFallback(block:AstNode,fragment:string,manager:MarkdownDriver,allowedWiki:SafeSpan[]):JSONContent[]|null{
 if(block.type!=='paragraph'||!block.children?.length)return null;
 const base=block.position?.start?.offset;
 if(base===undefined)return null;
 const ranges=block.children.filter(child=>hasUnsupportedSyntax(child,allowedWiki)).map(child=>{
  const start=child.position?.start?.offset,end=child.position?.end?.offset;
  return start===undefined||end===undefined?null:{start:start-base,end:end-base};
 });
 if(!ranges.length||ranges.some(range=>!range||range.start<0||range.end>fragment.length))return null;
 const originals:string[]=[],markers:string[]=[];
 let masked=fragment;
 for(let i=ranges.length-1;i>=0;i--){
  const range=ranges[i]!;
  const marker='RKVERBATIMINLINE'+i+'END';
  if(fragment.includes(marker))return null;
  originals[i]=fragment.slice(range.start,range.end);
  markers[i]=marker;
  masked=masked.slice(0,range.start)+marker+masked.slice(range.end);
 }
 let parsed:JSONContent[];
 try{parsed=parseSafe(masked,manager);}catch{return null;}
 if(parsed.length!==1||parsed[0]!.type!=='paragraph')return null;
 const split=(children:JSONContent[]):JSONContent[]=>{
  const out:JSONContent[]=[];
  const pattern=/RKVERBATIMINLINE(\d+)END/g;
  for(const node of children){
   if(node.type!=='text'||!node.text?.includes('RKVERBATIMINLINE')){
    out.push(node);continue;
   }
   let offset=0;
   for(const match of node.text.matchAll(pattern)){
    const start=match.index??0,raw=originals[Number(match[1])];
    if(raw===undefined)return [];
    if(start>offset)out.push({...node,text:node.text.slice(offset,start)});
    out.push({type:'rawInline',content:[{type:'text',text:raw}]});
    offset=start+match[0].length;
   }
   if(offset<node.text.length)out.push({...node,text:node.text.slice(offset)});
  }
  return out;
 };
 const items=split(parsed[0]!.content??[]);
 if(items.filter(node=>node.type==='rawInline').length!==originals.length)return null;
 return [{...parsed[0]!,content:items}];
}

/** Visual-first conversion with localized verbatim fallback nodes.
 * Supported Markdown is rich text; unsupported syntax remains editable
 * plain text and serializes without invented escapes or formatting. */
export function buildVisualMarkdown(source:string,manager:MarkdownDriver,parentKind?:string):JSONContent{
 const normalized=normalizeKnownMarkdown(source.replace(/\r\n/g,'\n')),metadata=frontmatter.exec(normalized);
 const tail=metadata?normalized.slice(metadata[0].length).replace(/^\n+/,''):normalized;
 // YAML-like headers are user prose, NEVER file metadata. Preserve source as
 // one editable plain-text block to prevent CommonMark from consuming fences.
 const content:JSONContent[]=metadata?[rawMarkdownBlock(metadata[0])]:[];
 try{
  const ast=parser.parse(shieldEquationIdClosers(tail)) as AstNode;
  const blocks=ast.children??[];
  const wikiRanges=extractWikiReferences(tail).map(ref=>({start:ref.offset,end:ref.offset+ref.raw.length}));
  const containsMarkedMath=blocks.some((_,index)=>Boolean(findMarkedDisplayMath(blocks,index)));
  const containsContainer=blocks.some(block=>block.type==='containerDirective'||block.type==='leafDirective'||block.type==='footnoteDefinition');
  const containsEquation=blocks.some(block=>block.type==='math'&&block.position?.start?.offset!==undefined&&block.position?.end?.offset!==undefined&&parseEquationId(tail.slice(block.position.start.offset,block.position.end.offset))!==null);
  const containsFigure=blocks.some(block=>parseStandaloneFigure(block,tail.slice(block.position?.start?.offset??0,block.position?.end?.offset??0))!==null);
  const containsTableCaption=blocks.some((_,i)=>tableCaptionFollowing(blocks,i,tail)!==null);
  if(!blocks.some(block=>hasUnsupportedSyntax(block,wikiRanges))&&!containsMarkedMath&&!containsContainer&&!containsFigure&&!containsEquation&&!containsTableCaption){
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
    const equation=block.type==='math'?parseEquationId(fragment):null;
    if(equation){content.push({type:'blockMath',attrs:{latex:equation.latex,equationId:equation.id}});continue;}
    const caption=tableCaptionFollowing(blocks,i,tail);
    if(caption){
     const tableNodes=parseSafe(fragment,manager);
     const tableNode=tableNodes.find(node=>node.type==='table');
     if(tableNode){
      tableNode.attrs={...tableNode.attrs,tableId:caption.id,caption:caption.caption};
      content.push(...tableNodes);i++;continue;
     }
    }
    const figure=parseStandaloneFigure(block,fragment);
    if(figure){content.push(figure);continue;}
    if(block.type==='footnoteDefinition'){
     const note=block as AstNode&{identifier?:string;label?:string};
     const id=safeFootnoteId(String(note.label??note.identifier??''));
     const inner=extractFootnoteBody(fragment);
     if(!id||!inner){content.push(rawMarkdownBlock(fragment));continue;}
     const nodes=buildVisualMarkdown(inner,manager).content??[];
     content.push({type:'richFootnoteDefinition',attrs:{id},content:nodes.length?nodes:[{type:'paragraph'}]});
     continue;
    }
    if(block.type==='leafDirective'&&block.name==='link-card'){
     const source=block as AstNode&{attributes?:Record<string,string>};
     const url=String(source.attributes?.url??'');
     const title=(block.children??[]).map(child=>child.value??'').join('');
     if(!url){content.push(rawMarkdownBlock(fragment));continue;}
     content.push({type:'richLinkCard',attrs:{url,title}});
     continue;
    }
    if(ambiguousNestedFence(block,tail)){
     // Include a dangling close fence if remark parsed it as a paragraph.
     const after=blocks[i+1];
     const nextStart=after?.position?.start?.offset,nextEnd=after?.position?.end?.offset;
     const trailing=nextStart!==undefined&&nextEnd!==undefined&&
      /^:{3,}[ \t]*$/.test(tail.slice(nextStart,nextEnd));
     content.push(rawMarkdownBlock(tail.slice(start,trailing?nextEnd:end)));
     if(trailing)i++;
     continue;
    }
    if(block.type==='containerDirective'&&richContainerKinds.has(block.name??'')&&!validContainerParent(block.name??'',parentKind)){
     content.push(rawMarkdownBlock(fragment));continue;
    }
    if(block.type==='containerDirective'&&richContainerKinds.has(block.name??'')&&validContainerParent(block.name??'',parentKind)){
     const label=block.children?.find(child=>child.data?.directiveLabel);
     const title=(label?.children??[]).map(x=>x.value??'').join('');
     const firstNewline=fragment.indexOf('\n'),lastNewline=fragment.lastIndexOf('\n');
     if(firstNewline<0||lastNewline<=firstNewline){content.push(rawMarkdownBlock(fragment));continue;}
     const inner=fragment.slice(firstNewline+1,lastNewline).replace(/^\n+|\n+$/g,'');
     const innerNodes=inner?buildVisualMarkdown(inner,manager,block.name).content??[]:[];
     content.push({type:'richContainer',attrs:{kind:block.name,title,...(block.name==='message'?{sender:(block as AstNode&{attributes?:Record<string,string>}).attributes?.sender??'assistant'}:{})},content:innerNodes.length?innerNodes:[{type:'paragraph'}]});
     continue;
    }
    if(hasUnsupportedSyntax(block,wikiRanges)){
     const inline=parseWithInlineFallback(block,fragment,manager,wikiRanges);
     content.push(...(inline??[rawMarkdownBlock(fragment)]));
    }else{
     try{content.push(...parseSafe(fragment,manager));}
     catch{content.push(rawMarkdownBlock(fragment));}
    }
   }
  }
 }catch{content.push(rawMarkdownBlock(tail));}
 return {type:'doc',content:content.length?content:[{type:'paragraph'}]};
}
