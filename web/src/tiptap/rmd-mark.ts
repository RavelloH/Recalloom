import {Mark} from '@tiptap/core';

/** Default Mark is NOT colored Highlight. Its HTML presentation is the
 * existing uncolored <mark> with the exact original yellow CSS baseline.
 * This is a distinct ProseMirror mark, not an empty color variant. */
export const RmdMark=Mark.create({
 name:'rmdMark',
 priority:1800,
 parseHTML(){return [{tag:'mark:not([data-rk-color])'}];},
 renderHTML({HTMLAttributes}){return ['mark',HTMLAttributes,0];}
});
