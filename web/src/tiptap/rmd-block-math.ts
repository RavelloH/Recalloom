import {BlockMath} from '@tiptap/extension-mathematics';
import {validCrossRefId} from '../cross-reference';
import {headingAnchor} from '../wiki-slug';

/** RMD display math: only stable equation identity is stored on its node.
 * Block Mark/Highlight are parent RMD containers, not a duplicated
 * "highlighted" boolean or custom HTML serializer on the math atom.
 */
export const RmdBlockMath=BlockMath.extend({
 addAttributes(){
  return {...this.parent?.(),
   equationId:{
    default:null,
    parseHTML:(el:HTMLElement)=>el.getAttribute('data-rk-equation-id')||null,
    renderHTML:(attrs:Record<string,unknown>)=>validCrossRefId(attrs.equationId,'eq')
     ?{'data-rk-equation-id':attrs.equationId}:{}
   }
  };
 },
 addNodeView(){
  const renderParent=this.parent?.();
  return (props)=>{
   if(!renderParent)throw new Error('BlockMath node view unavailable');
   const view=renderParent(props);
   const apply=(node:typeof props.node)=>{
    if(!(view.dom instanceof HTMLElement))return;
    const id=node.attrs.equationId;
    if(validCrossRefId(id,'eq')){
     view.dom.id=headingAnchor(id);
     view.dom.setAttribute('data-rk-equation-id',id);
    }else{
     view.dom.removeAttribute('id');
     view.dom.removeAttribute('data-rk-equation-id');
    }
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
 }
});
