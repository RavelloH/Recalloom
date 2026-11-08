import React,{Suspense} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {WikiInline,WikiEmbed} from '../wiki-components';

/** Render only already-validated RMD Wiki AST nodes. The source parser and
 * serializer live in rmd-lexer/rmd-visual/rmd-serialize respectively.
 */
const DeferredPreview=React.lazy(()=>import('../markdown-preview'));
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
 addNodeView(){return ReactNodeViewRenderer(WikiLinkView);}
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
 addNodeView(){return ReactNodeViewRenderer(WikiEmbedView);}
});
