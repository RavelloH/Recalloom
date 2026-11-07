import {Node,mergeAttributes} from '@tiptap/core';
import type {JSONContent} from '@tiptap/core';

/**
 * Unsupported Markdown stays readable, editable plain text instead of
 * becoming a rich-text representation of syntax we do not understand.
 * The Markdown serializer deliberately emits its text verbatim, without
 * treating brackets, angle brackets or footnote markers as formatting.
 */
export const RawMarkdown=Node.create({
 name:'rawMarkdown',
 group:'block',
 content:'text*',
 defining:true,
 isolating:true,
 priority:60,
 parseHTML(){return [{tag:'p[data-raw-markdown]'}];},
 renderHTML({HTMLAttributes}){return ['p',mergeAttributes(HTMLAttributes,{'data-raw-markdown':''}),0];},
 renderMarkdown(node:JSONContent){
  return (node.content??[]).map(child=>child.text??'').join('');
 }
});

/** One editable block with a verbatim Markdown source fragment. */
export function rawMarkdownBlock(source:string):JSONContent{
 return {type:'rawMarkdown',content:source?[{type:'text',text:source}]:[]};
}
