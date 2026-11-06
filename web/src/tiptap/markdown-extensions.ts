/**
 * Tiptap Markdown 扩展配置
 *
 * 为不支持标准 Markdown 语法的 Tiptap 扩展添加 Markdown 序列化
 * 这些元素将序列化为 HTML 标签以保留格式
 *
 * 使用方式：在 TiptapEditor 的 extensions 中使用这些扩展替代原始扩展
 *
 * 参考文档：
 * https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing
 */

import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import type { JSONContent } from "@tiptap/react";

// 导出自定义下划线扩展
export { CustomUnderline as UnderlineWithMarkdown } from "./custom-underline";

/**
 * 高亮扩展 + Markdown 支持
 * 序列化为 <mark>text</mark>
 */
export const HighlightWithMarkdown = Highlight.extend({
  priority: 1000,

  // Accept both Tiptap ==highlight== and the <mark>highlight</mark>
  // notation used by Recalloom's existing Markdown notes. Parse nested
  // inline Markdown (especially `code`) as real rich-text marks instead of
  // displaying literal HTML tags or falling back to a source-only block.
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline' as const,
    start: (source: string) => {
      const html = source.toLowerCase().indexOf('<mark>');
      const delimiter = source.indexOf('==');
      return html < 0 ? delimiter : delimiter < 0 ? html : Math.min(html, delimiter);
    },
    tokenize(source, _tokens, lexer) {
      const html = /^<mark>([^\r\n]*?)<\/mark>/i.exec(source);
      const md = /^(==)([^=]+)(==)/.exec(source);
      const match = html ?? md;
      if (!match) return undefined;
      const text = html ? match[1] : match[2].trim();
      return { type: 'highlight', raw: match[0], text, tokens: lexer.inlineTokens(text) };
    },
  },

  renderMarkdown(
    node: JSONContent,
    helpers: {
      renderChildren: (nodes: JSONContent | JSONContent[]) => string;
    },
  ) {
    const content = helpers.renderChildren(node.content || []);
    return `<mark>${content}</mark>`;
  },
});

/**
 * 上标扩展 + Markdown 支持
 * 序列化为 <sup>text</sup>
 */
export const SuperscriptWithMarkdown = Superscript.extend({
  priority: 1000,

  renderMarkdown(
    node: JSONContent,
    helpers: {
      renderChildren: (nodes: JSONContent | JSONContent[]) => string;
    },
  ) {
    const content = helpers.renderChildren(node.content || []);
    return `<sup>${content}</sup>`;
  },
});

/**
 * 下标扩展 + Markdown 支持
 * 序列化为 <sub>text</sub>
 */
export const SubscriptWithMarkdown = Subscript.extend({
  priority: 1000,

  renderMarkdown(
    node: JSONContent,
    helpers: {
      renderChildren: (nodes: JSONContent | JSONContent[]) => string;
    },
  ) {
    const content = helpers.renderChildren(node.content || []);
    return `<sub>${content}</sub>`;
  },
});

/**
 * 文本对齐扩展 + Markdown 支持
 * 非左对齐的段落/标题序列化为带 style 属性的 HTML
 */
export const TextAlignWithMarkdown = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: ["heading", "paragraph"],
        attributes: {
          textAlign: {
            default: "left",
            parseHTML: (element: HTMLElement) =>
              element.style.textAlign || "left",
            renderHTML: (attributes: { textAlign?: string }) => {
              if (!attributes.textAlign || attributes.textAlign === "left") {
                return {};
              }

              return {
                style: `text-align: ${attributes.textAlign}`,
              };
            },
          },
        },
      },
    ];
  },
});
