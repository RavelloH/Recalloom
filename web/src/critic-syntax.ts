import {unified} from 'unified';
import remarkParse from 'remark-parse';

export type CriticKind='addition'|'deletion'|'substitution'|'comment'|'highlight';
export type CriticMatch={kind:CriticKind;raw:string;text:string;before:string};

/** First stage of CriticMarkup is single-line only: do not allow malformed
 * delimiters, nested changes or unbounded text into an inline node.
 * The original Markdown remains authoritative, never accept an edit by parsing.
 */
export function parseCriticAt(source:string):CriticMatch|null{
 if(!source.startsWith('{'))return null;
 const forms=[
  ['substitution',/^\{~~([^\r\n{}]{0,1024}?)~>([^\r\n{}]{0,1024}?)~~\}/],
  ['addition',/^\{\+\+([^\r\n{}]{1,2048}?)\+\+\}/],
  ['deletion',/^\{--([^\r\n{}]{1,2048}?)--\}/],
  ['highlight',/^\{==([^\r\n{}]{1,2048}?)==\}/],
  ['comment',/^\{>>([^\r\n{}]{1,2048}?)<<\}/]
 ] as const;
 for(const [kind,re] of forms){
  const match=re.exec(source);
  if(!match)continue;
  if(kind==='substitution'){
   const before=match[1]??'',text=match[2]??'';
   if(!before&&!text)continue;
   if(/\{\+\+|\{--|\{~~|\{==|\{>>/.test(before+text))continue;
   return {kind,raw:match[0],before,text};
  }
  const text=match[1]??'';
  if(/\{\+\+|\{--|\{~~|\{==|\{>>/.test(text))continue;
  return {kind,raw:match[0],text,before:''};
 }
 return null;
}
const heads=['{++','{--','{~~','{==','{>>'];
export function criticStartIndex(source:string){
 const hits=heads.map(prefix=>source.indexOf(prefix)).filter(pos=>pos>=0);
 return hits.length?Math.min(...hits):-1;
}

type Mdast={type:string;children?:Mdast[];position?:{start?:{offset?:number};end?:{offset?:number}}};
const parser=unified().use(remarkParse);
const closers:Record<string,string>={'{++':'++}','{--':'--}','{~~':'~~}','{==':'==}','{>>':'<<}'};
type CriticOccurrence={start:number;end:number;match:CriticMatch};
export function findCriticMarkup(source:string):CriticOccurrence[]{
 const ast=parser.parse(source) as Mdast;
 const results:CriticOccurrence[]=[];
 const skip=new Set(['code','inlineCode','html','link','linkReference','image','imageReference','definition']);
 const walk=(node:Mdast)=>{
  if(skip.has(node.type))return;
  if(node.type==='text'){
   const start=node.position?.start?.offset,end=node.position?.end?.offset;
   if(start===undefined||end===undefined)return;
   const raw=source.slice(start,end);
   for(let index=0;index<raw.length;){
    const next=criticStartIndex(raw.slice(index));
    if(next<0)break;
    index+=next;
    const position=start+index;
    let preceding=0;
    for(let pos=position-1;pos>=0&&source[pos]==='\\';pos--)preceding++;
    if(preceding%2){index++;continue;}
    const found=parseCriticAt(raw.slice(index));
    if(!found){
     const prefix=heads.find(head=>raw.startsWith(head,index));
     const closer=prefix?closers[prefix]:undefined;
     const finish=closer?raw.indexOf(closer,index+prefix!.length):-1;
     index=finish<0?raw.length:finish+closer!.length;
     continue;
    }
    results.push({start:position,end:position+found.raw.length,match:found});
    index+=found.raw.length;
   }
   return;
  }
  // Remark emits <span> and </span> as separate HTML siblings, with text
  // between them. Keep content of raw HTML completely outside this syntax.
  // This prevents comments/markup written inside user HTML being reinterpreted.
  let htmlDepth=0;
  for(const child of node.children??[]){
   if(child.type==='html'){
    const raw=source.slice(child.position?.start?.offset??0,child.position?.end?.offset??0).trim();
    if(/^<\/[a-z][\w:-]*\s*>$/i.test(raw))htmlDepth=Math.max(0,htmlDepth-1);
    else if(/^<[a-z][\w:-]*(?:\s[^<>]*)?>$/i.test(raw)&&!raw.endsWith('/>'))htmlDepth++;
    continue;
   }
   if(htmlDepth===0)walk(child);
  }
 };
 walk(ast);
 return results.sort((a,b)=>a.start-b.start);
}
const enc=(value:string)=>encodeURIComponent(value).replace(/'/g,'%27');
/** The only generated tags are fixed internal names and URI-encoded values.
 * This happens before GFM, which would otherwise interpret {~~old~>new~~}
 * as a standard strikethrough. Rehype sanitation still restricts tags/attrs.
 */
export function prepareCriticMarkdown(source:string):string{
 const matches=findCriticMarkup(source);
 if(!matches.length)return source;
 let cursor=0,output='';
 for(const entry of matches){
  if(entry.start<cursor)continue;
  output+=source.slice(cursor,entry.start);
  output+='<rk-critic data-kind="'+entry.match.kind+'" data-value="'+enc(entry.match.text)+
   '" data-before="'+enc(entry.match.before)+'"></rk-critic>';
  cursor=entry.end;
 }
 return output+source.slice(cursor);
}
