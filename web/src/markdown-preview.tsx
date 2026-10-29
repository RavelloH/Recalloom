import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
/** Safe, read-only preview: GFM tables/tasks/strikethrough, math, and sanitized inline HTML. */
export default function MarkdownPreview({content}:{content:string}){
 return <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeRaw,rehypeSanitize,rehypeKatex]}>{content}</ReactMarkdown></article>;
}
