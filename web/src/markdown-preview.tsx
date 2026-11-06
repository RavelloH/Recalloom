import React from 'react';
import ReactMarkdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {OverlayScroll} from './scrollbars';
import {remarkMarkedDisplayMath} from './tiptap/marked-display-math';

type HastNode={type:string;tagName?:string;properties?:Record<string,unknown>;children?:HastNode[]};
/** The visual editor writes alignment as `style="text-align: …"`. Styles are
 *  never trusted, so the one supported value is carried as data-align. */
function rehypeAlignment(){
 const walk=(node:HastNode)=>{
  const style=node.properties?.style;
  if(typeof style==='string'){
   const align=/text-align:\s*(left|center|right)/i.exec(style)?.[1]?.toLowerCase();
   if(align)node.properties!.dataAlign=align;
   delete node.properties!.style;
  }
  node.children?.forEach(walk);
 };
 return (tree:HastNode)=>walk(tree);
}
const aligned=['p','h1','h2','h3','h4','h5','h6','th','td'];
const schema={
 ...defaultSchema,
 tagNames:[...(defaultSchema.tagNames??[]),'mark','u'],
 attributes:{...defaultSchema.attributes,...Object.fromEntries(aligned.map(tag=>[tag,[...(defaultSchema.attributes?.[tag]??[]),'dataAlign']])),
  div:[...(defaultSchema.attributes?.div??[]),'dataHighlightedMath']}
};
// Wide blocks scroll inside the column with the same overlay scrollbar as the editor.
const components:Components={
 table:({node:_node,...props})=><OverlayScroll axis="x" edges className="tableWrapper rk-hscroll"><table {...props}/></OverlayScroll>,
 pre:({node:_node,...props})=><OverlayScroll axis="x" edges className="code-block rk-hscroll"><pre {...props}/></OverlayScroll>
};

/** Safe, read-only preview: GFM tables/tasks/strikethrough, math, and sanitized inline HTML. */
export default function MarkdownPreview({content}:{content:string}){
 return <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,remarkMarkedDisplayMath]} rehypePlugins={[rehypeRaw,rehypeAlignment,[rehypeSanitize,schema],rehypeKatex]} components={components}>{content}</ReactMarkdown></article>;
}
