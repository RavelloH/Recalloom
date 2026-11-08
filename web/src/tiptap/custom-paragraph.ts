import Paragraph from '@tiptap/extension-paragraph';
import {headingAnchor} from '../wiki-slug';

/** Paragraph block identity is a ProseMirror attribute, not an HTML or
 * legacy ^block-id source serializer. @ attrs is owned by RMD.
 */
export const CustomParagraph=Paragraph.extend({
 addAttributes(){
  return {...this.parent?.(),
   blockId:{
    default:null,
    parseHTML:(element:HTMLElement)=>element.getAttribute('data-rk-block-id')||null,
    renderHTML:(attributes:{blockId?:string})=>{
     const id=attributes.blockId;
     return id&&/^[a-z][a-z0-9-]{0,79}$/i.test(id)
      ?{'data-rk-block-id':id,id:headingAnchor(id)}:{};
    }
   },
   textAlign:{
    default:'left',
    parseHTML:(element:HTMLElement)=>element.style.textAlign||'left',
    renderHTML:(attributes:{textAlign?:string})=>
     !attributes.textAlign||attributes.textAlign==='left'?{}:{style:'text-align: '+attributes.textAlign}
   }
  };
 }
});
