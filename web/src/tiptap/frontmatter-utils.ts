import {parseDocument} from 'yaml';
export type FrontMatterEntry={key:string;value:string};
export const yamlFrontMatter=/^\uFEFF?---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?=\n|$)/;
export function isYamlFrontmatter(raw:string):boolean{
 return raw.length<=50000&&yamlFrontMatter.test(raw);
}
function display(value:unknown):string{
 if(value===null||value===undefined)return '—';
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value).slice(0,800);
 if(Array.isArray(value))return value.slice(0,12).map(display).join(', ').slice(0,800);
 try{return JSON.stringify(value).slice(0,800);}catch{return '[复杂结构]';}
}
export function frontMatterEntries(raw:string):{entries:FrontMatterEntry[];error:string|null}{
 if(!isYamlFrontmatter(raw))return {entries:[],error:'Front Matter 必须以 --- 围栏界定，最大 50 KB'};
 const body=raw.replace(/^\uFEFF?---[ \t]*\n/,'').replace(/\n(?:---|\.\.\.)[ \t]*$/,'');
 try{
  const doc=parseDocument(body,{uniqueKeys:true,prettyErrors:false});
  if(doc.errors.length||doc.warnings.length)return {entries:[],error:'YAML 语法无效，请在源码中检查'};
  const result=doc.toJS({maxAliasCount:0}) as unknown;
  if(!result||typeof result!=='object'||Array.isArray(result))return {entries:[],error:'Front Matter 顶层应为键值映射'};
  const entries=Object.entries(result).slice(0,32).map(([key,value])=>({key:key.slice(0,100),value:display(value)}));
  return {entries,error:null};
 }catch{return {entries:[],error:'YAML 解析失败，请修改原文'};}
}
