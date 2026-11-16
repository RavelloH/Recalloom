import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import registry from './rmd/registry.json';
import {splitRmdArguments} from './rmd/arguments.js';
import {parseWikiTarget} from './wiki-syntax.js';

type Node={type:string;value?:string;alt?:string;url?:string;identifier?:string;checked?:boolean|null;children?:Node[];position?:{start:{offset:number};end:{offset:number}}};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const protectedTypes=new Set(['code','inlineCode','math','inlineMath','html','link','linkReference','image','imageReference','definition']);
const visibleAttributes=new Set(['caption','title','filename','sender','text','description','label','hint']);

function argumentText(value:string):string{
 if(value.startsWith('"')){try{return String(JSON.parse(value));}catch{return value;}}
 return value.replace(/\\([|=:@\\])/g,'$1');
}
function visibleArguments(raw:string,includeMain=true):string{
 const args=splitRmdArguments(/^\|[ \t]/.test(raw)?' '+raw:raw);if(!args)return raw;
 const main=args.shift()??'';
 const values=args.flatMap(arg=>{
  const match=/^([a-z][a-z0-9-]*)=(.*)$/s.exec(arg);
  return match&&visibleAttributes.has(match[1]!)?[argumentText(match[2]!)]:[];
 });
 return [...(includeMain&&main?[main]:[]),...values].join(' ');
}
function referenceLabel(raw:string):string{
 const wiki=parseWikiTarget(raw);
 if(!wiki)return raw.startsWith('#')?raw.slice(1):raw;
 return wiki.alias??(wiki.target.startsWith('id:')?'文稿引用':wiki.target.split('/').at(-1)!.replace(/\.md$/i,''));
}

/** Remove only recognized presentation syntax outside protected source nodes. */
function projectControls(source:string,tree:Node):string{
 const protectedRanges:Array<{start:number;end:number}>=[];
 const visit=(node:Node)=>{
  if(protectedTypes.has(node.type)&&node.position){protectedRanges.push({start:node.position.start.offset,end:node.position.end.offset});return;}
  node.children?.forEach(visit);
 };
 visit(tree);
 const patches:Array<{start:number;end:number;text:string}>=[];
 const replace=(pattern:RegExp,render:(match:RegExpMatchArray)=>string|null,allowChildren=false)=>{
  for(const match of source.matchAll(pattern)){
   const start=match.index!,end=start+match[0].length;
   if(protectedRanges.some(range=>allowChildren?start>=range.start&&start<range.end:start<range.end&&end>range.start)||patches.some(p=>start<p.end&&end>p.start)||source[start-1]==='\\')continue;
   const text=render(match);if(text!==null)patches.push({start,end,text});
  }
 };
 replace(/\[\[([^\]\r\n]{1,2048})\]\]/g,match=>parseWikiTarget(match[1]!)||/^#[a-z][a-z0-9-]{0,79}$/i.test(match[1]!)?referenceLabel(match[1]!).replace(/\|/g,'\\|'):null);
 replace(/::[ \t]+([a-z][a-z0-9-]*)[ \t]+([^\r\n]+?)[ \t]+::/g,match=>{
  if(!registry.components.some(c=>c.type==='inline'&&c.name===match[1])||match[2]!.includes('::'))return null;
  return visibleArguments(match[2]!);
 },true);
 replace(/^ {0,3}(:{3,})[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+([^\r\n]*?))?[ \t]*$/gm,match=>{
  const component=registry.components.find(c=>c.type==='block'&&c.name===match[2]);
  return component?visibleArguments(match[3]??'',component.main!=='forbidden'):null;
 },true);
 replace(/^ {0,3}:::[ \t]+(embed|link-card)[ \t]+([^\r\n]+?)[ \t]+:::[ \t]*$/gm,match=>{
  if(match[1]==='embed')return parseWikiTarget(match[2]!,false)?'嵌入文稿 '+referenceLabel(match[2]!):null;
  const label=visibleArguments(match[2]!,false);return label||'链接';
 },true);
 replace(/^ {0,3}:{3,}[ \t]*$/gm,()=> '');
 replace(/@ attrs(?:[ \t]+([^@\r\n]*?))?[ \t]+@/g,match=>{
  const label=visibleArguments(match[1]??'',false);
  return label?'\n\n'+label+'\n\n':'';
 },true);
 replace(/%%[\s\S]*?%%/g,()=> '');
 let result=source;
 for(const patch of patches.sort((a,b)=>b.start-a.start))result=result.slice(0,patch.start)+patch.text+result.slice(patch.end);
 return result;
}

function htmlText(value:string):string{
 const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
 return value.replace(/<!--[\s\S]*?-->/g,'').replace(/<\/?(?:br|p|div|li|h[1-6]|tr)\b[^>]*>/gi,'\n').replace(/<\/?(?:td|th)\b[^>]*>/gi,' ').replace(/<[^>]*>/g,'')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(raw,entity:string)=>{
   if(!entity.startsWith('#'))return entities[entity.toLowerCase()]??raw;
   const point=entity[1]?.toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
   return point>0&&point<=0x10ffff&&(point<0xd800||point>0xdfff)?String.fromCodePoint(point):raw;
  });
}

function nodeText(node:Node):string{
 if(['text','inlineCode','code','math','inlineMath'].includes(node.type))return node.value??'';
 if(node.type==='definition')return '';
 if(node.type==='image'||node.type==='imageReference')return node.alt||'图片';
 if(node.type==='html')return htmlText(node.value??'');
 const children=node.children??[];
 if(node.type==='table'){
  const rows=children.map(row=>(row.children??[]).map(nodeText));
  const headers=rows.shift()??[];
  return rows.length?rows.map(row=>row.map((value,i)=>(headers[i]?headers[i]+'：':'')+value).join('；')).join('\n'):headers.join(' · ');
 }
 const text=children.map(nodeText).join(['root','list','listItem','blockquote'].includes(node.type)?'\n':'');
 if(node.type==='listItem'&&typeof node.checked==='boolean')return (node.checked?'已完成：':'未完成：')+text;
 if(node.type==='delete')return '（已删除：'+text+'）';
 if(node.type==='footnoteDefinition')return '注释 '+(node.identifier??'')+'：'+text;
 if(node.type==='footnoteReference')return '〔注释 '+(node.identifier??'')+'〕';
 if(node.type==='link'&&text===node.url)return '链接';
 if(node.type==='break')return '\n';
 return text;
}

/** Bounded, display-only Markdown projection. Code and formula values stay literal. */
export function searchMarkdownText(content:string):string{
 let source=content.replace(/\r\n?/g,'\n').replace(/^(---|\+\+\+)[ \t]*\n[\s\S]*?\n\1[ \t]*(?:\n|$)/,'');
 let tree=parser.parse(source) as Node;
 for(let depth=0;depth<3;depth++){
  const projected=projectControls(source,tree);if(projected===source)break;
  source=projected;tree=parser.parse(source) as Node;
 }
 return nodeText(tree).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
