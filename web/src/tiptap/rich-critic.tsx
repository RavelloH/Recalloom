import React from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {NodeViewContent,ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {MessageSquareText,ArrowRight,Check,X} from 'lucide-react';
import {resolveCriticSuggestion} from '../critic-review';
import type {CriticKind} from '../critic-syntax';

const titles:Record<CriticKind,string>={
 addition:'建议新增',deletion:'建议删除',substitution:'建议替换',
 comment:'审阅批注',highlight:'审阅重点'
};
const isCriticKind=(value:unknown):value is CriticKind=>typeof value==='string'&&Object.hasOwn(titles,value);
export const criticName=(kind:CriticKind)=>titles[kind];

/** Read-only React Markdown rendering, shared stylistically with Tiptap. */
export function CriticDisplay({kind,text,before}:{kind:CriticKind;text:string;before?:string}){
 return <span data-rk-critic={kind} className={'rk-critic rk-critic-'+kind} title={titles[kind]}>
  {kind==='substitution'&&<><del className="rk-critic-before">{before}</del><ArrowRight size={12} aria-hidden="true"/></>}
  {kind==='comment'&&<MessageSquareText size={12} aria-hidden="true"/>}
  {kind==='addition'&&<span className="rk-critic-indicator" aria-hidden="true">+</span>}
  {kind==='deletion'&&<span className="rk-critic-indicator" aria-hidden="true">−</span>}
  <span className="rk-critic-content">{text}</span>
 </span>;
}
/** Keep suggestions editable until the user explicitly accepts/rejects them.
 * Decisions are ordinary ProseMirror transactions, so the existing revision,
 * undo and CAS save mechanisms remain the only authoritative write path.
 */
function CriticEditorView({node,editor,getPos}:NodeViewProps){
 const kind=isCriticKind(node.attrs.kind)?node.attrs.kind:'comment';
 const before=String(node.attrs.before??'');
 const decide=(choice:'accept'|'reject'|'resolve')=>{
  const from=typeof getPos==='function'?getPos():undefined;
  if(typeof from!=='number')return;
  const result=resolveCriticSuggestion(kind,node.textContent,before,choice);
  if(!result)return;
  const range={from,to:from+node.nodeSize};
  if(!result.text){editor.chain().focus().deleteRange(range).run();return;}
  const replacement={type:'text',text:result.text,...(result.highlight?{marks:[{type:'highlight'}]}:{})};
  editor.chain().focus().insertContentAt(range,replacement).run();
 };
 return <NodeViewWrapper as="span" data-rk-critic={kind} className={'rk-critic rk-critic-'+kind} title={titles[kind]}>
  {kind==='substitution'&&<span contentEditable={false} className="rk-critic-before-wrapper">
   <del className="rk-critic-before">{before}</del><ArrowRight size={12} aria-hidden="true"/>
  </span>}
  {kind==='comment'&&<span contentEditable={false} aria-label="审阅批注"><MessageSquareText size={12} aria-hidden="true"/></span>}
  {(kind==='addition'||kind==='deletion')&&<span className="rk-critic-indicator" contentEditable={false} aria-hidden="true">{kind==='addition'?'+':'−'}</span>}
  <NodeViewContent as={"span" as "div"} className="rk-critic-content"/>
  <span className="rk-critic-actions" contentEditable={false}>
   {kind!=='comment'?<>
    <button type="button" className="rk-critic-accept" aria-label={'接受'+titles[kind]} title="接受建议"
      onMouseDown={event=>event.preventDefault()} onClick={event=>{event.preventDefault();event.stopPropagation();decide('accept');}}><Check size={13}/></button>
    <button type="button" className="rk-critic-reject" aria-label={'拒绝'+titles[kind]} title="拒绝建议"
      onMouseDown={event=>event.preventDefault()} onClick={event=>{event.preventDefault();event.stopPropagation();decide('reject');}}><X size={13}/></button>
   </>:<button type="button" aria-label="解决审阅批注" title="解决批注并移除批注标记"
      onMouseDown={event=>event.preventDefault()} onClick={event=>{event.preventDefault();event.stopPropagation();decide('resolve');}}><Check size={13}/></button>}
  </span>
 </NodeViewWrapper>;
}
export const RichCritic=Node.create({
 name:'richCritic',group:'inline',inline:true,content:'text*',
 priority:2100,defining:true,
 addAttributes(){return {kind:{default:'comment'},before:{default:''}};},
 parseHTML(){return [{tag:'span[data-rk-critic]'}];},
 renderHTML({HTMLAttributes}){
  const kind=isCriticKind(HTMLAttributes.kind)?HTMLAttributes.kind:'comment';
  return ['span',mergeAttributes(HTMLAttributes,{'data-rk-critic':kind}),0];
 },
 addNodeView(){return ReactNodeViewRenderer(CriticEditorView);}
});
