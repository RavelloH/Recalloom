/**
 * 自定义 Heading 扩展
 *
 * 支持文本对齐属性，并在 Markdown 序列化时输出对齐的 <h1-h6> 标签
 * Recalloom 使用独立的 Markdown 大纲；不复用 NeutralPress 的标题节点视图
 */

import Heading from "@tiptap/extension-heading";
import type { JSONContent } from "@tiptap/react";



export const CustomHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
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
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.id || null,
        renderHTML: (attributes: { id?: string }) => {
          if (!attributes.id) {
            return {};
          }
          return {
            id: attributes.id,
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
    const level = node.attrs?.level || 1;
    const align = node.attrs?.textAlign;
    const content = helpers.renderChildren(node.content || []);
    const prefix = "#".repeat(level);

    // 左对齐或无对齐：使用标准 Markdown 标题
    if (!align || align === "left") {
      return `${prefix} ${content}`;
    }

    // 其他对齐：使用 HTML 标题标签
    return `<h${level} style="text-align: ${align};">${content}</h${level}>`;
  },
});
