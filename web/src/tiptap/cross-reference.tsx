import {useMemo,useSyncExternalStore} from 'react';
import type {Editor} from '@tiptap/core';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {headingAnchor} from '../wiki-slug';
import {collectCrossRefs,crossRefToken,crossRefTokenStart,resolveCrossRef,validCrossRefId,type CrossRefIndex} from '../cross-reference';

type Store={subscribe:(listener:()=>void)=>()=>void;getSnapshot:()=>CrossRefIndex};
const registries=new WeakMap<Editor,Store>();
function createRegistry(editor:Editor):Store{
 const callbacks=new Set<()=>void>();
 let snapshot=collectCrossRefs(editor.state.doc.toJSON());
 let signature=[...snapshot.values()].map(x=>x.id+':'+x.label).join('|');
 const update=({transaction}:{transaction:{docChanged:boolean}})=>{
  if(!transaction.docChanged)return;
  const next=collectCrossRefs(editor.state.doc.toJSON());
  const nextSignature=[...next.values()].map(x=>x.id+':'+x.label).join('|');
  if(nextSignature===signature)return;
  signature=nextSignature;
  snapshot=next;
  callbacks.forEach(cb=>cb());
 };
 editor.on('transaction',update);
 editor.on('destroy',()=>{editor.off('transaction',update);callbacks.clear();registries.delete(editor);});
 return {
  subscribe(listener){callbacks.add(listener);return()=>callbacks.delete(listener);},
  getSnapshot(){return snapshot;}
 };
}
export function useReferenceIndex(editor:Editor):CrossRefIndex{
 const store=useMemo(()=>{
  let existing=registries.get(editor);
  if(!existing){existing=createRegistry(editor);registries.set(editor,existing);}
  return existing;
 },[editor]);
 return useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
}
function CrossReferenceView({node,editor}:NodeViewProps){
 const id=String(node.attrs.target??'');
 const index=useReferenceIndex(editor);
 const resolved=resolveCrossRef(index,id);
 const text=resolved?.label??'引用不存在：'+id;
 const anchor=headingAnchor(id);
 return <NodeViewWrapper as="span" className={'rk-cross-reference'+(resolved?'':' rk-cross-reference-missing')} data-rk-cross-ref={id} contentEditable={false}>
  <a href={'#'+anchor} title={resolved?'跳转至'+text:'缺少对应的标记块：'+id}
   onMouseDown={event=>event.preventDefault()}
   onClick={event=>{event.preventDefault();if(!resolved)return;editor.view.dom.querySelector('#'+anchor)?.scrollIntoView({behavior:'smooth',block:'center'});}}>
   {text}
  </a>
 </NodeViewWrapper>;
}
export const CrossReferenceNode=Node.create({
 name:'crossReference',group:'inline',inline:true,atom:true,selectable:true,priority:1800,
 addAttributes(){return {target:{default:''}};},
 parseHTML(){return [{tag:'span[data-rk-cross-ref]'}];},
 renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-rk-cross-ref':HTMLAttributes.target})];},
 addNodeView(){return ReactNodeViewRenderer(CrossReferenceView);},
 parseMarkdown(token){return {type:'crossReference',attrs:{target:String((token as typeof token&{target?:string}).target??'')}};},
 renderMarkdown(node){const id=String(node.attrs?.target??'');return validCrossRefId(id)?'@'+id:'';},
 markdownTokenizer:{name:'crossReference',level:'inline' as const,start:crossRefTokenStart,tokenize:crossRefToken}
});
