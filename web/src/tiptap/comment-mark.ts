import {Mark} from '@tiptap/core';

/** Markdown %% comments have one authoritative lexer in rmd-comment.ts.
 * This mark only describes how an already-parsed comment appears in Tiptap.
 */
export const VisibleComment=Mark.create({
 name:'visibleComment',
 priority:1900,
 parseHTML(){return [{tag:'span[data-rk-comment]'}];},
 renderHTML({HTMLAttributes}){return ['span',{...HTMLAttributes,'data-rk-comment':''},0];}
});
