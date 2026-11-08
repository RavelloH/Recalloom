import {Node,mergeAttributes} from '@tiptap/core';
import type {JSONContent} from '@tiptap/core';

/**
 * Unsupported Markdown stays readable, editable plain text instead of
 * becoming a rich-text representation of syntax we do not understand.
 * Only the shared RMD serializer emits its text verbatim; ProseMirror merely
 * stores an editable source slice while preserving surrounding rich content.
 */
export const RawMarkdown=Node.create({
 name:'rawMarkdown',
 group:'block',
 content:'text*',
 defining:true,
 isolating:true,
 priority:60,
 parseHTML(){return [{tag:'p[data-raw-markdown]'}];},
 renderHTML({HTMLAttributes}){return ['p',mergeAttributes(HTMLAttributes,{'data-raw-markdown':''}),0];}
});

/** One editable block with a verbatim Markdown source fragment. */
export function rawMarkdownBlock(source:string):JSONContent{
 return {type:'rawMarkdown',content:source?[{type:'text',text:source}]:[]};
}

/** Unsupported inline syntax stays an ordinary editable inline span.
 * Its source is serialized literally while adjacent Markdown remains rich.
 */
export const RawInline=Node.create({
 name:'rawInline',
 group:'inline',
 inline:true,
 content:'text*',
 defining:true,
 priority:65,
 parseHTML(){return [{tag:'span[data-raw-inline]'}];},
 renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-raw-inline':''}),0];}
});
