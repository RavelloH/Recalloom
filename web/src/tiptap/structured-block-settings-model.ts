import type {JSONContent} from '@tiptap/core';
import {Fragment,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import type {EditorState,Transaction} from '@tiptap/pm/state';
import {parseRmdVisual} from '../rmd-visual';
import {serializeRmdBlock} from '../rmd-serialize';
import {getRmdSchema} from '../rmd-schema';
import {assertRmdBlockCandidate} from './block-visual-model';
import {describeRmdAnchorConflict,findRmdAnchorConflictForNode} from './rmd-anchor-ids';
import {CHAT_SENDERS,normalizeRichContainerField} from './rmd-container-attributes';

export const STRUCTURED_BLOCKS:Readonly<Record<string,{child:string;label:string;title:string}>>={
 tabs:{child:'tab',label:'标签页',title:'新标签'},chat:{child:'message',label:'消息',title:'Agent'},
 glossary:{child:'definition',label:'术语',title:'新术语'},flashcard:{child:'',label:'闪卡',title:''}
};
export const STRUCTURED_CHILD_LABELS:Readonly<Record<string,string>>={message:'消息',tab:'标签页',definition:'术语',front:'正面',back:'背面'};
export type StructuredBlockAction=
 |{type:'field';index:number;field:'title'|'sender'|'body';value:string}
 |{type:'move';index:number;direction:-1|1}
 |{type:'remove';index:number}
 |{type:'add'};
export function structuredChildBody(node:ProseMirrorNode):string{
 const parts:string[]=[];node.forEach(child=>parts.push(serializeRmdBlock(child.toJSON())));return parts.join('\n\n');
}
function rejectUnparsedDirectives(node:JSONContent):void{
 if(node.type==='codeBlock')return;
 if(node.type==='paragraph'||node.type==='rawMarkdown'){
  const text=(node.content??[]).map(child=>child.text??'').join('');
  for(const match of text.matchAll(/^\s*:{3,}\s+([a-z][a-z-]*)(?:\s|$)/gm))
   if(getRmdSchema('block',match[1]!))throw new Error('正文中的 RMD 容器尚未完整或不符合父子结构，请修正后继续。');
 }
 for(const child of node.content??[])rejectUnparsedDirectives(child);
}
function bodyChild(parent:ProseMirrorNode,index:number,body:string,state:EditorState):ProseMirrorNode{
 const child=parent.child(index),json=parent.toJSON() as JSONContent;
 // Serialize an actual parent envelope with a verbatim body. Its generated
 // fences are longer than every nested delimiter, including flashcard pairs.
 json.content=json.content!.map((item,i)=>i===index?{...item,content:[{type:'rawMarkdown',...(body?{content:[{type:'text',text:body}]}:{})}]}:item);
 const parsed=parseRmdVisual(serializeRmdBlock(json));
 const root=parsed.content?.[0],siblings=root?.content;
 if(parsed.content?.length!==1||root?.type!=='richContainer'||root.attrs?.kind!==parent.attrs.kind||siblings?.length!==parent.childCount)
  throw new Error('正文必须保留合法的容器结构，不能修改其他子块。');
 if(siblings.some((item,i)=>i!==index&&serializeRmdBlock(item)!==serializeRmdBlock(parent.child(i).toJSON())))
  throw new Error('本次修改不能改变其他子块。');
 const parsedChild=siblings[index];
 if(parsedChild?.type!=='richContainer'||parsedChild.attrs?.kind!==child.attrs.kind)
  throw new Error('请保留当前子块类型。');
 rejectUnparsedDirectives(parsedChild);
 const content=(parsedChild.content??[{type:'paragraph'}]).map(item=>state.schema.nodeFromJSON(item));
 return child.type.create(child.attrs,Fragment.fromArray(content),child.marks);
}
/** Pure candidate construction. Every unchanged child remains the same object. */
export function structuredBlockCandidate(state:EditorState,pos:number,action:StructuredBlockAction):ProseMirrorNode{
 const parent=state.doc.nodeAt(pos),definition=parent?.type.name==='richContainer'?STRUCTURED_BLOCKS[String(parent.attrs.kind)]:undefined;
 if(!parent||!definition)throw new Error('请选择一个结构容器。');
 const children:ProseMirrorNode[]=[];parent.forEach(child=>children.push(child));
 if(action.type!=='add'&&(!Number.isInteger(action.index)||action.index<0||action.index>=children.length))throw new Error('目标子块已变化，请重新选择。');
 if(action.type==='add'){
  if(parent.attrs.kind==='flashcard')throw new Error('闪卡必须保留固定的正面与背面。');
  children.push(parent.type.create({kind:definition.child,title:definition.title,...(definition.child==='message'?{sender:'assistant'}:{})},state.schema.nodes.paragraph!.create()));
 }else if(action.type==='remove'){
  if(parent.attrs.kind==='flashcard'||children.length<=1)throw new Error('当前容器必须保留至少一个合法子块。');
  children.splice(action.index,1);
 }else if(action.type==='move'){
  if(parent.attrs.kind==='flashcard')throw new Error('闪卡正面与背面的顺序固定。');
  const target=action.index+action.direction;
  if(target<0||target>=children.length)throw new Error('子块已位于边界。');
  [children[action.index],children[target]]=[children[target]!,children[action.index]!];
 }else{
  const current=children[action.index]!;
  if(action.field==='body')children[action.index]=bodyChild(parent,action.index,action.value,state);
  else{
   if(action.field==='sender'&&(!(CHAT_SENDERS as readonly string[]).includes(action.value)||current.attrs.kind!=='message'))throw new Error('请选择合法的消息身份。');
   if(action.field==='title'&&/[\r\n]/.test(action.value))throw new Error('名称请使用单行文字。');
   const normalized=normalizeRichContainerField(String(current.attrs.kind),action.field,action.value);
   if(!normalized.ok)throw new Error(normalized.error);
   children[action.index]=current.type.create({...current.attrs,[action.field]:normalized.value},current.content,current.marks);
  }
 }
 const candidate=parent.type.create(parent.attrs,Fragment.fromArray(children),parent.marks);
 assertRmdBlockCandidate(state.doc,candidate,pos);
 const conflict=findRmdAnchorConflictForNode(state.doc,candidate,pos);
 if(conflict)throw new Error(describeRmdAnchorConflict(conflict));
 return candidate;
}
const panelTransaction=(tr:Transaction)=>tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true);
export function createStructuredBlockTransaction(state:EditorState,pos:number,action:StructuredBlockAction):Transaction{
 const original=state.doc.nodeAt(pos)!,candidate=structuredBlockCandidate(state,pos,action);
 const tr=state.tr;
 if(!candidate.eq(original))tr.replaceWith(pos,pos+original.nodeSize,candidate);
 tr.doc.check();return panelTransaction(tr);
}
/** Same pipeline, but replace only the inspected side/message itself. */
export function createStructuredChildBodyTransaction(state:EditorState,pos:number,body:string):Transaction{
 const child=state.doc.nodeAt(pos),resolved=state.doc.resolve(pos),parent=resolved.parent;
 if(!child||!STRUCTURED_CHILD_LABELS[String(child.attrs.kind)]||resolved.depth<1||parent.type.name!=='richContainer')throw new Error('请选择合法的结构子块。');
 const parentPos=resolved.before(resolved.depth),index=resolved.index();
 const candidate=structuredBlockCandidate(state,parentPos,{type:'field',index,field:'body',value:body}).child(index);
 const tr=state.tr;if(!candidate.eq(child))tr.replaceWith(pos,pos+child.nodeSize,candidate);
 tr.doc.check();return panelTransaction(tr);
}
