import type {Editor} from '@tiptap/core';
import {Fragment,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {NodeSelection,type Transaction} from '@tiptap/pm/state';
import {assertVisualField} from './block-visual-model';

function exactObject(editor:Editor,pos:number){
 if(!Number.isInteger(pos)||pos<0||pos>=editor.state.doc.content.size)throw new Error('编辑目标已变化，请重新打开。');
 const node=editor.state.doc.nodeAt(pos),resolved=editor.state.doc.resolve(pos);
 if(!node||!['image','inlineMath','blockMath'].includes(node.type.name))throw new Error('此操作只支持图片或公式。');
 return {node,resolved,index:resolved.index()};
}
function ready(transaction:Transaction){
 transaction.doc.check();
 return transaction.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true);
}
/** Delete only the exact object. Never let PM's fitting expand into its owner. */
export function createRemoveBlockObjectTransaction(editor:Editor,pos:number):Transaction{
 const {node,resolved,index}=exactObject(editor,pos),parent=resolved.parent;
 let replacement=Fragment.empty;
 if(!parent.canReplace(index,index+1,replacement)){
  const paragraph=editor.state.schema.nodes.paragraph?.createAndFill();
  if(!paragraph||!parent.canReplace(index,index+1,Fragment.from(paragraph)))
   throw new Error('父容器必须保留此类内容，无法单独删除。');
  replacement=Fragment.from(paragraph);
 }
 return ready(editor.state.tr.replaceWith(pos,pos+node.nodeSize,replacement));
}
function paragraphAttrs(source:ProseMirrorNode,paragraph:ProseMirrorNode['type']){
 const attrs:Record<string,unknown>={};
 for(const key of ['id','blockId'])if(key in (paragraph.spec.attrs??{})&&source.attrs[key]!=null)attrs[key]=source.attrs[key];
 return attrs;
}
/** Convert one formula in one transaction, preserving every surrounding sibling. */
export function createMathTypeTransaction(editor:Editor,pos:number,type:'inline'|'block'):{transaction:Transaction;pos:number}{
 if(type!=='inline'&&type!=='block')throw new Error('不支持的公式类型。');
 const {node,resolved,index}=exactObject(editor,pos);
 if(node.type.name!=='inlineMath'&&node.type.name!=='blockMath')throw new Error('请选择一个公式。');
 const wanted=type==='inline'?'inlineMath':'blockMath',schema=editor.state.schema;
 if(!schema.nodes[wanted])throw new Error('当前编辑器不支持此公式类型。');
 if(node.type.name===wanted)return {transaction:ready(editor.state.tr),pos};
 const latex=String(node.attrs.latex??'');
 assertVisualField(wanted,'latex',latex);
 if(type==='inline'){
  const paragraph=schema.nodes.paragraph;
  if(!paragraph)throw new Error('当前文档不支持行内公式段落。');
  const inline=schema.nodes.inlineMath!.create({latex});
  const replacement=paragraph.create(paragraphAttrs(node,paragraph),inline);
  if(!resolved.parent.canReplace(index,index+1,Fragment.from(replacement)))
   throw new Error('父容器不允许转换为行内公式段落。');
  const transaction=ready(editor.state.tr.replaceWith(pos,pos+node.nodeSize,replacement));
  transaction.setSelection(NodeSelection.create(transaction.doc,pos+1));
  return {transaction,pos:pos+1};
 }
 const parent=resolved.parent;
 if(!parent.isTextblock||resolved.depth===0)throw new Error('只有正文段落中的行内公式可以转换为块级公式。');
 const grandparent=resolved.node(resolved.depth-1),parentIndex=resolved.index(resolved.depth-1);
 const parentPos=resolved.before(resolved.depth),offset=resolved.parentOffset;
 const before=parent.content.cut(0,offset),after=parent.content.cut(offset+node.nodeSize);
 const pieces:ProseMirrorNode[]=[];
 const hasIdentity=Boolean(parent.attrs.id||parent.attrs.blockId);
 if(before.size||(!after.size&&hasIdentity))pieces.push(parent.copy(before));
 const math=schema.nodes.blockMath!.create({latex,equationId:null});
 const mathPos=parentPos+pieces.reduce((size,piece)=>size+piece.nodeSize,0);
 pieces.push(math);
 if(after.size){
  const attrs={...parent.attrs};
  if(pieces.length>1){for(const key of ['id','blockId'])if(key in attrs)attrs[key]=null;}
  pieces.push(parent.type.create(attrs,after,parent.marks));
 }
 const replacement=Fragment.fromArray(pieces);
 if(!grandparent.canReplace(parentIndex,parentIndex+1,replacement))
  throw new Error('父容器的正文结构不允许拆分为块级公式；请在普通段落中转换。');
 const transaction=ready(editor.state.tr.replaceWith(parentPos,parentPos+parent.nodeSize,replacement));
 transaction.setSelection(NodeSelection.create(transaction.doc,mathPos));
 return {transaction,pos:mathPos};
}
