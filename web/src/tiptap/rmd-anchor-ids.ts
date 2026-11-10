import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {getRmdSchema} from '../rmd-schema';
import {rmdAttrNodeMapping,rmdAttributeDefinition} from './rmd-schema-attrs-model';

export type RmdAnchorEntry={id:string;label:string;pos:number};
export type RmdAnchorConflict=RmdAnchorEntry&{source:'document'|'candidate'};
export type RmdAnchorExclusion={pos:number;nodeSize:number};

const nodeLabels:Readonly<Record<string,string>>={
 heading:'标题',paragraph:'段落',math:'块级公式',table:'表格',codeBlock:'代码块',image:'图片'
};
function anchorEntry(node:ProseMirrorNode,pos:number):RmdAnchorEntry|null{
 let raw:unknown,label:string;
 if(node.type.name==='richContainer'){
  const kind=String(node.attrs.kind??'');
  const schema=getRmdSchema('block',kind);
  if(!schema||!('id' in schema.attributes))return null;
  raw=node.attrs.id;label=kind+' 容器';
 }else{
  const mapped=Object.entries(rmdAttrNodeMapping).find(([type,value])=>type===node.type.name||value.node===node.type.name);
  if(!mapped)return null;
  const [,mapping]=mapped;
  const definition=rmdAttributeDefinition(mapped[0]);
  if(!definition||!('id' in definition.attributes))return null;
  raw=node.attrs[mapping.id];label=nodeLabels[node.type.name]??node.type.name;
 }
 if(typeof raw!=='string'||!raw.trim())return null;
 return {id:raw.trim().toLowerCase(),label,pos};
}
function entriesIn(node:ProseMirrorNode,includeRoot:boolean):RmdAnchorEntry[]{
 const entries:RmdAnchorEntry[]=[];
 if(includeRoot){const root=anchorEntry(node,0);if(root)entries.push(root);}
 node.descendants((child,pos)=>{const entry=anchorEntry(child,pos);if(entry)entries.push(entry);});
 return entries;
}

/** Finds a case-insensitive stable-anchor collision anywhere in the document.
 * Exclusions are node ranges, so editing a nested block ignores its own subtree.
 */
export function findRmdAnchorConflict(
 doc:ProseMirrorNode,rawId:string,exclude?:RmdAnchorExclusion
):RmdAnchorEntry|null{
 const id=rawId.trim().toLowerCase();
 if(!id)return null;
 let conflict:RmdAnchorEntry|null=null;
 doc.descendants((node,pos)=>{
  if(exclude&&pos>=exclude.pos&&pos<exclude.pos+exclude.nodeSize)return false;
  const entry=anchorEntry(node,pos);
  if(entry?.id===id){conflict=entry;return false;}
  return true;
 });
 return conflict;
}

/** Checks new/changed IDs in a candidate block before raw-source replacement.
 * Existing collisions elsewhere in an untouched legacy block do not prevent
 * editing unrelated content; only newly introduced duplicate occurrences fail.
 */
export function findRmdAnchorConflictForNode(
 doc:ProseMirrorNode,candidate:ProseMirrorNode,excludePos:number
):RmdAnchorConflict|null{
 const existing=doc.nodeAt(excludePos);
 const exclusion=existing?{pos:excludePos,nodeSize:existing.nodeSize}:undefined;
 const original=existing?entriesIn(existing,true):[];
 const next=entriesIn(candidate,true);
 const originalCounts=new Map<string,number>();
 const nextCounts=new Map<string,number>();
 for(const entry of original)originalCounts.set(entry.id,(originalCounts.get(entry.id)??0)+1);
 for(const entry of next)nextCounts.set(entry.id,(nextCounts.get(entry.id)??0)+1);
 for(const [id,count] of nextCounts){
  if(count<=(originalCounts.get(id)??0))continue;
  if(count>1){
   const entry=next.find(item=>item.id===id)!;
   return {...entry,source:'candidate'};
  }
  const external=findRmdAnchorConflict(doc,id,exclusion);
  if(external)return {...external,source:'document'};
 }
 return null;
}
export function describeRmdAnchorConflict(conflict:RmdAnchorConflict|RmdAnchorEntry,id=conflict.id):string{
 if('source'in conflict&&conflict.source==='candidate')
  return '锚点 ID「'+id+'」在当前块内容中重复，请为每个可引用块设置唯一 ID。';
 return '锚点 ID「'+id+'」已被当前文档中的「'+conflict.label+'」使用，请选择唯一 ID。';
}
