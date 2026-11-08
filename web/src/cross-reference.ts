import type {JSONContent} from '@tiptap/core';

/** Explicit typed Markdown IDs. No persistent block index is required. */
export type CrossRefKind='fig'|'eq'|'tbl';
export type CrossRefInfo={id:string;kind:CrossRefKind;number:number;label:string};
export type CrossRefIndex=ReadonlyMap<string,CrossRefInfo>;
const prefix:Record<CrossRefKind,string>={fig:'图',eq:'公式',tbl:'表'};
const idPattern=/^(fig|eq|tbl)-[a-z][a-z0-9-]{0,63}$/;
export function crossRefKind(value:unknown):CrossRefKind|null{
 if(typeof value!=='string')return null;
 return (idPattern.exec(value)?.[1] as CrossRefKind|undefined)??null;
}
export function validCrossRefId(value:unknown,kind?:CrossRefKind):value is string{
 const found=crossRefKind(value);
 return found!==null&&(!kind||found===kind);
}
export function crossRefSourceId(value:string):string|null{
 const normalized=value.toLowerCase();
 return validCrossRefId(normalized)?normalized:null;
}
/** Only explicitly labelled blocks are numbered, in document order.
 * Duplicate IDs are ambiguous: first wins. No database/metadata writes. */
export function collectCrossRefs(doc:JSONContent):CrossRefIndex{
 const counters:Record<CrossRefKind,number>={fig:0,eq:0,tbl:0};
 const index=new Map<string,CrossRefInfo>();
 const walk=(node:JSONContent)=>{
  let id:unknown;
  if(node.type==='image')id=node.attrs?.figureId;
  else if(node.type==='blockMath')id=node.attrs?.equationId;
  else if(node.type==='table')id=node.attrs?.tableId;
  if(validCrossRefId(id)&&!index.has(id)){
   const kind=crossRefKind(id)!;
   const number=++counters[kind];
   index.set(id,{id,kind,number,label:prefix[kind]+' '+number});
  }
  for(const child of node.content??[])walk(child);
 };
 walk(doc);
 return index;
}
export function resolveCrossRef(index:CrossRefIndex,id:string):CrossRefInfo|null{
 return index.get(id)??null;
}

/** remark-math does not close $$ when its closing line has a Quarto {#eq-id}.
 * Mask ONLY the trailing ID as spaces of equal length. AST offsets therefore
 * still locate the original Markdown, including trailing attributes.
 * Standard math, code fences, and unknown IDs are left untouched. */
export function shieldEquationIdClosers(source:string):string{
 const lines=source.split('\n');
 let code:{char:string;length:number}|null=null;
 for(let i=0;i<lines.length;i++){
  const line=lines[i]!;
  const marker=/^ {0,3}(\x60{3,}|~{3,})/.exec(line)?.[1];
  if(code){
   if(marker&&marker[0]===code.char&&marker.length>=code.length&&
      line.slice(line.indexOf(marker)+marker.length).trim()==='')code=null;
   continue;
  }
  if(marker){code={char:marker[0]!,length:marker.length};continue;}
  if(!/^\$\$[ \t]*$/.test(line))continue;
  for(let j=i+1;j<lines.length&&j<=i+300;j++){
   const next=lines[j]!;
   if(/^\$\$[ \t]+\{#eq-[a-z][a-z0-9-]{0,63}\}[ \t]*$/i.test(next)){
    lines[j]='$$'+' '.repeat(next.length-2);
    i=j;
    break;
   }
   if(/^\$\$[ \t]*$/.test(next)){i=j;break;}
  }
 }
 return lines.join('\n');
}
export function parseEquationId(source:string):{latex:string;id:string}|null{
 const m=/^\$\$[ \t]*\r?\n([\s\S]*?)\r?\n\$\$[ \t]+\{#(eq-[a-z][a-z0-9-]{0,63})\}[ \t]*$/i.exec(source);
 if(!m||!m[1]?.trim()||m[1].includes('$$'))return null;
 return {latex:m[1].trim(),id:m[2]!.toLowerCase()};
}
export function parseTableCaption(text:string):{caption:string;id:string}|null{
 const m=/^:\s+(.{1,240}?)\s+\{#(tbl-[a-z][a-z0-9-]{0,63})\}\s*$/i.exec(text);
 if(!m||/[\r\n]/.test(text))return null;
 return {caption:m[1]!.trim(),id:m[2]!.toLowerCase()};
}
export const crossRefTokenStart=(src:string)=>src.search(/@(fig|eq|tbl)-[a-z]/i);
export function crossRefToken(src:string):{type:'crossReference';raw:string;target:string}|undefined{
 const m=/^@((?:fig|eq|tbl)-[a-z][a-z0-9-]{0,63})(?![a-z0-9-])/i.exec(src);
 if(!m)return;
 return {type:'crossReference',raw:m[0],target:m[1]!.toLowerCase()};
}
