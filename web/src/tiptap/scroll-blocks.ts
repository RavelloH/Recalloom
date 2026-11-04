import CodeBlock from '@tiptap/extension-code-block';
import {TableView} from '@tiptap/extension-table';
import type {Node as PMNode} from '@tiptap/pm/model';
import type {EditorView,ViewMutationRecord} from '@tiptap/pm/view';
import {attachScrollbars} from '../scrollbars';

/* Wide tables and code scroll inside the document column, using the same
   overlay scrollbar as the rest of the app. The scroll chrome lives outside
   ProseMirror's contentDOM, and mutations there are ignored. */
function scrollFrame(host:HTMLElement,child:HTMLElement){
 host.classList.add('rk-hscroll');
 const viewport=document.createElement('div');
 viewport.className='rk-scroll-viewport';
 viewport.dataset.axis='x';
 host.insertBefore(viewport,child);
 viewport.appendChild(child);
 let detach:(()=>void)|undefined;
 // OverlayScrollbars measures layout, so wait until the node view is attached.
 const frame=requestAnimationFrame(()=>{if(host.isConnected)detach=attachScrollbars(host,viewport,'x',{edges:true});});
 return()=>{cancelAnimationFrame(frame);detach?.();};
}

export class ScrollTableView extends TableView{
 private release:()=>void;
 constructor(node:PMNode,cellMinWidth:number,view:EditorView,attrs:Record<string,unknown>={}){
  super(node,cellMinWidth,view,attrs);
  this.release=scrollFrame(this.dom,this.table);
 }
 destroy(){this.release();}
}

export const ScrollCodeBlock=CodeBlock.extend({
 addNodeView(){
  return ({node})=>{
   let current=node;
   const dom=document.createElement('div');
   dom.className='code-block';
   const pre=document.createElement('pre'),code=document.createElement('code');
   const language=(value:PMNode)=>{const lang=value.attrs.language as string|null;code.className=lang?this.options.languageClassPrefix+lang:'';};
   language(node);
   pre.appendChild(code);
   dom.appendChild(pre);
   const release=scrollFrame(dom,pre);
   return {
    dom,contentDOM:code,
    update:(next:PMNode)=>{if(next.type!==current.type)return false;current=next;language(next);return true;},
    ignoreMutation:(mutation:ViewMutationRecord)=>mutation.type!=='selection'&&!code.contains(mutation.target),
    destroy:release
   };
  };
 }
});
