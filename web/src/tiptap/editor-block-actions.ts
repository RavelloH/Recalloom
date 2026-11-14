/** Transaction-only actions for top-level and legally nested RMD blocks. */
import type {Editor,JSONContent} from '@tiptap/core';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import type {Transaction} from '@tiptap/pm/state';
import {isHistoryTransaction} from '@tiptap/pm/history';

export type TopLevelBlock={pos:number;index:number;node:ProseMirrorNode};
export function topLevelBlocks(editor:Editor):TopLevelBlock[]{
 const list:TopLevelBlock[]=[];
 editor.state.doc.forEach((node,pos,index)=>list.push({node,pos,index}));
 return list;
}
export function topLevelBlockAt(editor:Editor,pos:number):TopLevelBlock|null{
 return topLevelBlocks(editor).find(x=>x.pos===pos)??null;
}
export function topLevelAtDocumentPosition(editor:Editor,pos:number):TopLevelBlock|null{
 const blocks=topLevelBlocks(editor);
 return blocks.find(x=>x.pos===pos)??blocks.find(x=>pos>x.pos&&pos<x.pos+x.node.nodeSize)??null;
}
/** Structural RMD children cannot be detached from their legal parent.
 * Flashcard front/back are inspectable, but not reorderable or duplicable.
 */
const childParents:Readonly<Record<string,string>>={
 message:'chat',tab:'tabs',definition:'glossary',front:'flashcard',back:'flashcard'
};
const repeatableChildKinds=new Set(['message','tab','definition']);
export type EditableBlock=TopLevelBlock&{parentPos:number|null;parentKind:string|null};
export function editableBlockAt(editor:Editor,pos:number):EditableBlock|null{
 const top=topLevelBlockAt(editor,pos);
 if(top)return {...top,parentPos:null,parentKind:null};
 if(pos<0||pos>editor.state.doc.content.size)return null;
 const node=editor.state.doc.nodeAt(pos);
 if(!node||node.type.name!=='richContainer')return null;
 const kind=String(node.attrs.kind??''),parentKind=childParents[kind];
 if(!parentKind)return null;
 const resolved=editor.state.doc.resolve(pos),parent=resolved.parent;
 if(parent.type.name!=='richContainer'||parent.attrs.kind!==parentKind)return null;
 const index=resolved.index();
 if(parent.child(index)!==node)return null;
 return {pos,node,index,parentKind,parentPos:resolved.before(resolved.depth)};
}
/** Inspect an exact node without granting structural move/delete capabilities. */
export function blockEditorTargetAt(editor:Editor,pos:number):EditableBlock|null{
 const structural=editableBlockAt(editor,pos);
 if(structural)return structural;
 if(pos<0||pos>=editor.state.doc.content.size)return null;
 const node=editor.state.doc.nodeAt(pos);
 if(!node||(!node.isBlock&&node.type.name!=='inlineMath'))return null;
 const resolved=editor.state.doc.resolve(pos);
 return {pos,node,index:resolved.index(),parentPos:null,parentKind:null};
}
/** Follow an inspected node through edits, including whole-node undo/redo. */
export function mapBlockEditorTarget(editor:Editor,transaction:Transaction,pos:number,previous:ProseMirrorNode):EditableBlock|null{
 const fromPanel=transaction.getMeta('rk-block-panel-edit')===true;
 const mapped=transaction.mapping.mapResult(pos,fromPanel?-1:1);
 let targetPos=mapped.pos;
 if(!fromPanel&&mapped.deleted){
  const start=transaction.mapping.map(pos,-1),end=transaction.mapping.map(pos+previous.nodeSize,-1);
  const replacement=editor.state.doc.nodeAt(start);
  // A genuine deletion collapses the extent. Only recover a complete
  // replacement, so the next sibling cannot silently become the target.
  if(end<=start||replacement?.nodeSize!==end-start)return null;
  // Native NodeView updateAttributes calls setNodeMarkup without panel metadata.
  // For leaf atoms PM implements that as a plain ReplaceStep. Retain an
  // attribute-only edit, but reject external replacement of the block body.
  const markupOnly=replacement.type===previous.type&&replacement.content.eq(previous.content)&&
   replacement.marks.length===previous.marks.length&&replacement.marks.every((mark,index)=>mark.eq(previous.marks[index]!));
  if(!isHistoryTransaction(transaction)&&!markupOnly)return null;
  targetPos=start;
 }
 const current=blockEditorTargetAt(editor,targetPos);
 if(!current||current.node.type!==previous.type||
  current.node.type.name==='richContainer'&&current.node.attrs.kind!==previous.attrs.kind)return null;
 return current;
}
export function editableBlockFromDocumentPosition(editor:Editor,pos:number):EditableBlock|null{
 const doc=editor.state.doc;
 if(pos<0||pos>doc.content.size)return null;
 const resolved=doc.resolve(pos);
 const direct=editableBlockAt(editor,pos);
 if(direct?.parentKind)return direct;
 for(let depth=resolved.depth;depth>=1;depth--){
  const candidate=editableBlockAt(editor,resolved.before(depth));
  if(candidate?.parentKind)return candidate;
 }
 const top=topLevelAtDocumentPosition(editor,pos);
 return top?{...top,parentPos:null,parentKind:null}:null;
}
export function blockSiblings(editor:Editor,pos:number):EditableBlock[]{
 const current=editableBlockAt(editor,pos);
 if(!current)return [];
 if(current.parentPos===null)return topLevelBlocks(editor).map(item=>({...item,parentPos:null,parentKind:null}));
 const parent=editor.state.doc.nodeAt(current.parentPos);
 if(!parent)return [];
 const siblings:EditableBlock[]=[];
 parent.forEach((node,offset,index)=>{
  if(node.type.name==='richContainer'&&String(node.attrs.kind)===String(current.node.attrs.kind))
   siblings.push({node,pos:current.parentPos!+1+offset,index,parentPos:current.parentPos,parentKind:current.parentKind});
 });
 return siblings;
}
/** Only explicit ::: RMD blocks expose a floating handle. Plain paragraphs,
 * headings, lists, tables and fenced code keep native text editing only. */
export function isExplicitRmdBlock(editor:Editor,pos:number):boolean{
 const node=editableBlockAt(editor,pos)?.node;
 return !!node&&['richContainer','richLinkCard','wikiEmbed'].includes(node.type.name);
}
export function blockCanReorder(editor:Editor,pos:number):boolean{
 const current=editableBlockAt(editor,pos);
 return !!current&&(current.parentPos===null||repeatableChildKinds.has(String(current.node.attrs.kind)));
}
export function blockCanDuplicate(editor:Editor,pos:number):boolean{return blockCanReorder(editor,pos);}
export function blockCanDelete(editor:Editor,pos:number):boolean{
 const current=editableBlockAt(editor,pos);
 return !!current&&(current.parentPos===null||
  repeatableChildKinds.has(String(current.node.attrs.kind))&&blockSiblings(editor,pos).length>1);
}
/** Direction supports keyboard and drop movement without unsafe node cuts. */
export function moveBlockTo(editor:Editor,sourcePos:number,targetPos:number,after=false):boolean{
 const source=editableBlockAt(editor,sourcePos),target=editableBlockAt(editor,targetPos);
 if(!source||!target||source.pos===target.pos)return false;
 if(!blockCanReorder(editor,sourcePos)||source.parentPos!==target.parentPos)return false;
 if(source.parentPos!==null&&String(source.node.attrs.kind)!==String(target.node.attrs.kind))return false;
 const document=editor.state.doc;
 const insertPos=after?target.pos+target.node.nodeSize:target.pos;
 // A top-level node can only move to a legal sibling position. Do not cross
 // nested containers or create schema-invalid placements.
 const tr=editor.state.tr;
 tr.delete(source.pos,source.pos+source.node.nodeSize);
 const mapped=tr.mapping.map(insertPos);
 try{
  tr.insert(mapped,source.node);
  tr.doc.check();
 }catch{return false;}
 if(tr.doc.eq(document))return false;
 editor.view.dispatch(tr.scrollIntoView());
 return true;
}
export function moveBlockBy(editor:Editor,pos:number,step:-1|1):boolean{
 const blocks=blockSiblings(editor,pos),index=blocks.findIndex(x=>x.pos===pos);
 if(!blockCanReorder(editor,pos)||index<0||index+step<0||index+step>=blocks.length)return false;
 return moveBlockTo(editor,pos,blocks[index+step]!.pos,step===1);
}
const stableIds=['id','blockId','figureId','equationId','tableId'];
/** Duplicate content, but never duplicate stable cross-reference anchors. */
export function withoutBlockIdentity(json:JSONContent):JSONContent{
 const attrs=json.attrs?{...json.attrs}:undefined;
 if(attrs)for(const key of stableIds)if(key in attrs)attrs[key]=null;
 return {...json,...(attrs?{attrs}:{}),
  ...(json.content?{content:json.content.map(withoutBlockIdentity)}:{})};
}
export function duplicateBlock(editor:Editor,pos:number):boolean{
 const source=editableBlockAt(editor,pos);
 if(!source||!blockCanDuplicate(editor,pos))return false;
 const json=withoutBlockIdentity(source.node.toJSON());
 try{
  const node=editor.state.schema.nodeFromJSON(json);
  const tr=editor.state.tr.insert(pos+source.node.nodeSize,node);
  tr.doc.check();
  editor.view.dispatch(tr.scrollIntoView());
  return true;
 }catch{return false;}
}
export function removeBlock(editor:Editor,pos:number):boolean{
 const source=editableBlockAt(editor,pos);
 if(!source||!blockCanDelete(editor,pos))return false;
 const tr=editor.state.tr;
 if(source.parentPos===null&&editor.state.doc.childCount===1){
  const paragraph=editor.state.schema.nodes.paragraph?.create();
  if(!paragraph)return false;
  tr.replaceWith(pos,pos+source.node.nodeSize,paragraph);
 }else tr.delete(pos,pos+source.node.nodeSize);
 try{tr.doc.check();}catch{return false;}
 editor.view.dispatch(tr.scrollIntoView());
 return true;
}
