/** Transaction-only operations for whole top-level document blocks.
 * Reuse these from grip handle, keyboard actions and context menus. Nested
 * containers deliberately are NOT movable with this top-level protocol.
 */
import type {Editor,JSONContent} from '@tiptap/core';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';

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
/** Direction supports keyboard and drop movement without unsafe node cuts. */
export function moveBlockTo(editor:Editor,sourcePos:number,targetPos:number,after=false):boolean{
 const source=topLevelBlockAt(editor,sourcePos),target=topLevelBlockAt(editor,targetPos);
 if(!source||!target||source.pos===target.pos)return false;
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
 const blocks=topLevelBlocks(editor),index=blocks.findIndex(x=>x.pos===pos);
 if(index<0||index+step<0||index+step>=blocks.length)return false;
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
 const source=topLevelBlockAt(editor,pos);
 if(!source)return false;
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
 const source=topLevelBlockAt(editor,pos);
 if(!source)return false;
 const tr=editor.state.tr;
 if(editor.state.doc.childCount===1){
  const paragraph=editor.state.schema.nodes.paragraph?.create();
  if(!paragraph)return false;
  tr.replaceWith(pos,pos+source.node.nodeSize,paragraph);
 }else tr.delete(pos,pos+source.node.nodeSize);
 try{tr.doc.check();}catch{return false;}
 editor.view.dispatch(tr.scrollIntoView());
 return true;
}
