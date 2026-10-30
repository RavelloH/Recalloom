import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

/** Compare Markdown meaning, not spelling or layout. Preserve original until edited. */
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type TreeValue=null|string|number|boolean|TreeValue[]|{[key:string]:TreeValue};
function structuralValue(value:unknown):TreeValue{
 if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')return value;
 if(Array.isArray(value))return value.map(structuralValue);
 if(typeof value==='object'&&value){
  const node=value as Record<string,unknown>,out:Record<string,TreeValue>={};
  for(const [key,val] of Object.entries(node)){
   if(val===undefined||key==='position'||key==='data'||key==='spread')continue;
   if(key==='start'&&val===1)continue;
   out[key]=structuralValue(val);
  }
  return out;
 }
 return null;
}
/**
 * Unpaired identifier placeholders such as <sessionId> or <actorId> are not
 * HTML elements. Tiptap escapes them into text; that representation is safe.
 * Do not broaden this rule to tags like <mark>, HTML blocks or paired JSX.
 */
function normalizePlaceholders(tree:TreeValue,source:string):TreeValue{
 if(Array.isArray(tree)){
  const nodes=tree.map(item=>normalizePlaceholders(item,source)),merged:TreeValue[]=[];
  for(const node of nodes){
   const last=merged[merged.length-1];
   if(last&&node&&!Array.isArray(last)&&!Array.isArray(node)&&typeof last==='object'&&typeof node==='object'&&last.type==='text'&&node.type==='text'){
    if(Object.keys(last).length===2&&Object.keys(node).length===2){
     (last as Record<string,TreeValue>).value=String(last.value)+String(node.value);
     continue;
    }
   }
   merged.push(node);
  }
  return merged;
 }
 if(!tree||typeof tree!=='object')return tree;
 const value=tree as Record<string,TreeValue>;
 if(value.type==='html'&&typeof value.value==='string'){
  const match=/^<([a-z][a-zA-Z0-9]*(?:Id|ID|Key|Token|Name|Path|Value))>$/.exec(value.value);
  if(match&&!source.includes('</'+match[1]+'>'))return {type:'text',value:value.value};
 }
 const out:Record<string,TreeValue>={};
 for(const [key,item] of Object.entries(value))out[key]=normalizePlaceholders(item,source);
 return out;
}
/** Stable representation of Markdown semantics for conservative comparison. */
export function markdownSemantics(source:string):TreeValue{
 return normalizePlaceholders(structuralValue(parser.parse(source.replace(/\r\n/g,'\n'))),source);
}
/**
 * Escape only unmatched bare <mark> inside prose for Tiptap's temporary input.
 * Complete <mark>text</mark>, standalone HTML and attributed tags are unchanged.
 * This never rewrites the original document until an actual user edit.
 */
export function prepareVisualMarkdown(source:string):string{
 type NodeInfo={type?:string;value?:unknown;children?:NodeInfo[];position?:{start?:{offset?:number};end?:{offset?:number}}};
 const tree=parser.parse(source) as NodeInfo;
 const tokens:Array<{offset:number;opening:boolean;eligible:boolean}>=[];
 const walk=(node:NodeInfo,parent?:NodeInfo)=>{
  if(node.type==='html'&&(node.value==='<mark>'||node.value==='</mark>')){
   const offset=node.position?.start?.offset;
   if(offset!==undefined){
    const preceding=parent?.children?.some(sibling=>
     sibling.type==='text'&&typeof sibling.value==='string'&&sibling.value.trim().length>0&&
     (sibling.position?.end?.offset??Infinity)<=offset
    )??false;
    tokens.push({offset,opening:node.value==='<mark>',eligible:node.value==='<mark>'&&
     (parent?.type==='paragraph'||parent?.type==='heading'||parent?.type==='tableCell')&&preceding});
   }
  }
  for(const child of node.children??[])walk(child,node);
 };
 walk(tree);
 const stack:number[]=[],paired=new Set<number>();
 tokens.forEach((token,i)=>{if(token.opening)stack.push(i);else{const open=stack.pop();if(open!==undefined)paired.add(open);}});
 const locations=tokens.filter((tag,i)=>tag.opening&&tag.eligible&&!paired.has(i)).map(t=>t.offset).sort((a,b)=>b-a);
 let result=source;
 for(const offset of locations)result=result.slice(0,offset)+'\\'+result.slice(offset);
 return result;
}

/** Preserve NeutralPress's legacy ++underlined++ syntax on comparison. */
export function canonicalMarkdown(input:string):string{
 const lines=input.replace(/\r\n/g,'\n').trimEnd().split('\n');
 let fenceChar:string|undefined;
 return lines.map((line,i)=>{
  const fence=/^\s{0,3}(\x60{3,}|~{3,})/.exec(line);
  if(fence){const mark=fence[1]![0];if(!fenceChar)fenceChar=mark;else if(fenceChar===mark)fenceChar=undefined;return line;}
  if(fenceChar)return line;
  let out=line;
  out=out.split(/(\x60+[^\x60]*\x60+)/g).map((part,k)=>k%2?part:part.replace(/\+\+([^\n+][^\n]*?)\+\+/g,(_,v:string)=>'<u>'+v.trim()+'</u>')).join('');
  if(i>0 && lines[i-1]?.includes('|') && out.includes('|')){
   const cells=out.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim());
   if(cells.length>1&&cells.every(c=>/^:?-{3,}:?$/.test(c))){
    const sep=cells.map(c=>c.startsWith(':')&&c.endsWith(':')?':------:':c.endsWith(':')?'-------:':'--------');
    out='| '+sep.join(' | ')+' |';
   }
  }
  return out;
 }).join('\n').trimEnd();
}
export function markdownRoundTripSafe(original:string,rendered:string):boolean{
 // Front Matter is metadata, even when generic Markdown calls it a horizontal rule.
 if(/^\uFEFF?(?:---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?:\r?\n|$)/.test(original))return false;
 const before=canonicalMarkdown(prepareVisualMarkdown(original)),after=canonicalMarkdown(prepareVisualMarkdown(rendered));
 if(before===after)return true;
 try{return JSON.stringify(markdownSemantics(before))===JSON.stringify(markdownSemantics(after));}
 catch{return false;}
}
