import {BlockMath} from '@tiptap/extension-mathematics';
import type {JSONContent} from '@tiptap/core';

/** Highlight is a block attribute, not a text mark: display math is an atomic
 * ProseMirror block node, and a <mark> wrapping $$ lines isn't regular Markdown.
 * Preserve the explicit wrapper on save, and render one yellow background around
 * the KaTeX element's actual dimensions. */
export const BlockMathWithHighlight=BlockMath.extend({
 addAttributes(){
  return {
   ...this.parent?.(),
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
   if(view.dom instanceof HTMLElement)
    view.dom.classList.toggle('rk-highlighted-block-math',Boolean(props.node.attrs.highlighted));
   return view;
  };
 },
 renderMarkdown(node:JSONContent){
  const latex=String(node.attrs?.latex??'');
  const body='$$\n'+latex+'\n$$';
  return node.attrs?.highlighted?'<mark>\n'+body+'\n</mark>':body;
 },
});
