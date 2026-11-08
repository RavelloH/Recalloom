import Highlight from '@tiptap/extension-highlight';
import {RMD_COLORS} from '../rmd-schema';

export const highlightColors=new Set<string>(RMD_COLORS);
/** RMD has separate Mark and Highlight semantics. This extension provides
 * only ProseMirror HTML rendering; rmd-lexer owns the source grammar. */
export const HighlightWithMarkdown=Highlight.extend({
 priority:1000,
 addAttributes(){
  return {...this.parent?.(),color:{
   default:null,
   parseHTML:(el:HTMLElement)=>el.getAttribute('data-rk-color'),
   renderHTML:(attrs:{color?:string|null})=>
    attrs.color&&highlightColors.has(attrs.color)?{'data-rk-color':attrs.color}:{}
  }};
 },
 renderHTML({HTMLAttributes}){return ['mark',HTMLAttributes,0];}
});
