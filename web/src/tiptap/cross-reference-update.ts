import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import type {Transaction} from '@tiptap/pm/state';
import {isRmdId} from '../rmd-schema';

/** Only changes to a definition can change the document's cross-reference
 * labels or sequential figure/equation/table numbering. Reading the changed
 * ranges in the old and new trees avoids serializing the entire document for
 * an ordinary keystroke. Complex transactions deliberately fall back to a
 * complete refresh.
 */
function containsDefinition(doc:ProseMirrorNode,from:number,to:number):boolean{
 const start=Math.max(0,Math.min(doc.content.size,from-1));
 const end=Math.min(doc.content.size,Math.max(start+1,to+1));
 let found=false;
 doc.nodesBetween(start,end,node=>{
  const a=node.attrs;
  const id=node.type.name==='heading'?a.id:
   node.type.name==='paragraph'?a.blockId:
   node.type.name==='codeBlock'?a.id:
   node.type.name==='blockMath'?a.equationId:
   node.type.name==='table'?a.tableId:
   node.type.name==='image'?a.figureId:null;
  if(typeof id==='string'&&isRmdId(id)){found=true;return false;}
  return !found;
 });
 return found;
}

export function crossReferencesMayChange(tr:Transaction):boolean{
 if(!tr.docChanged)return false;
 // The positions in consecutive step maps belong to intermediate documents.
 // A full refresh is safer than trying to combine them without step snapshots.
 if(tr.mapping.maps.length!==1)return true;
 let hasChangedRange=false;
 let affected=false;
 tr.mapping.maps[0]!.forEach((oldStart,oldEnd,newStart,newEnd)=>{
  hasChangedRange=true;
  if(containsDefinition(tr.before,oldStart,oldEnd)||containsDefinition(tr.doc,newStart,newEnd))affected=true;
 });
 return !hasChangedRange||affected;
}
