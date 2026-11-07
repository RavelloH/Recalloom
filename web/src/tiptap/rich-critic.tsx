import React from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import type {JSONContent} from '@tiptap/core';
import {NodeViewContent,ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {MessageSquareText,ArrowRight} from 'lucide-react';
import {criticStartIndex,parseCriticAt,type CriticKind} from '../critic-syntax';

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
/** An inline but non-atomic node: its proposed/current text remains directly
 * editable. In a substitution the old content stays in an attr; changing that
 * side requires Markdown source editing until the review UI is implemented.
 */
function CriticEditorView({node}:NodeViewProps){
 const kind=isCriticKind(node.attrs.kind)?node.attrs.kind:'comment';
 const before=String(node.attrs.before??'');
 return <NodeViewWrapper as="span" data-rk-critic={kind} className={'rk-critic rk-critic-'+kind} title={titles[kind]}>
  {kind==='substitution'&&<span contentEditable={false} className="rk-critic-before-wrapper">
   <del className="rk-critic-before">{before}</del><ArrowRight size={12} aria-hidden="true"/>
  </span>}
  {kind==='comment'&&<span contentEditable={false} aria-label="审阅批注"><MessageSquareText size={12} aria-hidden="true"/></span>}
  {(kind==='addition'||kind==='deletion')&&<span className="rk-critic-indicator" contentEditable={false} aria-hidden="true">{kind==='addition'?'+':'−'}</span>}
  <NodeViewContent as={"span" as "div"} className="rk-critic-content"/>
 </NodeViewWrapper>;
}
type CriticToken={kind?:CriticKind;before?:string;text?:string;tokens?:unknown[]};
export const RichCritic=Node.create({
 name:'richCritic',group:'inline',inline:true,content:'text*',
 priority:2100,defining:true,
 addAttributes(){return {kind:{default:'comment'},before:{default:''}};},
 parseHTML(){return [{tag:'span[data-rk-critic]'}];},
 renderHTML({HTMLAttributes}){
  const kind=isCriticKind(HTMLAttributes.kind)?HTMLAttributes.kind:'comment';
  return ['span',mergeAttributes(HTMLAttributes,{'data-rk-critic':kind}),0];
 },
 addNodeView(){return ReactNodeViewRenderer(CriticEditorView);},
 parseMarkdown(token:CriticToken){
  const kind=isCriticKind(token.kind)?token.kind:'comment';
  return {type:'richCritic',attrs:{kind,before:String(token.before??'')},
   content:token.text?[{type:'text',text:token.text}]:[]};
 },
 renderMarkdown(node:JSONContent,helpers:{renderChildren:(nodes:JSONContent[])=>string}){
  const kind=isCriticKind(node.attrs?.kind)?node.attrs!.kind as CriticKind:'comment';
  const body=helpers.renderChildren(node.content??[]);
  switch(kind){
   case 'addition':return '{++'+body+'++}';
   case 'deletion':return '{--'+body+'--}';
   case 'substitution':return '{~~'+String(node.attrs?.before??'')+'~>'+body+'~~}';
   case 'comment':return '{>>'+body+'<<}';
   case 'highlight':return '{=='+body+'==}';
  }
 },
 markdownTokenizer:{
  name:'richCritic',level:'inline' as const,
  start:criticStartIndex,
  tokenize:(source:string):{type:string;raw:string;text:string;kind:CriticKind;before:string}|undefined=>{
   const match=parseCriticAt(source);
   if(!match)return;
   return {type:'richCritic',...match};
  }
 }
});
