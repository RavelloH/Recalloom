import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {findRmdComments} from './rmd-comment';
import {parseWikiTarget} from '../../src/wiki-syntax.js';
import {RMD_REGISTRY,attrsByBlock,getRmdSchema,isRmdId,isValidRmdValue,type RmdNodeType,type RmdSchema} from './rmd-schema';

type Mdast={type:string;children?:Mdast[];position?:{start?:{offset?:number};end?:{offset?:number}}};
export type RmdSpan={start:number;end:number};
export type RmdSyntaxNode={
 type:'inline'|'block'|'leaf'|'attrs'|'comment';
 name:string;start:number;end:number;raw:string;
 main:string;attributes:Record<string,string>;
 children?:RmdSyntaxNode[];
};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
/** Bound nested AST re-projection. Invalid over-depth input stays verbatim. */
export const MAX_RMD_CONTAINER_DEPTH=RMD_REGISTRY.constraints.containerDepthMaximum;
export const MAX_RMD_FENCE_LENGTH=RMD_REGISTRY.constraints.fenceLengthMaximum;
const blockedTypes=new Set(['code','inlineCode','math','inlineMath','html','link','linkReference','imageReference','definition']);
const overlap=(range:RmdSpan,withRanges:readonly RmdSpan[])=>withRanges.some(r=>range.start<r.end&&range.end>r.start);
const escapeCount=(text:string,pos:number)=>{let count=0;for(let i=pos-1;i>=0&&text[i]==='\\';i--)count++;return count};
const escaped=(text:string,pos:number)=>escapeCount(text,pos)%2===1;
export function protectedRmdRanges(source:string):RmdSpan[]{
 const root=parser.parse(source) as Mdast;
 const spans:RmdSpan[]=[];
 const walk=(node:Mdast)=>{
  const start=node.position?.start?.offset,end=node.position?.end?.offset;
  if(blockedTypes.has(node.type)){
   if(start!==undefined&&end!==undefined)spans.push({start,end});
   return;
  }
  node.children?.forEach(walk);
 };
 walk(root);
 return spans;
}
/** Split at whitespace-delimited pipes outside quoted or escaped strings. */
export function splitRmdArguments(input:string):string[]|null{
 const result:string[]=[];let start=0,quoted=false,backslash=false;
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(backslash){backslash=false;continue;}
  if(ch==='\\'){backslash=true;continue;}
  if(ch==='"'){quoted=!quoted;continue;}
  if(ch==='|'&&!quoted&&i>0&&i<input.length-1&&/\s/.test(input[i-1]!)&&/\s/.test(input[i+1]!)){
   result.push(input.slice(start,i).trim());
   start=i+1;
  }
 }
 if(quoted||backslash)return null;
 result.push(input.slice(start).trim());
 return result;
}
function decodeValue(raw:string):string|null{
 if(!raw)return null;
 if(raw.startsWith('"')){
  try{
   if(!raw.endsWith('"'))return null;
   const parsed:unknown=JSON.parse(raw);
   return typeof parsed==='string'?parsed:null;
  }catch{return null;}
 }
 if(raw.includes('"'))return null;
 // The delimiter is only a whitespace-delimited pipe. Backslashes escape
 // literal pipes, equals signs, colons or backslashes in unquoted parameters.
 return raw.replace(/\\([|=:@\\])/g,'$1');
}
export function parseRmdArguments(input:string,schema:RmdSchema):{main:string;attributes:Record<string,string>}|null{
 const chunks=splitRmdArguments(/^\|[ \t]/.test(input)?' '+input:input);
 if(!chunks)return null;
 const main=chunks.shift()??'';
 if(schema.main==='required'&&!main||schema.main==='forbidden'&&main)return null;
 const values:Record<string,string>={};
 let usedNamed=false,position=0;
 for(const chunk of chunks){
  if(!chunk)return null;
  const named=/^([a-z][a-z0-9-]*)=(.*)$/s.exec(chunk);
  let key:string,raw:string;
  if(named){usedNamed=true;key=named[1]!;raw=named[2]!.trim();}
  else {
   if(usedNamed||position>=schema.positions.length)return null;
   key=schema.positions[position++]!;raw=chunk;
  }
  const type=schema.attributes[key];
  if(!type||Object.hasOwn(values,key))return null;
  const decoded=decodeValue(raw);
  if(decoded===null||!isValidRmdValue(type,decoded))return null;
  values[key]=type==='id'?decoded.toLowerCase():decoded;
 }
 // Do not treat missing color as the default Mark: they have different meaning.
 if(schema.requiredAttributes?.some(field=>!Object.hasOwn(values,field)))return null;
 return {main,attributes:values};
}
const linesOf=(source:string)=>{
 const lines:{line:string;start:number;end:number}[]=[];
 let from=0;
 for(let i=0;i<=source.length;i++){
  if(i<source.length&&source[i]!=='\n')continue;
  lines.push({line:source.slice(from,i),start:from,end:i});
  from=i+1;
 }
 return lines;
};
function headerNode(source:string,start:number,end:number,name:string,type:RmdNodeType,argument:string):RmdSyntaxNode|null{
 const schema=getRmdSchema(type,name);
 if(!schema)return null;
 const args=parseRmdArguments(argument,schema);
 if(!args)return null;
 if(type==='leaf'&&name==='embed'&&!parseWikiTarget(args.main,false))return null;
 if(type==='leaf'&&name==='link-card'&&!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(args.main))return null;
 return {type,name,start,end,raw:source.slice(start,end),main:args.main,attributes:args.attributes};
}
function scanBlocks(source:string,protectedRanges:RmdSpan[],parentKind?:string):RmdSyntaxNode[]{
 const lines=linesOf(source),results:RmdSyntaxNode[]=[];
 type Entry={node:RmdSyntaxNode;fence:number;invalid:boolean;openLine:number};
 const stack:Entry[]=[];
 const finish=(entry:Entry,end:number)=>{
  entry.node.end=end;entry.node.raw=source.slice(entry.node.start,end);
  if(entry.invalid)return;
  const children=entry.node.children??[];
  const schema=getRmdSchema('block',entry.node.name)!;
  if(schema.children){
   if(children.length===0||children.some(c=>!schema.children!.includes(c.name)))return;
   if(schema.orderedChildren&&(children.length!==schema.orderedChildren.length||
     children.some((child,i)=>child.name!==schema.orderedChildren![i])))return;
  }
  if(!source.slice(entry.openLine,end).trim())return;
  if(stack.length)stack[stack.length-1]!.node.children!.push(entry.node);
  else results.push(entry.node);
 };
 for(const {line,start,end}of lines){
  const close=/^ {0,3}(:{3,})[ \t]*$/.exec(line);
  if(close){
   if(close[1]!.length>MAX_RMD_FENCE_LENGTH){for(const entry of stack)entry.invalid=true;continue;}
   if(stack.length){
    const entry=stack[stack.length-1]!;
    if(close[1]!.length===entry.fence){
     stack.pop();finish(entry,end);
    }else entry.invalid=true;
   }
   continue;
  }
  const head=/^ {0,3}(:{3,})[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+(.*))?$/.exec(line);
  if(!head||protectedRanges.some(range=>start>=range.start&&start<range.end))continue;
  const fence=head[1]!.length,name=head[2]!;
  if(fence>MAX_RMD_FENCE_LENGTH){for(const entry of stack)entry.invalid=true;continue;}
  const before=head[3]??'';
  const single=new RegExp('[ \\t]+'+':'.repeat(fence)+'[ \\t]*$').exec(before);
  const isLeaf=Boolean(single);
  const type:RmdNodeType=isLeaf?'leaf':'block';
  const current=headerNode(source,start,end,name,type,isLeaf?before.slice(0,single!.index).trim():before.trim());
  if(!current){if(stack.length)stack[stack.length-1]!.invalid=true;continue;}
  const parent=stack.at(-1);
  const schema=getRmdSchema(type,name)!;
  if(parent){
   if(fence>=parent.fence)parent.invalid=true;
   if(schema.allowedParents&&!schema.allowedParents.includes(parent.node.name))parent.invalid=true;
   if(!schema.allowedParents&&parent.node.name==='tabs'&&!['tab'].includes(name))parent.invalid=true;
   if(!schema.allowedParents&&parent.node.name==='flashcard')parent.invalid=true;
  }else if(schema.allowedParents&&!schema.allowedParents.includes(parentKind??''))continue;
  if(isLeaf){
   if(parent)parent.node.children!.push(current);
   else results.push(current);
   continue;
  }
  current.children=[];
  const tooDeep=stack.length>=MAX_RMD_CONTAINER_DEPTH;
  if(tooDeep)for(const entry of stack)entry.invalid=true;
  stack.push({node:current,fence,invalid:tooDeep||(parent?.invalid??false),openLine:end+1});
 }
 return results.sort((a,b)=>a.start-b.start);
}
function isCovered(index:number,tokens:readonly RmdSyntaxNode[]){return tokens.some(t=>index>=t.start&&index<t.end);}
function scanInline(source:string,blocked:RmdSpan[],blocks:RmdSyntaxNode[]):RmdSyntaxNode[]{
 const found:RmdSyntaxNode[]=[];
 const pattern=/::[ \t]+([a-z][a-z0-9-]*)[ \t]+/g;
 for(const match of source.matchAll(pattern)){
  const start=match.index??0;
  if(escaped(source,start)||start>0&&source[start-1]===':'||
   overlap({start,end:start+match[0].length},blocked)||isCovered(start,blocks))continue;
  const name=match[1]!,schema=getRmdSchema('inline',name);
  if(!schema)continue;
  let quote=false,escape=false,finish=-1;
  for(let i=start+match[0].length;i<source.length-2;i++){
   const ch=source[i]!;
   if(ch==='\n')break;
   if(escape){escape=false;continue;}
   if(ch==='\\'){escape=true;continue;}
   if(ch==='"'){quote=!quote;continue;}
   if(ch===' '&&source.startsWith('::',i+1)&&source[i+3]!==':'){
    finish=i+3;break;
   }
  }
  if(finish<0||overlap({start:finish-2,end:finish},blocked))continue;
  const main=source.slice(start+match[0].length,finish-3).trim();
  const node=headerNode(source,start,finish,name,'inline',main);
  if(node){found.push(node);pattern.lastIndex=finish;}
 }
 return found;
}
function blockType(last:Mdast|null):string|null{
 if(!last)return null;
 if(last.type==='paragraph'&&last.children?.length===1&&last.children[0]?.type==='image')return 'image';
 return last.type;
}
/** Same-line attrs need only the short prefix preceding @ attrs. */
function previousBlockType(source:string,start:number):string|null{
 return blockType(((parser.parse(source.slice(0,start)) as Mdast).children??[]).at(-1)??null);
}
function scanAttrs(source:string,blocked:RmdSpan[],blocks:RmdSyntaxNode[]):RmdSyntaxNode[]{
 const out:RmdSyntaxNode[]=[];
 // Top-level MDAST positions are monotonic. Reusing one parse avoids the old
 // quadratic behavior of reparsing source.slice(0,offset) for every modifier.
 // A table may contain its own trailing @ attrs line, so also retain the
 // last block whose start precedes this line (not only blocks already ended).
 const top=(parser.parse(source) as Mdast).children??[];
 let blockIndex=0,lastBlock:Mdast|null=null;
 for(const {line,start,end}of linesOf(source)){
  while(blockIndex<top.length&&(top[blockIndex]!.position?.start?.offset??Infinity)<start){
   lastBlock=top[blockIndex++]!;
  }
  const hit=/@ attrs(?:[ \t]+([^@\r\n]*?))?[ \t]+@[ \t]*$/.exec(line);
  if(!hit)continue;
  const from=start+hit.index;
  if(escaped(source,from)||overlap({start:from,end},blocked)||isCovered(from,blocks))continue;
  const prefix=line.slice(0,hit.index);
  const isStandalone=!prefix.trim();
  let target:string|null=null;
  if(isStandalone){
   if(start===0||source[start-1]!=='\n')continue;
   const before=source.slice(0,start-1);
   if(!before||before.endsWith('\n'))continue;
   target=blockType(lastBlock);
  }else{
   if(!/\s$/.test(prefix))continue;
   target=previousBlockType(prefix,prefix.length);
  }
  const definitions=target?attrsByBlock[target]:undefined;
  if(!definitions)continue;
  const text=' '+(hit[1]??'');
  const segments=splitRmdArguments(text);
  // A malformed modifier is local plaintext, never a stop token for the
  // rest of the document. Keep scanning later independent valid blocks.
  if(!segments)continue;
  const first=(segments.shift()??'').trim();
  const values:Record<string,string>={};
  if(first){
   if(!isRmdId(first))continue;
   values.id=first.toLowerCase();
  }
  let valid=true;
  for(const item of segments){
   const match=/^([a-z][a-z0-9-]*)=(.*)$/s.exec(item);
   if(!match){valid=false;break;}
   const key=match[1]!,raw=match[2]!.trim(),type=definitions[key];
   const value=decodeValue(raw);
   if(!type||value===null||!isValidRmdValue(type,value)||Object.hasOwn(values,key)){valid=false;break;}
   values[key]=type==='id'?value.toLowerCase():value;
  }
  if(!valid||!Object.keys(values).length)continue;
  out.push({type:'attrs',name:target!,start:from,end,raw:source.slice(from,end),main:'',attributes:values});
 }
 return out;
}
/** Unified Wiki span scanner works before GFM divides table columns.
 * It intentionally uses the existing Wiki target validator, but does not
 * depend on an already-split table AST. All protected source contexts remain
 * literal. Both preview and visual adapters consume the same spans.
 */
export type RmdWikiSpan={start:number;end:number;raw:string;name:'wikiLink'|'crossRef';
 target?:string;anchor?:string;alias?:string;id?:string};
export function findRmdWikiSpans(source:string):RmdWikiSpan[]{
 const blocked=protectedRmdRanges(source),results:RmdWikiSpan[]=[];
 for(const m of source.matchAll(/\[\[([^\]\r\n]{1,2048})\]\]/g)){
  const start=m.index??0,end=start+m[0].length,raw=m[1]!;
  if(escaped(source,start)||overlap({start,end},blocked))continue;
  if(raw.startsWith('#')){
   const id=raw.slice(1);
   if(isRmdId(id))results.push({start,end,raw:m[0],name:'crossRef',id:id.toLowerCase()});
   continue;
  }
  const parsed=parseWikiTarget(raw);
  if(parsed)results.push({start,end,raw:m[0],name:'wikiLink',
   target:parsed.target,anchor:parsed.anchor??'',alias:parsed.alias??''});
 }
 return results;
}
/** Replace only pipe characters INSIDE valid RMD nodes with equal-length
 * private sentinels before GFM table tokenization. The shared AST adapter
 * consumes these nodes after parsing; unmatched/invalid syntax is never hidden.
 * Offsets remain identical, so source spans stay authoritative.
 */
export const RMD_PIPE_SENTINEL='\uE000';
export function shieldRmdTablePipes(source:string):string{
 if(source.includes(RMD_PIPE_SENTINEL))return source;
 const tokens=[...lexRmd(source).filter(t=>t.type==='inline'||t.type==='attrs'),...findRmdWikiSpans(source)];
 const chars=source.split('');
 for(const token of tokens){
  for(let i=token.start;i<token.end;i++){
   if(chars[i]==='|')chars[i]=RMD_PIPE_SENTINEL;
  }
 }
 return chars.join('');
}
/** Shared RMD lexer. Only valid source spans become semantic tokens.
 * Unknown/malformed extensions remain the user's original Markdown text.
 * The rendering adapters consume the same nodes without reparsing attributes.
 */
export function lexRmd(input:string,parentKind?:string):RmdSyntaxNode[]{
 const source=input.replace(/\r\n/g,'\n'),protectedRanges=protectedRmdRanges(source);
 const comments=findRmdComments(source).map(c=>({
  type:'comment' as const,name:'comment',start:c.start,end:c.end,raw:c.raw,main:c.body,attributes:{}
 }));
 const blocks=scanBlocks(source,protectedRanges,parentKind);
 const excluded=[...blocks,...comments];
 const inline=scanInline(source,protectedRanges,excluded);
 const attrs=scanAttrs(source,protectedRanges,[...excluded,...inline]);
 return [...blocks,...comments.filter(t=>!isCovered(t.start,blocks)),...inline,...attrs]
  .sort((a,b)=>a.start-b.start);
}
