import Heading from '@tiptap/extension-heading';
import {mergeAttributes} from '@tiptap/core';
import {headingAnchor} from '../wiki-slug';

/** Rich heading presentation. Source IDs and serialization belong solely
 * to RMD's semantic parser and canonical serializer.
 */
export const CustomHeading=Heading.extend({
 addAttributes(){
  return {...this.parent?.(),
   textAlign:{
    default:'left',
    parseHTML:(element:HTMLElement)=>element.style.textAlign||'left',
    renderHTML:(attributes:{textAlign?:string})=>
     !attributes.textAlign||attributes.textAlign==='left'?{}:{style:'text-align: '+attributes.textAlign}
   },
   id:{
    default:null,
    parseHTML:(element:HTMLElement)=>element.id||null,
    renderHTML:(attributes:{id?:string})=>attributes.id?{id:attributes.id}:{}
   }
  };
 },
 renderHTML({node,HTMLAttributes}){
  return ['h'+node.attrs.level,mergeAttributes(this.options.HTMLAttributes,HTMLAttributes,{
   id:headingAnchor(String(node.attrs.id||node.textContent))
  }),0];
 }
});
