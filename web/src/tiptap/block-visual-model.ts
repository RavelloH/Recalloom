import type {JSONContent} from '@tiptap/core';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {getRmdSchema} from '../rmd-schema';
import {parseRmdVisual} from '../rmd-visual';
import {serializeRmdBlock} from '../rmd-serialize';

/** PM deliberately shares one permissive container type; RMD is stricter. */
export function assertRmdStructure(node:JSONContent,parentKind?:string):void{
 const kind=node.type==='richContainer'?String(node.attrs?.kind??''):undefined;
 const rule=kind?getRmdSchema('block',kind):undefined;
 if(rule?.allowedParents&&!rule.allowedParents.includes(parentKind??''))
  throw new Error('子块必须保留在合法的父容器内。');
 if(rule?.children){
  if(!node.content?.length||node.content.some(child=>child.type!=='richContainer'||!rule.children!.includes(String(child.attrs?.kind))))
   throw new Error('该容器只能包含指定的结构子块。');
 }
 if(kind==='flashcard'&&(node.content?.length!==2||node.content[0]?.attrs?.kind!=='front'||node.content[1]?.attrs?.kind!=='back'))
  throw new Error('闪卡必须按顺序保留一个正面和一个背面。');
 for(const child of node.content??[])assertRmdStructure(child,kind);
}

function outline(node:JSONContent):unknown[]{
 const children=(node.content??[]).flatMap(outline);
 return node.type==='richContainer'
  ?[{kind:node.attrs?.kind,title:node.attrs?.title??'',sender:node.attrs?.kind==='message'?node.attrs?.sender??null:null,children}]
  :children;
}

/** Validate the serialized form too: e.g. a title must not become RMD metadata.
 * Only structural containers are compared; ordinary prose may contain Markdown.
 */
export function assertRmdBlockCandidate(document:ProseMirrorNode,candidate:ProseMirrorNode,pos:number):void{
 candidate.check();
 const parent=document.resolve(pos).parent;
 const parentKind=parent.type.name==='richContainer'?String(parent.attrs.kind):undefined;
 const json=candidate.toJSON() as JSONContent;
 assertRmdStructure(json,parentKind);
 if(candidate.type.name==='image'){
  assertVisualField('image','src',String(candidate.attrs.src??''));
  const parsed=parseRmdVisual(serializeRmdBlock(json)).content;
  if(parsed?.length!==1||parsed[0]?.type!=='image'||parsed[0]?.attrs?.src!==candidate.attrs.src)
   throw new Error('图片地址无法完整保存，请对特殊字符进行 URL 编码。');
 }
 if(!outline(json).length)return;
 let envelope=json;
 if(parentKind){
  envelope={type:'richContainer',attrs:{kind:parentKind},content:parentKind==='flashcard'
   ?Array.from({length:parent.childCount},(_,index)=>index===document.resolve(pos).index()?json:parent.child(index).toJSON())
   :[json]};
 }
 const parsed=parseRmdVisual(serializeRmdBlock(envelope));
 if(JSON.stringify(outline(envelope))!==JSON.stringify(outline(parsed)))
  throw new Error('当前内容会改变 RMD 容器结构或标题，请调整后继续。');
}

export function assertVisualField(kind:string,name:string,value:string):void{
 if(kind==='codeBlock'&&name==='language'&&!/^[\w.+#-]*$/.test(value))
  throw new Error('代码语言只能包含字母、数字、点、加号、井号和连字符。');
 if(kind==='image'&&name==='src'){
  try{
   const url=new URL(value,'https://recalloom.invalid/');
   if(!value.trim()||/[\u0000-\u0020<>]/.test(value)||!['http:','https:'].includes(url.protocol))throw new Error();
  }catch{throw new Error('请输入有效的图片地址（HTTP、HTTPS 或相对路径）。');}
 }
 if(kind==='image'&&name==='title'&&/[\r\n]/.test(value))
  throw new Error('图片标题请使用单行文字。');
 if(name==='latex'){
  if(!value.trim()||(kind==='blockMath'?/^\s*\$\$\s*$/m.test(value):/[\r\n]|(?<!\\)\$/.test(value)))
   throw new Error('公式尚未完整，请保留 LaTeX 正文并移除外层公式分隔符。');
 }
}
