import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

type AstNode={type:string;children?:AstNode[];position?:{start?:{offset?:number};end?:{offset?:number}}};
export type RmdComment={kind:'inline'|'block';start:number;end:number;body:string;raw:string};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const forbidden=new Set(['code','inlineCode','math','inlineMath','html','link','linkReference',
 'image','imageReference','definition']);
function isEscaped(source:string,index:number){
 let n=0;
 for(let i=index-1;i>=0&&source[i]==='\\';i--)n++;
 return n%2===1;
}
function prohibitedRanges(source:string){
 const ast=parser.parse(source) as AstNode;
 const protectedRanges:{start:number;end:number}[]=[];
 const walk=(node:AstNode)=>{
  const start=node.position?.start?.offset,end=node.position?.end?.offset;
  if(forbidden.has(node.type)){
   if(start!==undefined&&end!==undefined)protectedRanges.push({start,end});
   return;
  }
  node.children?.forEach(walk);
 };
 walk(ast);
 return protectedRanges;
}
const overlaps=(start:number,end:number,protectedRanges:{start:number;end:number}[])=>
 protectedRanges.some(x=>start<x.end&&end>x.start);

/** Identify only closed, valid %% comments. No source mutation, no fallback
 * semantics; the caller decides how to display/edit each annotation.
 * A multiline comment must have BOTH %% markers on otherwise empty lines.
 * %% in math, links, raw HTML, fenced code, and inline code is plain text.
 */
export function findRmdComments(raw:string):RmdComment[]{
 const source=raw.replace(/\r\n/g,'\n');
 const blocked=prohibitedRanges(source);
 const found:RmdComment[]=[];
 const lines=source.split('\n');
 let offset=0,open:{start:number;end:number}|null=null;
 for(const line of lines){
  const start=offset,end=start+line.length;
  if(/^[ \t]*%%[ \t]*$/.test(line)&&!overlaps(start,end,blocked)&&!isEscaped(source,start+line.indexOf('%%'))){
   if(!open)open={start,end};
   else {
    const body=source.slice(open.end+1,start);
    if(body.trim())found.push({kind:'block',start:open.start,end,body,raw:source.slice(open.start,end)});
    open=null;
   }
  }
  offset=end+1;
 }
 // An unmatched opener is plain text, not an instruction to hide remaining lines.
 const blockRanges=found.filter(x=>x.kind==='block');
 const inlinePattern=/%%((?:[^%\r\n]|%(?!%))+?)%%/g;
 for(const match of source.matchAll(inlinePattern)){
  const start=match.index??0,end=start+match[0].length;
  if(isEscaped(source,start)||overlaps(start,end,blocked)||
   blockRanges.some(r=>start<r.end&&end>r.start))continue;
  // Inline comments may not begin on the standalone block delimiter line.
  if(/^[ \t]*%%[ \t]*$/.test(source.slice(source.lastIndexOf('\n',start-1)+1,source.indexOf('\n',start)>=0?source.indexOf('\n',start):source.length)))continue;
  found.push({kind:'inline',start,end,raw:match[0],body:match[1]??''});
 }
 return found.sort((a,b)=>a.start-b.start);
}

/** Remove only VALID annotations for the read-only projection.
 * Invalid, escaped and code-fenced forms remain verbatim; a block annotation
 * including its blank-line paragraph boundary leaves no empty presentation node.
 */
export function projectRmdComments(source:string):string{
 const normalized=source.replace(/\r\n/g,'\n');
 const comments=findRmdComments(normalized);
 if(!comments.length)return normalized;
 let projected=normalized;
 for(const comment of comments.slice().reverse()){
  let from=comment.start,to=comment.end;
  if(comment.kind==='block'){
   const before=normalized.slice(0,from),after=normalized.slice(to);
   if(/(?:^|\n)[ \t]*$/.test(before.slice(before.lastIndexOf('\n')+1)) &&
      /^\n(?:[ \t]*\n|$)/.test(after)){
    // The block is a standalone Markdown structure; remove its own line break.
    if(projected[to]==='\n')to++;
   }
  }else{
   const rowStart=normalized.lastIndexOf('\n',from-1)+1;
   const rowEnd=normalized.indexOf('\n',to);
   const end=rowEnd<0?normalized.length:rowEnd;
   if(!normalized.slice(rowStart,from).trim()&&!normalized.slice(to,end).trim()){
    from=rowStart;to=end;
    if(projected[to]==='\n')to++;
   }
  }
  projected=projected.slice(0,from)+projected.slice(to);
 }
 return projected;
}

/** Default preview: approved base prose, never automatically accept proposed edits.
 * Match only valid, non-code CriticMarkup using the existing reviewer lexer.
 */
