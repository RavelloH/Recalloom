import Highlight from '@tiptap/extension-highlight';
import type {JSONContent} from '@tiptap/core';

export const highlightColors=new Set(['red','orange','yellow','green','blue','purple','pink','cyan','teal']);
/** Theme-aware, text and math-compatible highlight. Color values are whitelisted. */
export const HighlightWithMarkdown=Highlight.extend({
 priority:1000,
 addAttributes(){
  return {...this.parent?.(),color:{
   default:null,
   parseHTML:(el:HTMLElement)=>el.getAttribute('data-rk-color'),
   renderHTML:(attrs:{color?:string|null})=>attrs.color&&highlightColors.has(attrs.color)?{'data-rk-color':attrs.color}:{}
  }};
 },
 renderHTML({HTMLAttributes}){return ['mark',HTMLAttributes,0];},
 markdownTokenizer:{
  name:'highlight',level:'inline' as const,
  start:(source:string)=>{
   const candidates=[source.indexOf('<mark'),source.indexOf('=='),source.indexOf(':highlight[')].filter(x=>x>=0);
   return candidates.length?Math.min(...candidates):-1;
  },
  tokenize(source,_tokens,lexer){
   const directive=/^:highlight\[([^\]\r\n]+)\]\{color=(red|orange|yellow|green|blue|purple|pink|cyan|teal)\}/.exec(source);
   const colored=/^<mark\s+data-rk-color=["'](red|orange|yellow|green|blue|purple|pink|cyan|teal)["']>([^\r\n]*?)<\/mark>/i.exec(source);
   const html=/^<mark>([^\r\n]*?)<\/mark>/i.exec(source);
   const md=/^(==)([^=]+)(==)/.exec(source);
   const match=directive??colored??html??md;
   if(!match)return undefined;
   const color=directive?directive[2]:colored?colored[1]:null;
   const body=directive?directive[1]:colored?colored[2]:html?html[1]:(md?.[2]??'').trim();
   return {type:'highlight',raw:match[0],text:body,color,tokens:lexer.inlineTokens(body)};
  }
 },
 parseMarkdown(token,helpers){
  const children=helpers.parseInline(token.tokens||[]);
  const color=String((token as typeof token&{color?:string}).color??'');
  return children.map((node:JSONContent)=>({
   ...node,
   marks:[...(node.marks||[]),{type:'highlight',...(highlightColors.has(color)?{attrs:{color}}:{})}]
  }));
 },
 renderMarkdown(node:JSONContent,helpers:{renderChildren:(nodes:JSONContent[])=>string}){
  const text=helpers.renderChildren(node.content||[]);
  const color=String(node.attrs?.color??'');
  return highlightColors.has(color)?':highlight['+text+']{color='+color+'}':'<mark>'+text+'</mark>';
 }
});
