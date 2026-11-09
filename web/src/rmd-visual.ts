import type {JSONContent} from '@tiptap/core';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {remarkRmdSyntax} from './rmd-remark';
import {isSketchKind,sketchAttrs} from './sketch-geometry';
import {analyzeRmd,shieldRmdTablePipes,type RmdAnalysis} from './rmd-lexer';
import {rawMarkdownBlock} from './tiptap/raw-markdown';
import {normalizeKnownMarkdown} from './markdown-normalize';
import {safeFootnoteId} from './tiptap/rich-footnote-utils';

type AstNode={
 type:string;name?:string;value?:string;depth?:number;ordered?:boolean;start?:number;
 checked?:boolean|null;spread?:boolean;lang?:string;meta?:string;
 url?:string;alt?:string;title?:string|null;identifier?:string;label?:string;
 align?:(string|null)[];children?:AstNode[];
 position?:{start?:{offset?:number};end?:{offset?:number}};
 data?:{hName?:string;hProperties?:Record<string,string>;rmdBody?:string};
};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const at=(node:AstNode,source:string)=>{
 const start=node.position?.start?.offset,end=node.position?.end?.offset;
 return start===undefined||end===undefined?'':source.slice(start,end);
};
const emptyBlock=():JSONContent=>({type:'paragraph'});
const protect=(node:AstNode,source:string):JSONContent=>rawMarkdownBlock(at(node,source));
const mkText=(s:string,marks?:JSONContent['marks']):JSONContent[]=>s?[{type:'text',text:s,...(marks?.length?{marks}:{})}]:[];
const addMark=(nodes:JSONContent[],name:string,attrs?:Record<string,unknown>)=>nodes.map(node=>({
 ...node,marks:[...(node.marks??[]),{type:name,...(attrs?{attrs}:{})}]
}));
const props=(node:AstNode)=>node.data?.hProperties??{};

/** Safe, balanced CommonMark HTML phrasing tags become editable marks.
 * Raw/unknown/unpaired HTML stays literal and never becomes executable DOM.
 */
function children(node:AstNode,source:string):JSONContent[]{
 const parts=node.children??[],out:JSONContent[]=[];
 const tags:Record<string,string>={u:'underline',sup:'superscript',sub:'subscript'};
 for(let i=0;i<parts.length;i++){
  const part=parts[i]!;
  const raw=part.type==='html'?(part.value??at(part,source)).trim():'';
  const opener=/^<(u|sup|sub)>$/i.exec(raw);
  if(opener){
   const tag=opener[1]!.toLowerCase();let depth=1,close=-1;
   for(let j=i+1;j<parts.length;j++){
    const other=parts[j]!;
    if(other.type!=='html')continue;
    const t=(other.value??at(other,source)).trim().toLowerCase();
    if(t==='<'+tag+'>')depth++;
    else if(t==='</'+tag+'>'){if(--depth===0){close=j;break;}}
   }
   if(close>i+1){
    const inside=children({type:'span',children:parts.slice(i+1,close)},source);
    out.push(...addMark(inside,tags[tag]!));i=close;continue;
   }
  }
  out.push(...inlineNode(part,source));
 }
 return out;
}
function inlineNode(node:AstNode,source:string):JSONContent[]{
 switch(node.type){
  case 'text':return mkText(node.value??'');
  case 'strong':return addMark(children(node,source),'bold');
  case 'emphasis':return addMark(children(node,source),'italic');
  case 'delete':return addMark(children(node,source),'strike');
  case 'inlineCode':return mkText(node.value??'',[{type:'code'}]);
  case 'break':return [{type:'hardBreak'}];
  case 'footnoteReference':{
   const id=safeFootnoteId(node.label??node.identifier??'');
   return id?[{type:'richFootnoteRef',attrs:{id}}]:[{type:'rawInline',content:mkText(at(node,source))}];
  }
  case 'inlineMath':return [{type:'inlineMath',attrs:{latex:node.value??''}}];
  case 'link':return addMark(children(node,source),'link',{href:node.url??'',title:node.title??null});
  case 'image':return [{type:'image',attrs:{src:node.url??'',alt:node.alt??'',title:node.title??null}}];
  case 'rmdInline':{
   const name=node.name??'',attributes=props(node);
   if(name==='mark')return addMark(children(node,source),'rmdMark');
   if(isSketchKind(name)){
    const props:Record<string,string>={};
    for(const key of ['Color','Stroke','Padding','Roughness','Opacity'])if(attributes['dataRkSketch'+key])props[key.toLowerCase()]=attributes['dataRkSketch'+key]!;
    return addMark(children(node,source),'rmdSketch',sketchAttrs(name,props));
   }
   if(name==='comment')return addMark(children(node,source),'visibleComment');
   if(name==='wikiLink')return [{type:'wikiLink',attrs:{
    target:decodeURIComponent(attributes.dataTarget??''),
    anchor:decodeURIComponent(attributes.dataAnchor??'')||null,
    alias:decodeURIComponent(attributes.dataAlias??'')||null}}];
   if(name==='crossRef')return [{type:'crossReference',attrs:{id:attributes.dataId??''}}];
   if(name==='critic')return [{type:'richCritic',attrs:{kind:attributes.dataKind??'comment',
    before:decodeURIComponent(attributes.dataBefore??'')},
    content:mkText(decodeURIComponent(attributes.dataValue??''))}];
   const kindMap:Record<string,string>={badge:'richBadge',tooltip:'richTooltip',
    abbr:'richAbbr',kbd:'richKbd',cloze:'richCloze'};
   const type=kindMap[name];
   if(!type)return mkText(at(node,source));
   const attrs=name==='badge'?{variant:attributes.dataVariant??'neutral'}
    :name==='tooltip'?{content:attributes.dataContent??''}
    :name==='abbr'?{title:attributes.dataTitle??''}
    :name==='cloze'?{hint:attributes.dataHint??''}:{};
   return [{type,attrs,content:mkText((node.children??[]).map(n=>n.value??'').join(''))}];
  }
  case 'html':{
   const raw=at(node,source)||node.value||'';
   if(/^<br\s*\/?>$/i.test(raw.trim()))return [{type:'hardBreak'}];
   return [{type:'rawInline',content:mkText(raw)}];
  }
  default:return [{type:'rawInline',content:mkText(at(node,source)||node.value||'')}];
 }
}
function blockNode(node:AstNode,source:string):JSONContent[]{
 const childrenBlock=(sub:string)=>node.children?.flatMap(child=>blockNode(child,sub))??[];
 const nonemptyChildren=(sub:string)=>{const result=childrenBlock(sub);return result.length?result:[emptyBlock()];};
 if(node.type==='rmdBlock'){
  const p=props(node),body=node.data?.rmdBody??source;
  if(node.data?.hName==='rk-rmd-block-mark')return [{type:'richContainer',
   attrs:{kind:node.name??'mark',title:'',color:p.dataRkColor??null},
   content:nonemptyChildren(body)}];
  if(node.data?.hName==='rk-sketch-block'){
   const kind=node.name??'',attrs:Record<string,string>={};
   for(const key of ['Color','Stroke','Padding','Roughness','Opacity'])if(p['dataRkSketch'+key])attrs[key.toLowerCase()]=p['dataRkSketch'+key]!;
   if(!isSketchKind(kind))return [protect(node,source)];
   return [{type:'richContainer',attrs:{...sketchAttrs(kind,attrs),title:'',mathOnly:p.dataRkSketchMathOnly==='true'},content:nonemptyChildren(body)}];
  }
  if(node.data?.hName==='rk-rmd-comment-block')return [{type:'richContainer',
   attrs:{kind:'comment',title:''},content:nonemptyChildren(body)}];
  if(node.data?.hName==='rk-callout')return [{type:'richContainer',
   attrs:{kind:p.dataKind??'note',title:p.dataTitle??'',sender:p.dataSender??null},
   content:nonemptyChildren(body)}];
  if(node.data?.hName==='wiki-embed')return [{type:'wikiEmbed',attrs:{
   target:p.dataTarget??'',anchor:p.dataAnchor??null}}];
  if(node.data?.hName==='rk-link-card')return [{type:'richLinkCard',attrs:{
   url:p.dataUrl??'',title:p.dataTitle??''}}];
  return [protect(node,source)];
 }
 switch(node.type){
  case 'heading':return [{type:'heading',attrs:{level:node.depth??1,id:props(node).id??null},
   content:children(node,source)}];
  case 'paragraph':{
   const p=props(node);
   if(node.data?.hName==='rk-figure'){
    try{
     const f=JSON.parse(decodeURIComponent(p.dataPayload??''));
     return [{type:'image',attrs:{
      src:String(f.src??''),alt:String(f.alt??''),title:f.title??null,
      width:f.width??null,height:f.height??null,caption:f.caption??'',figureId:f.id??null
     }}];
    }catch{return [protect(node,source)];}
   }
   const content=children(node,source);
   if(content.length===1&&content[0]?.type==='image')return content;
   return [{type:'paragraph',attrs:{blockId:p.id??null},content}];
  }
  case 'blockquote':return [{type:'blockquote',content:nonemptyChildren(source)}];
  case 'list':{
   const task=node.children?.some(c=>c.type==='listItem'&&typeof c.checked==='boolean')??false;
   const items=(node.children??[]).map(c=>{
    const blocks=(c.children??[]).flatMap(n=>blockNode(n,source));
    return {type:task?'taskItem':'listItem',
     attrs:task?{checked:c.checked===true}:undefined,
     content:blocks.length?blocks:[emptyBlock()]} satisfies JSONContent;
   });
   return [{type:task?'taskList':node.ordered?'orderedList':'bulletList',
    attrs:node.ordered?{start:node.start??1}:undefined,content:items}];
  }
  case 'thematicBreak':return [{type:'horizontalRule'}];
  case 'code':{
   const p=props(node);
   return [{type:'codeBlock',attrs:{language:node.lang??null,id:p.id??null,
    filename:p.dataFile??'',wrap:p.dataWrap==='true',expand:p.dataExpand==='true'},
    content:mkText(node.value??'')}];
  }
  case 'math':{
   const p=props(node);
   return [{type:'blockMath',attrs:{latex:node.value??'',equationId:p.dataId??p.id??''}}];
  }
  case 'table':{
   const p=props(node);
   const rows=(node.children??[]).map((row,i)=>({
    type:'tableRow',content:(row.children??[]).map((cell,j)=>({
     type:i===0?'tableHeader':'tableCell',
     attrs:{colspan:1,rowspan:1,colwidth:null,textAlign:node.align?.[j]??null},
     content:[{type:'paragraph',content:children(cell,source)}]
    }))
   }));
   return [{type:'table',attrs:{tableId:p.id??null,caption:p.dataRmdCaption??''},content:rows}];
  }
  case 'footnoteDefinition':{
   const id=safeFootnoteId(node.label??node.identifier??'');
   if(!id)return [protect(node,source)];
   const items=childrenBlock(source);
   return [{type:'richFootnoteDefinition',attrs:{id},content:items.length?items:[emptyBlock()]}];
  }
  default:return [protect(node,source)];
 }
}
/** Visual read/write adapter over exactly the same RMD semantic MDAST as preview.
 * No old syntax rewrite, no placeholder substitution, no silent data loss:
 * unsupported structures remain their literal source.
 */
export function parseRmdVisual(source:string,context?:RmdAnalysis):JSONContent{
 const normalized=normalizeKnownMarkdown(source.replace(/\r\n/g,'\n'));
 const analysis=context?.source===normalized?context:analyzeRmd(normalized);
 // Without a GFM table, replacing RMD pipes cannot alter the block AST.
 // Clone the original AST rather than running the full Markdown parser again.
 // For documents containing tables, retain exact pipe-shielding semantics.
 const raw=(analysis.hasGfmTable
  ?parser.parse(shieldRmdTablePipes(normalized,analysis))
  :structuredClone(analysis.ast)) as AstNode;
 remarkRmdSyntax(normalized,analysis)(raw);
 const blocks=(raw.children??[]).flatMap(child=>blockNode(child,normalized));
 return {type:'doc',content:blocks.length?blocks:[emptyBlock()]};
}
