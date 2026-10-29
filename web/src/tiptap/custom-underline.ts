/**
 * 自定义下划线扩展
 *
 * 完全重写的下划线扩展，使用 <u> HTML 标签而不是 ++ 语法
 */

import type { JSONContent } from "@tiptap/react";
import Underline from "@tiptap/extension-underline";

// Tiptap Markdown 类型定义
interface MarkdownToken {
  type?: string;
  raw?: string;
  text?: string;
  tokens?: MarkdownToken[];
}

interface MarkdownParseHelpers {
  applyMark: (name: string, content: JSONContent[]) => JSONContent;
  parseInline: (tokens: MarkdownToken[]) => JSONContent[];
}

type MarkdownParseResult = JSONContent;

interface MarkdownLexerConfiguration {
  inlineTokens: (content: string) => MarkdownToken[];
}

export const CustomUnderline = Underline.extend({
  name: "underline",

  // 提高优先级
  priority: 2000,

  // Markdown 解析：支持 ++ 和 <u> 两种语法
  parseMarkdown(
    token: MarkdownToken,
    helpers: MarkdownParseHelpers,
  ): MarkdownParseResult {
    return helpers.applyMark(
      this.name || "underline",
      helpers.parseInline(token.tokens || []),
    );
  },

  // Markdown 序列化：使用 <u> 标签
  renderMarkdown(
    node: JSONContent,
    helpers: {
      renderChildren: (nodes: JSONContent | JSONContent[]) => string;
    },
  ) {
    const content = helpers.renderChildren(node.content || []);
    return `<u>${content}</u>`;
  },

  // Markdown tokenizer：解析 ++ 和 <u> 语法
  markdownTokenizer: {
    name: "underline",
    level: "inline" as const,
    start(src: string) {
      const plusIndex = src.indexOf("++");
      const htmlIndex = src.indexOf("<u>");
      if (plusIndex === -1) return htmlIndex;
      if (htmlIndex === -1) return plusIndex;
      return Math.min(plusIndex, htmlIndex);
    },
    tokenize(
      src: string,
      _tokens: MarkdownToken[],
      lexer: MarkdownLexerConfiguration,
    ): MarkdownToken | undefined {
      // 尝试匹配 <u> 标签
      const htmlRule = /^<u>([^<]+)<\/u>/;
      let match = htmlRule.exec(src);

      if (match) {
        const innerContent = match[1] || "";
        const token: MarkdownToken = {
          type: "underline",
          raw: match[0],
          text: innerContent,
          tokens: lexer.inlineTokens(innerContent),
        };
        return token;
      }

      // 尝试匹配 ++ 语法
      const plusRule = /^(\+\+)([\s\S]+?)(\+\+)/;
      match = plusRule.exec(src);

      if (!match) {
        return undefined;
      }

      const innerContent = match[2]?.trim() || "";
      const token: MarkdownToken = {
        type: "underline",
        raw: match[0],
        text: innerContent,
        tokens: lexer.inlineTokens(innerContent),
      };
      return token;
    },
  },

});
