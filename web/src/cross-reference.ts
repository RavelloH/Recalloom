import type {JSONContent} from '@tiptap/core';
import {isRmdId} from './rmd-schema';

/** RMD source-derived local anchors. Figure/equation/table counters are
 * ephemeral; heading/paragraph/code IDs are linkable but never numbered.
 * No content, revision or relation database writes are required.
 */
export type NumberedRefKind='fig'|'eq'|'tbl';
export type CrossRefKind=NumberedRefKind|'heading'|'paragraph'|'code';
export type CrossRefInfo={id:string;kind:CrossRefKind;number?:number;label:string};
export type CrossRefIndex=ReadonlyMap<string,CrossRefInfo>;
const prefix:Record<NumberedRefKind,string>={fig:'图',eq:'公式',tbl:'表'};
export function crossRefKind(value:unknown):NumberedRefKind|null{
 if(typeof value!=='string'||!isRmdId(value))return null;
 return (/^(fig|eq|tbl)-[a-z][a-z0-9-]*$/.exec(value)?.[1] as NumberedRefKind|undefined)??null;
}
export function validCrossRefId(value:unknown,kind?:NumberedRefKind):value is string{
 const found=crossRefKind(value);
 return found!==null&&(!kind||found===kind);
}
const visibleText=(node:JSONContent):string=>(node.text??'')+
 (node.content??[]).map(visibleText).join('');
const excerpt=(text:string)=>text.replace(/\s+/g,' ').trim().slice(0,64);
const stable=(value:unknown)=>typeof value==='string'&&isRmdId(value)?value.toLowerCase():null;

/** Produce one shared index from the editor's semantic AST (or the same AST
 * parsed for read-only preview). First valid definition wins on duplicate
 * IDs; only unique numbered definitions increment the counter.
 */
export function collectCrossRefs(doc:JSONContent):CrossRefIndex{
 const counters:Record<NumberedRefKind,number>={fig:0,eq:0,tbl:0};
 const index=new Map<string,CrossRefInfo>();
 const walk=(node:JSONContent)=>{
  const a=node.attrs??{};
  const id=stable(node.type==='image'?a.figureId:
   node.type==='blockMath'?a.equationId:
   node.type==='table'?a.tableId:
   node.type==='heading'?a.id:
   node.type==='paragraph'?a.blockId:
   node.type==='codeBlock'?a.id:null);
  if(id&&!index.has(id)){
   if(node.type==='heading')index.set(id,{
    id,kind:'heading',label:'章节：'+(excerpt(visibleText(node))||id)
   });
   else if(node.type==='paragraph')index.set(id,{
    id,kind:'paragraph',label:'段落：'+(excerpt(visibleText(node))||id)
   });
   else if(node.type==='codeBlock')index.set(id,{
    id,kind:'code',label:'代码：'+(excerpt(String(a.filename||a.language||''))||id)
   });
   else {
    const kind=crossRefKind(id);
    if(kind){
     const number=++counters[kind];
     index.set(id,{id,kind,number,label:prefix[kind]+' '+number});
    }
   }
  }
  for(const child of node.content??[])walk(child);
 };
 walk(doc);
 return index;
}
export function resolveCrossRef(index:CrossRefIndex,id:string):CrossRefInfo|null{
 return index.get(id.toLowerCase())??null;
}
