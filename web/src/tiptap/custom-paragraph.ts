/**
 * 自定义 Paragraph 扩展
 *
 * 支持文本对齐属性，并在 Markdown 序列化时输出对齐的 <p> 标签
 */

import Paragraph from "@tiptap/extension-paragraph";
import {headingAnchor} from '../wiki-slug';
import type { JSONContent } from "@tiptap/react";

export const CustomParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-rk-block-id')||null,
        renderHTML: (attributes:{blockId?:string}) => {
          const id=attributes.blockId;
          return id&&/^[a-z][a-z0-9-]{0,79}$/i.test(id)?{'data-rk-block-id':id,id:headingAnchor(id)}:{};
        },
      },
      textAlign: {
        default: "left",
        parseHTML: (element: HTMLElement) => element.style.textAlign || "left",
        renderHTML: (attributes: { textAlign?: string }) => {
          if (!attributes.textAlign || attributes.textAlign === "left") {
            return {};
          }
          return {
            style: `text-align: ${attributes.textAlign}`,
          };
        },
      },
    };
  },

  renderMarkdown(
    node: JSONContent,
    helpers: {
      renderChildren: (nodes: JSONContent | JSONContent[]) => string;
    },
  ) {
    const align = node.attrs?.textAlign;
    const content = helpers.renderChildren(node.content || []);
    const id=typeof node.attrs?.blockId==='string'&&/^[a-z][a-z0-9-]{0,79}$/i.test(node.attrs.blockId)?node.attrs.blockId.toLowerCase():'';
    const suffix=id?' ^'+id:'';

    // 左对齐或无对齐：使用标准段落格式
    if (!align || align === "left") {
      return content+suffix;
    }

    // 其他对齐：使用 <p> 标签包裹
    return `<p style="text-align: ${align};">${content}</p>`;
  },
});
