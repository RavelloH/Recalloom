import React from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewContent,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {Card} from '@astryxdesign/core/Card';
import {Footprints} from 'lucide-react';

import {safeFootnoteId} from './rich-footnote-utils';
function FootnoteRefView({node}:NodeViewProps){
 const id=safeFootnoteId(String(node.attrs.id??''));
 return <NodeViewWrapper as="span" contentEditable={false} className="rk-footnote-ref" data-rk-footnote-ref={id}>
  <sup title={'脚注：'+id}>[{id}]</sup>
 </NodeViewWrapper>;
}
export const RichFootnoteRef=Node.create({
 name:'richFootnoteRef',group:'inline',inline:true,atom:true,selectable:true,priority:600,
 addAttributes(){return {id:{default:''}};},
 parseHTML(){return [{tag:'span[data-rk-footnote-ref]'}];},
 renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-rk-footnote-ref':HTMLAttributes.id})];},
 addNodeView(){return ReactNodeViewRenderer(FootnoteRefView);}
});
function FootnoteDefView({node}:NodeViewProps){
 const id=safeFootnoteId(String(node.attrs.id??''));
 return <NodeViewWrapper className="rk-footnote-definition" data-rk-footnote-definition={id}>
  <Card variant="muted" padding={3}>
   <div className="rk-footnote-definition-title" contentEditable={false}><Footprints size={15} aria-hidden="true"/> 脚注 [{id}]</div>
   <NodeViewContent className="rk-footnote-definition-content"/>
  </Card>
 </NodeViewWrapper>;
}
export const RichFootnoteDefinition=Node.create({
 name:'richFootnoteDefinition',group:'block',content:'block+',defining:true,isolating:true,
 addAttributes(){return {id:{default:''}};},
 parseHTML(){return [{tag:'div[data-rk-footnote-definition]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-rk-footnote-definition':HTMLAttributes.id}),0];},
 addNodeView(){return ReactNodeViewRenderer(FootnoteDefView);}
});
