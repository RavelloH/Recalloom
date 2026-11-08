import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';

export type CriticKind='addition'|'deletion'|'substitution'|'comment'|'highlight';
export type CriticMatch={kind:CriticKind;raw:string;text:string;before:string};

/** Bounded single-line review syntax. Balanced ordinary curly braces (JSON,
 * template variables) are permitted; nested CriticMarkup remains forbidden.
 * Backticks protect delimiters inside an inline code snippet.
 */
export function parseCriticAt(source:string):CriticMatch|null{
 const forms=[
  {open:'{~~',close:'~~}',kind:'substitution' as const},
  {open:'{++',close:'++}',kind:'addition' as const},
  {open:'{--',close:'--}',kind:'deletion' as const},
  {open:'{==',close:'==}',kind:'highlight' as const},
  {open:'{>>',close:'<<}',kind:'comment' as const}
 ];
 const form=forms.find(item=>source.startsWith(item.open));
 if(!form)return null;
 let depth=0,inCode=false,split=-1;
 for(let i=form.open.length;i<source.length&&i<=4100;i++){
  const ch=source[i]!;
  if(ch==='\n'||ch==='\r')return null;
  if(ch==='\\'){i++;continue;}
  if(ch==='\x60'){inCode=!inCode;continue;}
  if(inCode)continue;
  if(source.startsWith(form.close,i)&&depth===0){
   const body=source.slice(form.open.length,i);
   if(body.length>2048||!body)return null;
   if(form.kind!=='substitution')return {kind:form.kind,raw:source.slice(0,i+form.close.length),text:body,before:''};
   if(split<0)return null;
   const before=body.slice(0,split-form.open.length),text=body.slice(split-form.open.length+2);
   if(!before&&!text||before.length>1024||text.length>1024)return null;
   return {kind:'substitution',raw:source.slice(0,i+form.close.length),text,before};
  }
  if(source.slice(i).match(/^\{(?:\+\+|--|~~|==|>>)/))return null;
  if(ch==='{')depth++;
  else if(ch==='}'){if(--depth<0)return null;}
  else if(form.kind==='substitution'&&depth===0&&source.startsWith('~>',i)){
   if(split>=0)return null;
   split=i;i++;
  }
 }
 return null;
}
const heads=['{++','{--','{~~','{==','{>>'];
// A void HTML tag does not open an HTML region. Otherwise <img> or <br>
// suppresses review syntax in unrelated later Markdown paragraphs.
const voidHtml=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
export function criticStartIndex(source:string){
 const hits=heads.map(prefix=>source.indexOf(prefix)).filter(pos=>pos>=0);
 return hits.length?Math.min(...hits):-1;
}

type Mdast={type:string;children?:Mdast[];position?:{start?:{offset?:number};end?:{offset?:number}}};
// CriticMarkup substitution delimiters contain ~~; do not tokenize them as
// GFM strikethrough before the Critic scanner. Math must still be protected.
const parser=unified().use(remarkParse).use(remarkMath);
const closers:Record<string,string>={'{++':'++}','{--':'--}','{~~':'~~}','{==':'==}','{>>':'<<}'};
type CriticOccurrence={start:number;end:number;match:CriticMatch};
export function findCriticMarkup(source:string):CriticOccurrence[]{
 const ast=parser.parse(source) as Mdast;
 const results:CriticOccurrence[]=[];
 const skip=new Set(['code','inlineCode','math','inlineMath','html','link','linkReference','image','imageReference','definition']);
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
    else {const open=/^<([a-z][\w:-]*)(?:\s[^<>]*)?>$/i.exec(raw);
     if(open&&!raw.endsWith('/>')&&!voidHtml.has(open[1]!.toLowerCase()))htmlDepth++;}
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
