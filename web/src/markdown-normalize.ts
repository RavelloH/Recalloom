import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

type NodeInfo={type:string;children?:NodeInfo[];position?:{start?:{offset?:number};end?:{offset?:number}}};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const types:Record<string,string>={NOTE:'note',TIP:'tip',IMPORTANT:'info',WARNING:'warning',CAUTION:'danger'};
type Patch={start:number;end:number;text:string};

/** Presentation-only normalization for widely emitted Markdown/HTML syntax.
 * Never changes the stored source before a user edits the document.
 * Code fences and inline code are excluded by AST source ranges.
 */
export function normalizeKnownMarkdown(source:string):string{
 const ast=parser.parse(source) as NodeInfo;
 const protectedRanges:Array<{start:number;end:number}>=[];
 const blocks:Patch[]=[];
 const walk=(node:NodeInfo)=>{
  const start=node.position?.start?.offset,end=node.position?.end?.offset;
  if(start!==undefined&&end!==undefined){
   if(['code','inlineCode','math','inlineMath'].includes(node.type)){
    protectedRanges.push({start,end});return;
   }
   if(node.type==='blockquote'){
    const original=source.slice(start,end);
    const match=/^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i.exec(original);
    if(match){
     const kind=types[match[1]!.toUpperCase()];
     const lines=original.slice(match[0].length).split('\n');
     const inner=lines.map(line=>line.replace(/^ {0,3}>[ \t]?/,'')).join('\n').trim();
     blocks.push({start,end,text:'::: '+kind+'\n\n'+(inner||' ')+'\n\n:::'});
     return;
    }
   }
   if(node.type==='html'){
    const raw=source.slice(start,end);
    const found=/^<details(?:\s+open(?:=["']?open["']?)?)?\s*>\s*<summary>\s*([^<>\r\n]{1,180})\s*<\/summary>\s*([\s\S]*?)\s*<\/details>$/i.exec(raw.trim());
    if(found&&found[2]?.trim()){
     const title=found[1]!.trim();
     blocks.push({start,end,text:'::: details '+title+'\n\n'+found[2]!.trim()+'\n\n:::'});
     return;
    }
   }
  }
  for(const child of node.children??[])walk(child);
 };
 walk(ast);
 // CommonMark splits <details>, its inner Markdown paragraphs, and </details>
 // into separate nodes. Match the bounded enclosing source range rather than
 // relying on one HTML node to contain everything.
 const details=/<details(?:\s+open(?:=["']?open["']?)?)?\s*>\s*<summary>\s*([^<>\r\n]{1,180})\s*<\/summary>\s*([\s\S]*?)\s*<\/details>/gi;
 for(const match of source.matchAll(details)){
  const start=match.index??0,end=start+match[0].length,body=match[2]?.trim()??'';
  if(!body||match[0].length>20000||/<details\b/i.test(body)||
     (start>0&&source[start-1]!=='\n')||
     (end<source.length&&source[end]!=='\n')||
     protectedRanges.some(range=>start<range.end&&end>range.start)||
     blocks.some(block=>start<block.end&&end>block.start))continue;
  const title=match[1]!.trim();
  blocks.push({start,end,text:'::: details '+title+'\n\n'+body+'\n\n:::'});
 }
 // Inline HTML kbd tags are commonly split into three MDAST siblings.
 // Use AST ranges to ensure only actual prose, never code, is transformed.
 const inline:Patch[]=[];
 const re=/<kbd>([^<>\r\n]{1,160})<\/kbd>/gi;
 for(const m of source.matchAll(re)){
  const start=m.index??0,end=start+m[0].length;
  if(protectedRanges.some(range=>start<range.end&&end>range.start)||
     blocks.some(block=>start<block.end&&end>block.start))continue;
  const body=m[1]!;
  if(body.includes(']')||body.includes('[')||body.includes('\\'))continue;
  inline.push({start,end,text:':: kbd '+body+' ::'});
 }
 let next=source;
 const patches=[...blocks,...inline].sort((a,b)=>b.start-a.start);
 for(const patch of patches)next=next.slice(0,patch.start)+patch.text+next.slice(patch.end);
 return next;
}
