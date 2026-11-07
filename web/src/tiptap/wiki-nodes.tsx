import React,{Suspense} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {parseWikiTarget} from '../../../src/wiki-syntax.js';
import {WikiInline,WikiEmbed} from '../wiki-components';

type WikiToken={raw?:string;target?:string;anchor?:string|null;alias?:string|null};
const DeferredPreview=React.lazy(()=>import('../markdown-preview'));
const rawToken=(target:string,anchor?:string|null,alias?:string|null)=>
 target+(anchor?'#'+anchor:'')+(alias?'|'+alias:'');
const WikiLinkView=({node,extension}:NodeViewProps)=>{
 const attrs=node.attrs as {target:string;anchor?:string|null;alias?:string|null};
 const sourceId=(extension.options as {sourceId?:string}).sourceId;
 return <NodeViewWrapper as="span" className="wiki-editor-chip" contentEditable={false}>
  <WikiInline target={attrs.target} anchor={attrs.anchor} alias={attrs.alias} sourceId={sourceId}/>
 </NodeViewWrapper>;
};
const WikiEmbedView=({node,extension}:NodeViewProps)=>{
 const attrs=node.attrs as {target:string;anchor?:string|null};
 const sourceId=(extension.options as {sourceId?:string}).sourceId;
 return <NodeViewWrapper className="wiki-editor-embed" contentEditable={false}>
  <WikiEmbed target={attrs.target} anchor={attrs.anchor} sourceId={sourceId}
   trail={sourceId?[sourceId]:[]}
   render={(content,id,trail,depth)=><Suspense fallback={<span>正在准备嵌入内容…</span>}>
    <DeferredPreview content={content} sourceId={id} trail={trail} depth={depth}/>
   </Suspense>}/>
 </NodeViewWrapper>;
};
export const WikiLinkNode=Node.create({
 name:'wikiLink',
 group:'inline',
 inline:true,
 atom:true,
 selectable:true,
 priority:1200,
 addOptions(){return {sourceId:undefined as string|undefined};},
 addAttributes(){return {target:{default:''},anchor:{default:null},alias:{default:null}};},
 parseHTML(){return [{tag:'span[data-wiki-link]'}];},
 renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-wiki-link':''})];},
 addNodeView(){return ReactNodeViewRenderer(WikiLinkView);},
 parseMarkdown(token:WikiToken){
  return {type:'wikiLink',attrs:{target:token.target,anchor:token.anchor??null,alias:token.alias??null}};
 },
 renderMarkdown(node){
  const attrs=node.attrs as {target:string;anchor?:string|null;alias?:string|null};
  return '[['+rawToken(attrs.target,attrs.anchor,attrs.alias)+']]';
 },
 markdownTokenizer:{
  name:'wikiLink',
  level:'inline' as const,
  start:(source:string)=>source.indexOf('[['),
  tokenize:(source:string)=>{
   const m=/^\[\[([^\]\r\n]{1,2048})\]\]/.exec(source);
   if(!m)return undefined;
   const info=parseWikiTarget(m[1]??'');
   if(!info)return undefined;
   return {type:'wikiLink',raw:m[0],text:m[0],...info};
  }
 }
});
export const WikiEmbedNode=Node.create({
 name:'wikiEmbed',
 group:'block',
 atom:true,
 selectable:true,
 isolating:true,
 // Must follow paragraph in the schema's block order: otherwise ProseMirror
 // inserts an empty wikiEmbed as the default filler at the end of documents.
 priority:75,
 addOptions(){return {sourceId:undefined as string|undefined};},
 addAttributes(){return {target:{default:''},anchor:{default:null}};},
 parseHTML(){return [{tag:'div[data-wiki-embed]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-wiki-embed':''})];},
 addNodeView(){return ReactNodeViewRenderer(WikiEmbedView);},
 parseMarkdown(token:WikiToken){
  return {type:'wikiEmbed',attrs:{target:token.target,anchor:token.anchor??null}};
 },
 renderMarkdown(node){
  const attrs=node.attrs as {target:string;anchor?:string|null};
  return '{{embed:'+rawToken(attrs.target,attrs.anchor)+'}}';
 },
 markdownTokenizer:{
  name:'wikiEmbed',
  level:'block' as const,
  start:(source:string)=>source.indexOf('{{embed:'),
  tokenize:(source:string)=>{
   const m=/^\{\{embed:([^}\r\n]{1,2048})\}\}(?=\s*(?:\n|$))/.exec(source);
   if(!m)return undefined;
   const info=parseWikiTarget(m[1]??'',false);
   if(!info)return undefined;
   return {type:'wikiEmbed',raw:m[0],text:m[0],target:info.target,anchor:info.anchor};
  }
 }
});
