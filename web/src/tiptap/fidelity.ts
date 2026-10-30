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
 const before=canonicalMarkdown(original),after=canonicalMarkdown(rendered);
 if(before===after)return true;
 try{return JSON.stringify(markdownSemantics(before))===JSON.stringify(markdownSemantics(after));}
 catch{return false;}
}
