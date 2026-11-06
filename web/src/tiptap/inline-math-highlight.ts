import {InlineMath} from '@tiptap/extension-mathematics';
import type {JSONContent} from '@tiptap/core';

/** Preserve highlight on an atomic inline formula in Markdown.
 *
 * The upstream Markdown serializer closes text marks before any non-text
 * atom and renders the atom without applying its own marks. An inlineMath
 * can therefore appear highlighted in the editor yet lose <mark> on save.
 * Render that one supported mark as an HTML wrapper around the $...$ token.
 * Standard, unhighlighted inline formula serialization remains unchanged.
 */
export const InlineMathWithHighlight = InlineMath.extend({
  renderMarkdown(node:JSONContent){
    const latex=String(node.attrs?.latex??'');
    const expression='$'+latex+'$';
    return node.marks?.some(mark=>mark.type==='highlight')
      ?'<mark>'+expression+'</mark>'
      :expression;
  },
});
