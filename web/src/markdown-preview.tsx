import React from 'react';
import ReactMarkdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {OverlayScroll} from './scrollbars';
import {wikiRemark} from './wiki-remark';
import {WikiInline,WikiEmbed,wikiDecode} from './wiki-components';
import {slugHeading} from './wiki-slug';

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
/** Attach stable, sanitized heading anchors without executing raw HTML. */
function rehypeHeadingIds(){
 const labels=new Map<string,number>();
 const collect=(node:HastNode):string=>node.type==='text'?(node as HastNode&{value?:string}).value??'':(node.children??[]).map(collect).join('');
 const walk=(node:HastNode)=>{
  if(/^h[1-6]$/.test(node.tagName??'')){
   const slug=slugHeading(collect(node));
   if(slug){const count=labels.get(slug)??0;labels.set(slug,count+1);node.properties??={};node.properties.id=slug+(count?'-'+count:'');}
  }
  node.children?.forEach(walk);
 };
 return (tree:HastNode)=>walk(tree);
}
const aligned=['p','h1','h2','h3','h4','h5','h6','th','td'];
const schema={
 ...defaultSchema,
 tagNames:[...(defaultSchema.tagNames??[]),'mark','u','wiki-ref','wiki-embed'],
 attributes:{...defaultSchema.attributes,...Object.fromEntries(aligned.map(tag=>[tag,[...(defaultSchema.attributes?.[tag]??[]),'dataAlign',...(tag.startsWith('h')?['id']:[])]])),
  'wiki-ref':['dataTarget','dataAlias','dataAnchor'],
  'wiki-embed':['dataTarget','dataAnchor']}
};
// Wide blocks scroll inside the column with the same overlay scrollbar as the editor.
const components:Components={
 table:({node:_node,...props})=><OverlayScroll axis="x" edges className="tableWrapper rk-hscroll"><table {...props}/></OverlayScroll>,
 pre:({node:_node,...props})=><OverlayScroll axis="x" edges className="code-block rk-hscroll"><pre {...props}/></OverlayScroll>
};

/** Safe, read-only preview: GFM, math, and bounded wiki transclusion. */
export default function MarkdownPreview({content,sourceId,trail,depth=0}:{content:string;sourceId?:string;trail?:string[];depth?:number}){
 const source=content.replace(/\r\n/g,'\n');
 const chain=trail??(sourceId?[sourceId]:[]);
 const custom={
  'wiki-ref':({node:_node,...props}:Record<string,unknown>)=>
   <WikiInline target={wikiDecode(String(props['data-target']??''))}
    alias={wikiDecode(String(props['data-alias']??''))||null}
    anchor={wikiDecode(String(props['data-anchor']??''))||null} sourceId={sourceId}/> ,
  'wiki-embed':({node:_node,...props}:Record<string,unknown>)=>
   <WikiEmbed target={wikiDecode(String(props['data-target']??''))}
    anchor={wikiDecode(String(props['data-anchor']??''))||null}
    sourceId={sourceId} trail={chain} depth={depth}
    render={(body,id,next,nextDepth)=><MarkdownPreview content={body} sourceId={id} trail={next} depth={nextDepth}/>}/>
 };
 return <article className="markdown-preview">
  <ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,()=>wikiRemark(source)]}
   rehypePlugins={[rehypeRaw,rehypeAlignment,rehypeHeadingIds,[rehypeSanitize,schema],rehypeKatex]}
   components={{...components,...custom} as Components}>{source}</ReactMarkdown>
 </article>;
}
