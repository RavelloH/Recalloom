import {BlockMath} from '@tiptap/extension-mathematics';
import type {JSONContent} from '@tiptap/core';
import {validCrossRefId} from '../cross-reference';
import {headingAnchor} from '../wiki-slug';

/** Highlight is a block attribute, not a text mark: display math is an atomic
 * ProseMirror block node, and a <mark> wrapping $$ lines isn't regular Markdown.
 * Preserve the explicit wrapper on save, and render one yellow background around
 * the KaTeX element's actual dimensions. */
export const BlockMathWithHighlight=BlockMath.extend({
 addAttributes(){
  return {
   ...this.parent?.(),
   equationId:{
    default:null,
    parseHTML:(el:HTMLElement)=>el.getAttribute('data-rk-equation-id')||null,
    renderHTML:(attrs:Record<string,unknown>)=>validCrossRefId(attrs.equationId,'eq')?{'data-rk-equation-id':attrs.equationId}:{}
   },
   highlighted:{
    default:false,
    parseHTML:(el:HTMLElement)=>el.getAttribute('data-highlighted')==='true',
    renderHTML:(attrs:Record<string,unknown>)=>attrs.highlighted?{'data-highlighted':'true'}:{},
   },
  };
 },
 addNodeView(){
  const renderParent=this.parent?.();
  return (props)=>{
   if(!renderParent)throw new Error('BlockMath node view unavailable');
   const view=renderParent(props);
   const apply=(node:typeof props.node)=>{
    if(!(view.dom instanceof HTMLElement))return;
    view.dom.classList.toggle('rk-highlighted-block-math',Boolean(node.attrs.highlighted));
    const id=node.attrs.equationId;
    if(validCrossRefId(id,'eq')){view.dom.id=headingAnchor(id);view.dom.setAttribute('data-rk-equation-id',id);}
    else{view.dom.removeAttribute('id');view.dom.removeAttribute('data-rk-equation-id');}
   };
   apply(props.node);
   const parentUpdate=view.update?.bind(view);
   if(parentUpdate)view.update=(node,decs,inner)=>{
    const accepted=parentUpdate(node,decs,inner);
    if(accepted)apply(node);
    return accepted;
   };
   return view;
  };
 },
 renderMarkdown(node:JSONContent){
  const latex=String(node.attrs?.latex??'');
  const id=validCrossRefId(node.attrs?.equationId,'eq')?node.attrs!.equationId as string:null;
  const body='$$\n'+latex+'\n$$'+(id?' {#'+id+'}':'');
  return node.attrs?.highlighted?'<mark>\n'+body+'\n</mark>':body;
 },
});
