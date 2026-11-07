import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

/** Parse only to identify literal source segments that require temporary lexer shielding. */
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
/**
 * Prevent package@1.2.3 text from being mistaken for an email link by Tiptap.
 * Only parser-proven plain text nodes are modified. Inline code, links, and
 * original source in the database remain untouched.
 */
function shieldPackageVersions(source:string):string{
 type NodeInfo={type?:string;children?:NodeInfo[];position?:{start?:{offset?:number};end?:{offset?:number}}};
 const tree=parser.parse(source) as NodeInfo,positions:number[]=[];
 const walk=(node:NodeInfo)=>{
  if(node.type==='text'){
   const start=node.position?.start?.offset,end=node.position?.end?.offset;
   if(start!==undefined&&end!==undefined){
    const raw=source.slice(start,end);
    const pattern=/\b[A-Za-z][\w.-]{1,80}@\d+(?:\.\d+){2,}(?![\w.])/g;
    for(const match of raw.matchAll(pattern)){
     const at=start+(match.index??0)+match[0].indexOf('@');
     if(source[at-1]!=='\\')positions.push(at);
    }
   }
  }
  for(const child of node.children??[])walk(child);
 };
 walk(tree);
 let result=source;
 for(const at of positions.sort((a,b)=>b-a))result=result.slice(0,at)+'\\'+result.slice(at);
 return result;
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
 return shieldPackageVersions(result);
}
