import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {serializeRmdBlock} from '../rmd-serialize';

type SerializeBlock=(block:ProseMirrorNode)=>string;

/** Reuse unchanged top-level blocks while retaining canonical RMD serialization. */
export function createRmdVisualDocumentSerializer(
 serializeBlock:SerializeBlock=(block)=>serializeRmdBlock(block.toJSON())
){
 const blocks=new WeakMap<ProseMirrorNode,string>();
 let lastDocument:ProseMirrorNode|null=null;
 let lastResult='';

 return (document:ProseMirrorNode):string=>{
  if(document===lastDocument)return lastResult;
  const serialized:string[]=[];
  document.forEach(block=>{
   let source=blocks.get(block);
   if(source===undefined){
    source=serializeBlock(block);
    blocks.set(block,source);
   }
   if(source)serialized.push(source);
  });
  lastDocument=document;
  lastResult=serialized.join('\n\n');
  return lastResult;
 };
}
