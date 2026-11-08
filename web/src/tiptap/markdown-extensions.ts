import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';

/** ProseMirror render/paste extensions only. RMD owns all Markdown parsing,
 * source validation and canonical serialization, including HTML u/sup/sub.
 */
export {CustomUnderline as UnderlineWithMarkdown} from './custom-underline';
export {HighlightWithMarkdown} from './colored-highlight';
export const SuperscriptWithMarkdown=Superscript.extend({priority:1000});
export const SubscriptWithMarkdown=Subscript.extend({priority:1000});
export const TextAlignWithMarkdown=TextAlign.extend({
 addGlobalAttributes(){
  return [{
   types:['heading','paragraph'],
   attributes:{
    textAlign:{
     default:'left',
     parseHTML:(element:HTMLElement)=>element.style.textAlign||'left',
     renderHTML:(attrs:{textAlign?:string})=>
      !attrs.textAlign||attrs.textAlign==='left'?{}:{style:'text-align: '+attrs.textAlign}
    }
   }
  }];
 }
});
