import type {JSONContent} from '@tiptap/core';
import {isRmdId,isValidRmdValue} from './rmd-schema';

const string=(value:unknown)=>String(value??'');
const asId=(v:unknown)=>{const x=string(v).trim();return isRmdId(x)?x.toLowerCase():'';};
/** CommonMark link/image title: quoted independently from RMD | parameters. */
const markdownTitle=(v:unknown)=>{const title=string(v).replace(/[\r\n]/g,' ');return title?' "'+title.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"':'';};
const quote=(value:unknown)=>{
 const text=string(value);
 return /\s\|\s| [@:]{1,3}(?:\s|$)|["\\]|\r|\n|^\s|\s$/.test(text)?JSON.stringify(text):text;
};
function params(values:Array<[string,unknown]>):string{
 return values.filter(([,v])=>v!==null&&v!==undefined&&v!==''&&v!==false)
  .map(([k,v])=>' | '+k+'='+quote(v)).join('');
}
const inlineToken=(name:string,label:string,parts:Array<[string,unknown]>=[])=>{
 const main=label.replace(/(::)(?=\s|$)/g,'\\$1');
 return ':: '+name+' '+main+params(parts)+' ::';
};
function renderMarked(content:string,mark:{type:string;attrs?:Record<string,unknown>}):string{
 const value=mark.attrs??{};
 if(mark.type==='bold')return '**'+content+'**';
 if(mark.type==='italic')return '*'+content+'*';
 if(mark.type==='strike')return '~~'+content+'~~';
 if(mark.type==='underline')return '<u>'+content+'</u>';
 if(mark.type==='code')return String.fromCharCode(96)+content+String.fromCharCode(96);
 if(mark.type==='superscript')return '<sup>'+content+'</sup>';
 if(mark.type==='subscript')return '<sub>'+content+'</sub>';
 if(mark.type==='link')return '['+content+']('+string(value.href).replace(/\s/g,'%20')+markdownTitle(value.title)+')';
 if(mark.type==='rmdMark')return inlineToken('mark',content);
 if(mark.type==='highlight'){
  const color=string(value.color);
  return isValidRmdValue('color',color)?inlineToken('highlight',content,[['color',color]]):content;
 }
 if(mark.type==='visibleComment')return '%%'+content+'%%';
 return content;
}
/** Canonical wrapper order: RMD annotations are outside ordinary Markdown
 * emphasis, irrespective of the order ProseMirror stored the same mark set.
 * Prevents :: mark **x** :: becoming **:: mark x ::** on save. */
const wrapMarks=(text:string,marks:readonly {type:string;attrs?:Record<string,unknown>}[])=>
 [...marks].sort((a,b)=>Number(!['rmdMark','highlight','visibleComment'].includes(a.type))-
 Number(!['rmdMark','highlight','visibleComment'].includes(b.type)))
 .reduceRight((value,mark)=>renderMarked(value,mark),text);
export function serializeRmdInline(content:readonly JSONContent[]):string{
 const fragments=content.map(node=>{
  if(node.type==='hardBreak')return '  \n';
  if(node.type==='rawInline')return (node.content??[]).map(n=>n.text??'').join('');
  if(node.type==='wikiLink'){
   const a=node.attrs??{};
   return '[['+string(a.target)+(a.anchor?'#'+string(a.anchor):'')+(a.alias?'|'+string(a.alias).replace(/\|/g,'\\|'):'')+']]';
  }
  if(node.type==='crossReference')return '[[#'+string(node.attrs?.id)+']]';
  if(node.type==='richFootnoteRef')return '[^'+string(node.attrs?.id)+']';
  if(node.type==='inlineMath'){
   const body='$'+string(node.attrs?.latex)+'$';
   return wrapMarks(body,node.marks??[]);
  }
  if(node.type?.startsWith('rich')){
   const label=serializeRmdInline(node.content??[]);
   const attrs=node.attrs??{};
   if(node.type==='richBadge')return inlineToken('badge',label,[
    ['variant',attrs.variant&&attrs.variant!=='neutral'?attrs.variant:'']
   ]);
   if(node.type==='richTooltip')return inlineToken('tooltip',label,[['description',attrs.content]]);
   if(node.type==='richAbbr')return inlineToken('abbr',label,[['description',attrs.title]]);
   if(node.type==='richKbd')return inlineToken('kbd',label);
   if(node.type==='richCloze')return inlineToken('cloze',label,[['hint',attrs.hint]]);
   if(node.type==='richCritic'){
    const kind=string(attrs.kind),before=string(attrs.before),s=label;
    if(kind==='addition')return '{++'+s+'++}';
    if(kind==='deletion')return '{--'+s+'--}';
    if(kind==='substitution')return '{~~'+before+'~>'+s+'~~}';
    if(kind==='highlight')return '{=='+s+'==}';
    if(kind==='comment')return '{>>'+s+'<<}';
   }
  }
  const text=node.type==='text'?string(node.text):serializeRmdInline(node.content??[]);
  return wrapMarks(text,node.marks??[]);
 });
 // HTML <br/> may appear with incidental spaces on both sides. A canonical
 // hard break owns precisely two trailing spaces and one newline; do not
 // preserve adjacent whitespace that would change on a second Markdown parse.
 for(let i=0;i<content.length;i++)if(content[i]?.type==='hardBreak'){
  if(i>0)fragments[i-1]=fragments[i-1]!.replace(/[ \t]+$/,'');
  if(i+1<fragments.length)fragments[i+1]=fragments[i+1]!.replace(/^[ \t]+/,'');
 }
 return fragments.join('');
}
function modifier(id:unknown,values:Array<[string,unknown]>):string{
 const identity=asId(id);
 return identity||values.some(([,v])=>v!==null&&v!==undefined&&v!==''&&v!==false)?
  ' @ attrs'+(identity?' '+identity:'')+params(values)+' @':'';
}
/** The same canonical modifier is used by serialization and inert Tiptap decorations. */
export function formatRmdBlockAttrs(node:JSONContent):string{
 const a=node.attrs??{};
 switch(node.type){
  case 'heading':return modifier(a.id,[]).trim();
  case 'paragraph':return modifier(a.blockId,[]).trim();
  case 'image':return modifier(a.figureId,[['width',a.width],['height',a.height],['caption',a.caption]]).trim();
  case 'blockMath':return modifier(a.equationId,[]).trim();
  case 'table':return modifier(a.tableId,[['caption',a.caption]]).trim();
  case 'codeBlock':return modifier(a.id,[['file',a.filename],['wrap',a.wrap],['expand',a.expand]]).trim();
  default:return '';
 }
}
const paragraphs=(children:readonly JSONContent[])=>children.map(serializeRmdBlock).filter(Boolean).join('\n\n');
const withIndent=(source:string,prefix:string)=>source.split('\n').map((line,i)=>i===0?prefix+line:' '.repeat(prefix.length)+line).join('\n');
const quoteLines=(source:string)=>source.split('\n').map(line=>line?'> '+line:'>').join('\n');
const escapeAlt=(text:string)=>text.replace(/\\/g,'\\\\').replace(/\]/g,'\\]');
function serializeTable(node:JSONContent):string{
 const rows=node.content??[];
 if(!rows.length)return '';
 const renderRow=(row:JSONContent)=>{
  const cols=(row.content??[]).map(cell=>serializeRmdInline(cell.content?.flatMap(p=>p.type==='paragraph'?p.content??[]:[p])??[])||' ');
  return '| '+cols.join(' | ')+' |';
 };
 const first=rows[0]!;
 const separator='| '+(first.content??[]).map(cell=>{
  const a=string(cell.attrs?.textAlign);
  return a==='center'?':---:':a==='right'?'---:':a==='left'?':---':'---';
 }).join(' | ')+' |';
 const body=[renderRow(first),separator,...rows.slice(1).map(renderRow)].join('\n');
 const attrs=modifier(node.attrs?.tableId,[['caption',node.attrs?.caption]]);
 return body+(attrs?'\n'+attrs.trimStart():'');
}
export function serializeRmdBlock(node:JSONContent):string{
 const a=node.attrs??{};
 switch(node.type){
  case 'paragraph':return serializeRmdInline(node.content??[])+modifier(a.blockId,[]);
  case 'heading':return '#'.repeat(Math.max(1,Math.min(6,Number(a.level)||1)))+' '+serializeRmdInline(node.content??[])+modifier(a.id,[]);
  case 'image':{
   const alt=escapeAlt(string(a.alt)),src=string(a.src).replace(/\s/g,'%20');
   const main='!['+alt+']('+src+markdownTitle(a.title)+')';
   return main+modifier(a.figureId,[['width',a.width],['height',a.height],['caption',a.caption]]);
  }
  case 'blockMath':{
   const latex=string(a.latex);
   const attrs=modifier(a.equationId,[]);
   return '$$\n'+latex+'\n$$'+(attrs?'\n'+attrs.trimStart():'');
  }
  case 'table':return serializeTable(node);
  case 'codeBlock':{
   const code=(node.content??[]).map(n=>n.text??'').join('');
   const language=string(a.language);
   const attrs=modifier(a.id,[['file',a.filename],['wrap',a.wrap],['expand',a.expand]]);
   // A fence must be longer than every same-character run in the body,
   // including delimiter-only lines. Choose the shorter safe candidate.
   const maxRun=(character:string)=>Math.max(2,...(code.match(new RegExp(character+'+','g'))??[]).map(run=>run.length));
   const tilde='~'.repeat(maxRun('~')+1);
   const ticks=String.fromCharCode(96).repeat(maxRun(String.fromCharCode(96))+1);
   const fences=tilde.length<=ticks.length?tilde:ticks;
   return fences+language+'\n'+code+(code.endsWith('\n')?'':'\n')+fences+(attrs?'\n'+attrs.trimStart():'');
  }
  case 'richContainer':{
   const kind=string(a.kind),title=string(a.title);
   const body=paragraphs(node.content??[]);
   if(kind==='comment')return '%%\n'+body+'\n%%';
   const meta=kind==='highlight'?params([['color',a.color]]):kind==='message'?params([['sender',a.sender]]):'';
   const head=kind+(title?' '+title:'')+meta;
   const childFence=body.match(/^(:{3,})/gm)??[];
   const size=Math.max(3,...childFence.map(v=>v.length+1));
   const fence=':'.repeat(size);
   return fence+' '+head+'\n\n'+body+'\n\n'+fence;
  }
  case 'wikiEmbed':return '::: embed '+string(a.target)+(a.anchor?'#'+string(a.anchor):'')+' :::';
  case 'richLinkCard':return '::: link-card '+string(a.url)+params([['title',a.title]])+' :::';
  case 'horizontalRule':return '---';
  case 'blockquote':return quoteLines(paragraphs(node.content??[]));
  case 'bulletList':return (node.content??[]).map(item=>withIndent(paragraphs(item.content??[]),'- ')).join('\n');
  case 'orderedList':return (node.content??[]).map((item,i)=>withIndent(paragraphs(item.content??[]),String(Number(a.start??1)+i)+'. ')).join('\n');
  case 'taskList':return (node.content??[]).map(item=>withIndent(paragraphs(item.content??[]),'- ['+(item.attrs?.checked?'x':' ')+'] ')).join('\n');
  case 'richFootnoteDefinition':{
   const id=string(a.id);
   const body=paragraphs(node.content??[]);
   return '[^'+id+']: '+body.split('\n').map((line,index)=>index?'    '+line:line).join('\n');
  }
  case 'rawMarkdown':return (node.content??[]).map(n=>n.text??'').join('');
  default:return serializeRmdInline(node.content??[]);
 }
}
/** Canonical, source-independent serializer for the new visual AST.
 * A document is saved only on an explicit editor update / Save action. */
export function serializeRmdVisual(doc:JSONContent):string{
 return paragraphs(doc.content??[]);
}
