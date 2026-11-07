import {Mark} from '@tiptap/core';
import type {JSONContent} from '@tiptap/core';

/** Comments are deliberately always visible in the visual editor. */
export const VisibleComment=Mark.create({
 name:'visibleComment',priority:1900,
 parseHTML(){return [{tag:'span[data-rk-comment]'}];},
 renderHTML({HTMLAttributes}){return ['span',{...HTMLAttributes,'data-rk-comment':''},0];},
 parseMarkdown(token:any,helpers:any){
  return helpers.applyMark('visibleComment',helpers.parseInline(token.tokens??[]));
 },
 renderMarkdown(node:JSONContent,helpers:{renderChildren:(nodes:JSONContent[])=>string}){
  return '%%'+helpers.renderChildren(node.content??[])+'%%';
 },
 markdownTokenizer:{
  name:'visibleComment',level:'inline' as const,
  start:(s:string)=>s.indexOf('%%'),
  tokenize:(s:string,_tokens:any[],lexer:any)=>{
   const m=/^%%([^\r\n%]|%(?!%))+%%/.exec(s);
   if(!m)return undefined;
   const body=m[0].slice(2,-2);
   return {type:'visibleComment',raw:m[0],text:body,tokens:lexer.inlineTokens(body)};
  }
 }
});
