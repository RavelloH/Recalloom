import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {lexRmd,findRmdWikiSpans,protectedRmdRanges,RMD_PIPE_SENTINEL,type RmdSyntaxNode,type RmdSpan} from './rmd-lexer';
import {findCriticMarkup} from './critic-syntax';
import {isRmdId} from './rmd-schema';

/** Common RMD renderer adapter, with one lexer for all presentation surfaces.
 * Source offsets are authoritative, and invalid RMD stays ordinary Markdown.
 * The plugin manipulates MDAST rather than translating to legacy directives.
 */
type RmdMdast={
 type:string;name?:string;value?:string;url?:string;alt?:string;title?:string|null;
 children?:RmdMdast[];lang?:string;meta?:string;
 position?:{start?:{offset?:number};end?:{offset?:number}};
 data?:{hName?:string;hProperties?:Record<string,string>;rmdBody?:string};
};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const span=(node:RmdMdast):RmdSpan|null=>{
 const start=node.position?.start?.offset,end=node.position?.end?.offset;
 return start===undefined||end===undefined?null:{start,end};
};
const intersects=(x:RmdSpan,a:RmdSpan)=>x.start<a.end&&x.end>a.start;
const contains=(outer:RmdSpan,inner:RmdSpan)=>outer.start<=inner.start&&outer.end>=inner.end;
const nodeSpan=(token:RmdSyntaxNode)=>({start:token.start,end:token.end});
const makeInline=(token:RmdSyntaxNode):RmdMdast=>{
 const props:Record<string,string>={};
 let name='rk-'+token.name;
 if(token.type==='comment')name='rk-comment';
 if(token.name==='wikiLink'){
  return {type:'rmdInline',name:'wikiLink',data:{hName:'wiki-ref',hProperties:{
   dataTarget:encodeURIComponent(token.attributes.target??''),
   dataAnchor:encodeURIComponent(token.attributes.anchor??''),
   dataAlias:encodeURIComponent(token.attributes.alias??'')
  }},children:[],position:{start:{offset:token.start},end:{offset:token.end}}};
 }
 if(token.name==='crossRef')return {type:'rmdInline',name:'crossRef',data:{hName:'rk-cross-ref',hProperties:{dataId:token.main}},
  children:[],position:{start:{offset:token.start},end:{offset:token.end}}};
 if(token.name==='critic')return {type:'rmdInline',name:'critic',data:{hName:'rk-critic',hProperties:{
  dataKind:token.attributes.kind??'',dataBefore:encodeURIComponent(token.attributes.before??''),
  dataValue:encodeURIComponent(token.main)
 }},children:[{type:'text',value:token.main}],position:{start:{offset:token.start},end:{offset:token.end}}};
 if(token.name==='mark'||token.name==='highlight'){
  name='mark';
  if(token.name==='highlight')props.dataRkColor=token.attributes.color!;
 }else if(token.name==='badge')props.dataVariant=token.attributes.variant??'neutral';
 else if(token.name==='tooltip')props.dataContent=token.attributes.description??'';
 else if(token.name==='abbr')props.dataTitle=token.attributes.description??'';
 else if(token.name==='cloze')props.dataHint=token.attributes.hint??'';
 const inside=parser.parse(token.main) as RmdMdast;
 const child=inside.children?.at(0);
 return {
  type:'rmdInline',name:token.name,
  data:{hName:name,hProperties:props},
  children:child?.type==='paragraph'?child.children??[]:[{type:'text',value:token.main}],
  position:{start:{offset:token.start},end:{offset:token.end}}
 };
};
const makeBlock=(token:RmdSyntaxNode):RmdMdast=>{
 if(token.type==='comment'){
  const parsed=parser.parse(token.main) as RmdMdast;
  applyRmdTree(parsed,token.main);
  return {type:'rmdBlock',name:'comment',data:{hName:'rk-rmd-comment-block',hProperties:{},rmdBody:token.main},
   children:parsed.children??[],position:{start:{offset:token.start},end:{offset:token.end}}};
 }
 if(token.type==='leaf'){
  if(token.name==='embed'){
   const [target,anchor]=token.main.split('#',2);
   return {type:'rmdBlock',data:{hName:'wiki-embed',hProperties:{
    dataTarget:target??'',dataAnchor:anchor??''
   }},children:[],position:{start:{offset:token.start},end:{offset:token.end}}};
  }
  return {type:'rmdBlock',data:{hName:'rk-link-card',hProperties:{
   dataUrl:token.main,dataTitle:token.attributes.title??''
  }},children:[],position:{start:{offset:token.start},end:{offset:token.end}}};
 }
 const newline=token.raw.indexOf('\n'),last=token.raw.lastIndexOf('\n');
 const body=newline<0||last<=newline?'':token.raw.slice(newline+1,last).replace(/^\n+|\n+$/g,'');
 const inner=parser.parse(body) as RmdMdast;
 applyRmdTree(inner,body,token.name);
 const props:Record<string,string>={};
 let hName='rk-callout';
 if(token.name==='mark'||token.name==='highlight'){
  hName='rk-rmd-block-mark';
  if(inner.children?.length===1&&inner.children[0]?.type==='math')props.dataRkMathOnly='true';
  if(token.name==='highlight')props.dataRkColor=token.attributes.color!;
 }else{
  props.dataKind=token.name;
  props.dataTitle=token.main;
  if(token.name==='message')props.dataSender=token.attributes.sender??'assistant';
 }
 if(token.attributes.id)props.dataId=token.attributes.id;
 return {type:'rmdBlock',name:token.name,data:{hName,hProperties:props,rmdBody:body},
  children:inner.children??[],position:{start:{offset:token.start},end:{offset:token.end}}};
};
function replaceBlock(tree:RmdMdast,token:RmdSyntaxNode):boolean{
 const nodes=tree.children??[];
 const cover=nodeSpan(token);
 const indexes:number[]=[];
 for(let i=0;i<nodes.length;i++){
  const r=span(nodes[i]!);
  if(r&&intersects(r,cover)){
   if(!contains(cover,r))return false;
   indexes.push(i);
  }
 }
 if(indexes.length===0)return false;
 const first=indexes[0]!,last=indexes.at(-1)!;
 if(last-first+1!==indexes.length)return false;
 nodes.splice(first,indexes.length,makeBlock(token));
 return true;
}
function replaceInline(tree:RmdMdast,token:RmdSyntaxNode,source:string):boolean{
 const range=nodeSpan(token),children=tree.children??[];
 for(const child of children){
  const r=span(child);
  if(r&&contains(r,range)&&child.children?.length){
   if(replaceInline(child,token,source))return true;
  }
 }
 const hits:number[]=[];
 for(let i=0;i<children.length;i++){
  const r=span(children[i]!);
  if(r&&intersects(r,range))hits.push(i);
 }
 if(!hits.length)return false;
 const first=children[hits[0]!]!,last=children[hits.at(-1)!]!;
 const a=span(first)!,b=span(last)!;
 if(a.start>range.start||b.end<range.end)return false;
 if(a.start<range.start&&first.type!=='text')return false;
 if(b.end>range.end&&last.type!=='text')return false;
 const replacement:RmdMdast[]=[];
 if(a.start<range.start)replacement.push({
  type:'text',value:source.slice(a.start,range.start),
  position:{start:{offset:a.start},end:{offset:range.start}}
 });
 replacement.push(makeInline(token));
 if(b.end>range.end)replacement.push({
  type:'text',value:source.slice(range.end,b.end),
  position:{start:{offset:range.end},end:{offset:b.end}}
 });
 children.splice(hits[0]!,hits.length,...replacement);
 return true;
}
function findAttrTarget(root:RmdMdast,token:RmdSyntaxNode,source:string):{node:RmdMdast;removeIndex?:number;tableRow?:boolean}|null{
 const children=root.children??[];
 const before=source.slice(0,token.start);
 const standalone=!before.slice(before.lastIndexOf('\n')+1).trim();
 if(standalone){
  const candidateIndex=children.findIndex(node=>{
   const p=span(node);
   return p?.start===token.start||node.type==='paragraph'&&p&&p.start<=token.start&&p.end>=token.end;
  });
  const embeddedTable=children.find(node=>node.type==='table'&&span(node)&&contains(span(node)!,nodeSpan(token)));
  if(embeddedTable)return {node:embeddedTable,tableRow:true};
  const prev=candidateIndex>0?children[candidateIndex-1]:null;
  if(!prev)return null;
  return {node:prev,removeIndex:candidateIndex};
 }
 const parent=children.find(node=>{const p=span(node);return p&&p.start<=token.start&&p.end>=token.end;});
 return parent?{node:parent}:null;
}
function applyAttrs(root:RmdMdast,token:RmdSyntaxNode,source:string):void{
 const found=findAttrTarget(root,token,source);
 if(!found)return;
 const {node,removeIndex,tableRow}=found,values=token.attributes;
 if(tableRow)node.children?.pop();
 else if(removeIndex!==undefined)root.children?.splice(removeIndex,1);
 else {
  const last=node.children?.at(-1);
  const shieldedRaw=token.raw.split('|').join(RMD_PIPE_SENTINEL);
  const actual=last?.value?.includes(token.raw)?token.raw:shieldedRaw;
  if(last?.type==='text'&&last.value?.includes(actual)){
   last.value=last.value.slice(0,last.value.lastIndexOf(actual)).trimEnd();
  }
 }
 node.data??={};node.data.hProperties??={};
 if(values.id)node.data.hProperties.id=values.id;
 if(node.type==='code'){
  if(values.file)node.data.hProperties.dataFile=values.file;
  if(values.wrap)node.data.hProperties.dataWrap=values.wrap;
  if(values.expand)node.data.hProperties.dataExpand=values.expand;
 }
 if(node.type==='table'&&values.caption)node.data.hProperties.dataRmdCaption=values.caption;
 if(node.type==='math'&&values.id){
  node.data.hName='rk-numbered-math';node.data.hProperties.dataId=values.id;
 }
 if(node.type==='paragraph'&&node.children?.[0]?.type==='image'&&node.children.slice(1).every(child=>child.type==='text'&&!child.value)){
  const img=node.children[0]!;
  if(values.caption||values.width||values.height||values.id){
   node.data.hName='rk-figure';
   node.data.hProperties.dataPayload=encodeURIComponent(JSON.stringify({
    src:img.url,alt:img.alt??'',title:img.title??'',
    width:values.width?Number(values.width):undefined,
    height:values.height?Number(values.height):undefined,
    caption:values.caption??'',id:values.id??null
   }));
   node.children=[];
  }
 }
}
function applyRmdTree(root:RmdMdast,source:string,parentKind?:string){
 const tokens=lexRmd(source,parentKind);
 const protectedRanges=protectedRmdRanges(source);
 const isUnavailable=(start:number,end:number)=>tokens.some(t=>start<t.end&&end>t.start)||
  protectedRanges.some(t=>start<t.end&&end>t.start);
 const otherInline:RmdSyntaxNode[]=[];
 for(const ref of findRmdWikiSpans(source)){
  const {start,end}=ref;
  if(isUnavailable(start,end))continue;
  otherInline.push({type:'inline',name:ref.name,start,end,raw:ref.raw,
   main:ref.name==='crossRef'?ref.id!:ref.raw,
   attributes:ref.name==='crossRef'?{}:{target:ref.target!,anchor:ref.anchor??'',alias:ref.alias??''}});
 }
 for(const entry of findCriticMarkup(source)){
  const {start,end,match}=entry;
  if(isUnavailable(start,end)||otherInline.some(t=>start<t.end&&end>t.start))continue;
  otherInline.push({type:'inline',name:'critic',start,end,raw:match.raw,main:match.text,
   attributes:{kind:match.kind,before:match.before}});
 }
 const blocks=tokens.filter(x=>x.type==='block'||x.type==='leaf'||x.type==='comment'&&/^[ \t]*%%[ \t]*\n/.test(x.raw));
 for(const token of blocks.slice().reverse())replaceBlock(root,token);
 for(const token of tokens.filter(x=>x.type==='attrs').slice().reverse())applyAttrs(root,token,source);
 for(const token of [...tokens.filter(x=>x.type==='inline'||x.type==='comment'&&!/^[ \t]*%%[ \t]*\n/.test(x.raw)),...otherInline]
  .sort((a,b)=>b.start-a.start))replaceInline(root,token,source);
 const restore=(node:RmdMdast)=>{
  if(node.type==='text'&&node.value?.includes(RMD_PIPE_SENTINEL))node.value=node.value.split(RMD_PIPE_SENTINEL).join('|');
  node.children?.forEach(restore);
 };
 restore(root);
}
/** Supply precisely the same source that the Markdown parser sees. */
export function remarkRmdSyntax(source:string){
 return (root:RmdMdast)=>applyRmdTree(root,source);
}
