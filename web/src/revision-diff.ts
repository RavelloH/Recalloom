import {diffArrays} from 'diff';
import {analyzeRmd,type RmdAnalysis,type RmdSyntaxNode} from './rmd-lexer';

export type RevisionBlock={content:string;startLine:number;endLine:number;kind:string};
export type RevisionDiffRow={kind:'unchanged'|'removed'|'added';block:RevisionBlock;compareContent?:string};
export type RevisionLineEnding='LF'|'CRLF'|'none';
export type RevisionSourceRow={kind:'unchanged'|'removed'|'added';text:string;oldLine:number|null;newLine:number|null;ending?:RevisionLineEnding;endingChanged?:boolean};
export type RevisionDiff={rows:RevisionDiffRow[];sourceRows:RevisionSourceRow[];addedLines:number;removedLines:number;changed:boolean;limited:boolean;definitionsBefore:string;definitionsAfter:string;analysisBefore?:RmdAnalysis;analysisAfter?:RmdAnalysis};

/** Scan only the requested replacement page, retaining every original line ending. */
export function revisionSourcePage(row:RevisionSourceRow,limit:number):{values:RevisionSourceRow[];hasMore:boolean}{
 const values:RevisionSourceRow[]=[];let cursor=0;
 while(values.length<limit&&cursor<row.text.length){
  const end=row.text.indexOf('\n',cursor),crlf=end>cursor&&row.text.charCodeAt(end-1)===13;
  const text=row.text.slice(cursor,end<0?undefined:crlf?end-1:end);
  const offset=values.length;
  values.push({kind:row.kind,text,oldLine:row.oldLine===null?null:row.oldLine+offset,
   newLine:row.newLine===null?null:row.newLine+offset,ending:end<0?'none':crlf?'CRLF':'LF',endingChanged:true});
  cursor=end<0?row.text.length:end+1;
 }
 return {values,hasMore:cursor<row.text.length};
}

const MAX_CHARS=300_000,MAX_LINES=6000,MAX_HUNKS=300;
const DIFF_OPTIONS={timeout:150,maxEditLength:1600};

type SourceSpan={start:number;end:number;kind:string;baseKinds:Set<string>;token?:boolean};
type AstNode={type:string;children?:AstNode[];position?:{start?:{offset?:number};end?:{offset?:number}}};
const nodeSpan=(node:AstNode):{start:number;end:number}|null=>{
 const start=node.position?.start?.offset,end=node.position?.end?.offset;
 return start===undefined||end===undefined?null:{start,end};
};
const intersects=(left:SourceSpan,right:{start:number;end:number})=>left.start<right.end&&left.end>right.start;
const structuralToken=(token:RmdSyntaxNode)=>token.type==='block'||token.type==='leaf'||
 token.type==='comment'&&/^[ \t]*%%[ \t]*\n/.test(token.raw);
const tokenKind=(token:RmdSyntaxNode)=>token.type==='comment'?'rmd:comment':'rmd:'+token.type+':'+token.name;
const markdownKind=(node:AstNode):string=>node.type==='paragraph'&&node.children?.length===1&&node.children[0]?.type==='image'
 ?'image':node.type;
const attrsOnly=(span:{start:number;end:number},attrs:readonly RmdSyntaxNode[],source:string)=>attrs.some(token=>
 token.start<=span.start&&token.end>=span.end||source.slice(span.start,span.end).trim()===token.raw.trim());
const lineStarts=(source:string)=>{
 const starts=[0];
 for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10)starts.push(i+1);
 return starts;
};
function lineAt(starts:readonly number[],offset:number):number{
 let lo=0,hi=starts.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(starts[mid]!<=offset)lo=mid+1;else hi=mid;}
 return Math.max(1,lo);
}
function toBlock(span:SourceSpan,source:string,starts:readonly number[]):RevisionBlock{
 const lastOffset=Math.max(span.start,span.end-1);
 return {content:source.slice(span.start,span.end),startLine:lineAt(starts,span.start),
  endLine:lineAt(starts,lastOffset),kind:span.kind};
}
function lineCount(source:string):number{
 if(!source)return 0;
 return splitLines(source).length;
}
function normalizedSource(source:string):string{return source.replace(/\r\n/g,'\n');}
function splitLines(value:string):string[]{return value.match(/[^\n]*\n|[^\n]+$/g)??[];}
type SourceLine={text:string;ending:RevisionLineEnding};
function sourceLines(source:string):SourceLine[]{
 const lines:SourceLine[]=[];let start=0;
 while(start<source.length){
  const end=source.indexOf('\n',start);
  if(end<0){lines.push({text:source.slice(start),ending:'none'});break;}
  const crlf=end>start&&source.charCodeAt(end-1)===13;
  lines.push({text:source.slice(start,crlf?end-1:end),ending:crlf?'CRLF':'LF'});
  start=end+1;
 }
 return lines;
}
function sourceLineRows(before:string,after:string):{rows:RevisionSourceRow[];added:number;removed:number;limited:boolean}{
 const beforeLines=sourceLines(before),afterLines=sourceLines(after);
 const changes=diffArrays(beforeLines.map(line=>line.text),afterLines.map(line=>line.text),DIFF_OPTIONS);
 const replacement=()=>{
  const identical=before===after;
  return {rows:replacementSourceRows(before,after),added:identical?0:lineCount(after),removed:identical?0:lineCount(before),limited:true};
 };
 if(!changes)return replacement();
 const rows:RevisionSourceRow[]=[];let oldIndex=0,newIndex=0,oldLine=1,newLine=1,added=0,removed=0,hunks=0,wasChanged=false;
 const markChanged=()=>{if(!wasChanged){hunks++;wasChanged=true;}};
 for(const change of changes){
  const kind=change.added?'added':change.removed?'removed':'unchanged';
  const count=change.count??change.value.length;
  if(kind==='unchanged'){
   for(let i=0;i<count;i++){
    const old=beforeLines[oldIndex++]!,next=afterLines[newIndex++]!;
    if(old.ending===next.ending){
     wasChanged=false;
     rows.push({kind,text:old.text,oldLine:oldLine++,newLine:newLine++,ending:old.ending});
    }else{
     markChanged();
     rows.push({kind:'removed',text:old.text,oldLine:oldLine++,newLine:null,ending:old.ending,endingChanged:true});removed++;
     rows.push({kind:'added',text:next.text,oldLine:null,newLine:newLine++,ending:next.ending,endingChanged:true});added++;
    }
   }
  }else{
   markChanged();
   for(let i=0;i<count;i++){
    if(kind==='removed'){
     const line=beforeLines[oldIndex++]!;
     rows.push({kind,text:line.text,oldLine:oldLine++,newLine:null,ending:line.ending});removed++;
    }else{
     const line=afterLines[newIndex++]!;
     rows.push({kind,text:line.text,oldLine:null,newLine:newLine++,ending:line.ending});added++;
    }
   }
  }
 }
 if(hunks>MAX_HUNKS)return replacement();
 return {rows,added,removed,limited:false};
}
function replacementSourceRows(before:string,after:string):RevisionSourceRow[]{
 if(before===after)return before?[{kind:'unchanged',text:before,oldLine:1,newLine:1}]:[];
 const rows:RevisionSourceRow[]=[];
 if(before)rows.push({kind:'removed',text:before,oldLine:1,newLine:null});
 if(after)rows.push({kind:'added',text:after,oldLine:null,newLine:1});
 return rows;
}
function replacementBlockRows(before:string,after:string):RevisionDiffRow[]{
 if(before===after)return before?[{kind:'unchanged',block:{content:before,startLine:1,endLine:lineCount(before),kind:'document'}}]:[];
 const rows:RevisionDiffRow[]=[];
 if(before)rows.push({kind:'removed',block:{content:before,startLine:1,endLine:lineCount(before),kind:'document'}});
 if(after)rows.push({kind:'added',block:{content:after,startLine:1,endLine:lineCount(after),kind:'document'}});
 return rows;
}
function spansFor(analysis:RmdAnalysis,source:string):SourceSpan[]{
 const root=analysis.ast as unknown as AstNode;
 const attrs=analysis.tokens.filter(token=>token.type==='attrs');
 const spans:SourceSpan[]=[];
 for(const node of root.children??[]){
  const span=nodeSpan(node);
  if(!span||span.end<=span.start||attrsOnly(span,attrs,source))continue;
  const kind=markdownKind(node);
  spans.push({...span,kind,baseKinds:new Set([kind])});
 }
 for(const token of analysis.tokens.filter(structuralToken)){
  const range={start:token.start,end:token.end};
  const overlaps=spans.filter(span=>intersects(span,range));
  if(!overlaps.length){
   spans.push({...range,kind:tokenKind(token),baseKinds:new Set(),token:true});
   continue;
  }
  const merged:SourceSpan={start:range.start,end:range.end,kind:tokenKind(token),baseKinds:new Set(),token:true};
  for(const span of overlaps){
   merged.start=Math.min(merged.start,span.start);merged.end=Math.max(merged.end,span.end);
   for(const baseKind of span.baseKinds)merged.baseKinds.add(baseKind);
  }
  for(const span of overlaps)spans.splice(spans.indexOf(span),1);
  spans.push(merged);
 }
 // Preview renders a YAML/TOML-looking document header as verbatim text. Keep
 // its delimiters together so a fragment cannot reinterpret them as headings.
 const header=/^\uFEFF?(?:---|\+\+\+)[ \t]*\n[\s\S]*?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?=\n|$)/.exec(source);
 if(header){
  const range={start:0,end:header[0].length};
  const overlaps=spans.filter(span=>intersects(span,range));
  for(const span of overlaps){range.end=Math.max(range.end,span.end);spans.splice(spans.indexOf(span),1);}
  spans.push({...range,kind:'frontmatter',baseKinds:new Set(['frontmatter'])});
 }
 spans.sort((a,b)=>a.start-b.start||a.end-b.end);

 // A valid standalone modifier is a separate Markdown paragraph in the raw AST.
 // Drop that syntax-only node, then extend its target block through the modifier.
 for(const token of attrs){
  if(spans.some(span=>span.start<=token.start&&span.end>=token.end))continue;
  const target=spans.slice().reverse().find(span=>span.end<=token.start&&span.baseKinds.has(token.name)&&
   !source.slice(span.end,token.start).trim());
  if(target)target.end=Math.max(target.end,token.end);
 }
 spans.sort((a,b)=>a.start-b.start||a.end-b.end);

 // Structural tokens normally fully cover their Markdown AST children. If a
 // parser version reports touching overlapping ranges, keep them one block.
 const merged:SourceSpan[]=[];
 for(const span of spans){
  const previous=merged.at(-1);
  if(previous&&intersects(previous,span)){
   previous.end=Math.max(previous.end,span.end);
   for(const kind of span.baseKinds)previous.baseKinds.add(kind);
   if(span.token){previous.kind=span.kind;previous.token=true;}
  }else merged.push({...span,baseKinds:new Set(span.baseKinds)});
 }
 return merged;
}
function definitionsFor(analysis:RmdAnalysis,source:string):string{
 const root=analysis.ast as unknown as AstNode;
 return (root.children??[]).filter(node=>node.type==='definition'||node.type==='footnoteDefinition')
  .map(node=>nodeSpan(node)).filter((span):span is {start:number;end:number}=>Boolean(span))
  .map(span=>source.slice(span.start,span.end)).filter(Boolean).join('\n\n');
}
function blockRows(before:readonly RevisionBlock[],after:readonly RevisionBlock[]):{rows:RevisionDiffRow[];limited:boolean}{
 const changes=diffArrays(before.map(block=>block.content),after.map(block=>block.content),DIFF_OPTIONS);
 if(!changes)return {rows:[],limited:true};
 const rows:RevisionDiffRow[]=[];let beforeIndex=0,afterIndex=0;
 let changedGroup:RevisionDiffRow[]=[];let hunks=0;
 const flush=()=>{
  if(!changedGroup.length)return;
  hunks++;
  const removed=changedGroup.filter(row=>row.kind==='removed');
  const added=changedGroup.filter(row=>row.kind==='added');
  const pairs=Math.min(removed.length,added.length);
  for(let i=0;i<pairs;i++)if(removed[i]!.block.kind===added[i]!.block.kind){
   removed[i]!.compareContent=added[i]!.block.content;
   added[i]!.compareContent=removed[i]!.block.content;
  }
  rows.push(...changedGroup);changedGroup=[];
 };
 for(const change of changes){
  const count=change.count??change.value.length;
  if(change.added){
   for(const block of after.slice(afterIndex,afterIndex+count))changedGroup.push({kind:'added',block});
   afterIndex+=count;
  }else if(change.removed){
   for(const block of before.slice(beforeIndex,beforeIndex+count))changedGroup.push({kind:'removed',block});
   beforeIndex+=count;
  }else{
   flush();
   for(let i=0;i<count;i++){
    rows.push({kind:'unchanged',block:before[beforeIndex++]!});afterIndex++;
   }
  }
 }
 flush();
 return hunks>MAX_HUNKS?{rows:[],limited:true}:{rows,limited:false};
}

/** Builds an exact-source, top-level RMD revision diff with bounded alignment. */
export function buildRevisionDiff(before:string,after:string):RevisionDiff{
 const beforeLf=normalizedSource(before),afterLf=normalizedSource(after);
 const changed=before!==after;
 const tooLarge=before.length>MAX_CHARS||after.length>MAX_CHARS||
  lineCount(beforeLf)>MAX_LINES||lineCount(afterLf)>MAX_LINES;
 if(tooLarge){
  const source=replacementSourceRows(before,after),identical=!changed;
  return {rows:replacementBlockRows(beforeLf,afterLf),sourceRows:source,
   addedLines:identical?0:lineCount(afterLf),removedLines:identical?0:lineCount(beforeLf),changed,limited:true,
   definitionsBefore:'',definitionsAfter:''};
 }
 const beforeAnalysis=analyzeRmd(beforeLf),afterAnalysis=analyzeRmd(afterLf);
 const beforeSpans=spansFor(beforeAnalysis,beforeLf),afterSpans=spansFor(afterAnalysis,afterLf);
 if(beforeSpans.length>MAX_LINES||afterSpans.length>MAX_LINES){
   const identical=!changed;
   return {rows:replacementBlockRows(beforeLf,afterLf),sourceRows:replacementSourceRows(before,after),
    addedLines:identical?0:lineCount(afterLf),removedLines:identical?0:lineCount(beforeLf),changed,limited:true,
   definitionsBefore:'',definitionsAfter:''};
 }
 const beforeStarts=lineStarts(beforeLf),afterStarts=lineStarts(afterLf);
 const beforeBlocks=beforeSpans.map(span=>toBlock(span,beforeLf,beforeStarts));
 const afterBlocks=afterSpans.map(span=>toBlock(span,afterLf,afterStarts));
 const blockResult=blockRows(beforeBlocks,afterBlocks);
 const lineResult=sourceLineRows(before,after);
 const limited=blockResult.limited||lineResult.limited;
 return {rows:limited?replacementBlockRows(beforeLf,afterLf):blockResult.rows,
  sourceRows:lineResult.rows,addedLines:lineResult.added,removedLines:lineResult.removed,
   changed,limited,definitionsBefore:definitionsFor(beforeAnalysis,beforeLf),
   definitionsAfter:definitionsFor(afterAnalysis,afterLf),
   ...(!limited?{analysisBefore:beforeAnalysis,analysisAfter:afterAnalysis}:{})};
}
