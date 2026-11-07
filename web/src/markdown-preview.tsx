import React from 'react';
import ReactMarkdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {richRemarkDirective,remarkRichTransforms} from './rich-remark';
import {richTitle} from './tiptap/rich-schema';
import {Banner} from '@astryxdesign/core/Banner';
import {Badge} from '@astryxdesign/core/Badge';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {ChatMessage,ChatMessageBubble,ChatMessageList} from '@astryxdesign/core/Chat';
import {Tooltip} from '@astryxdesign/core/Tooltip';
import {SmartLink} from './link-icons';
import {LinkCardView} from './tiptap/rich-link-card';
import {TabsPreview} from './rich-tabs';
import {FrontMatterCard} from './tiptap/rich-frontmatter';
import {yamlFrontMatter} from './tiptap/frontmatter-utils';
import {remarkCodeMetadata} from './code-remark';
import ShikiCodePreview,{codePropsFromElement} from './code-preview';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {OverlayScroll} from './scrollbars';
import {remarkMarkedDisplayMath} from './tiptap/marked-display-math';
import {prepareWikiMarkdown} from './wiki-remark';
import {WikiInline,WikiEmbed,wikiDecode} from './wiki-components';
import {slugHeading,explicitHeadingAnchor,explicitBlockAnchor} from './wiki-slug';

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
   const last=node.children?.at(-1) as (HastNode&{value?:string})|undefined;
   const explicit=last?.type==='text'&&typeof last.value==='string'?explicitHeadingAnchor(last.value):null;
   if(explicit&&((explicit.body.length>0)||(node.children?.length??0)>1))last!.value=explicit.body;
   const explicitId=explicit&&((explicit.body.length>0)||(node.children?.length??0)>1)?explicit.id:null;
   const slug=explicitId??slugHeading(collect(node));
   if(slug){const count=labels.get(slug)??0;labels.set(slug,count+1);node.properties??={};node.properties.id=slug+(count?'-'+count:'');}
  }
  if(node.tagName==='p'){
   const last=node.children?.at(-1) as (HastNode&{value?:string})|undefined;
   const match=last?.type==='text'&&typeof last.value==='string'?explicitBlockAnchor(last.value):null;
   if(match&&(match.body||(node.children?.length??0)>1)){
    last!.value=match.body;
    node.properties??={};node.properties.id=match.id;
   }
  }
  node.children?.forEach(walk);
 };
 return (tree:HastNode)=>walk(tree);
}
const aligned=['p','h1','h2','h3','h4','h5','h6','th','td'];
const schema={
 ...defaultSchema,
 tagNames:[...(defaultSchema.tagNames??[]),'mark','u','wiki-ref','wiki-embed','rk-callout','rk-link-card','rk-badge','rk-abbr','rk-tip','rk-comment'],
 attributes:{...defaultSchema.attributes,...Object.fromEntries(aligned.map(tag=>[tag,[...(defaultSchema.attributes?.[tag]??[]),'dataAlign',...(tag.startsWith('h')||tag==='p'?['id']:[])]])),
  div:[...(defaultSchema.attributes?.div??[]),'dataHighlightedMath'],
  'wiki-ref':['dataTarget','dataAlias','dataAnchor'],
  'wiki-embed':['dataTarget','dataAnchor'],
  'rk-callout':['dataKind','dataTitle','dataSender'],
  'rk-link-card':['dataUrl','dataTitle'],
  'rk-badge':['dataVariant'],
  'rk-abbr':['dataTitle'],
  'rk-tip':['dataContent'],
  code:[...(defaultSchema.attributes?.code??[]),'dataFile','dataWrap','dataExpand'],
  mark:[...(defaultSchema.attributes?.mark??[]),'dataRkColor']}
};
// Wide blocks scroll inside the column with the same overlay scrollbar as the editor.
const components:Components={
 a:({node:_node,...props})=><SmartLink {...props}/>,
 table:({node:_node,...props})=><OverlayScroll axis="x" edges className="tableWrapper rk-hscroll"><table {...props}/></OverlayScroll>,
 pre:({node:_node,children})=><ShikiCodePreview {...codePropsFromElement(React.Children.toArray(children)[0])}/>
};

/** Safe, read-only preview: GFM, math, and bounded wiki transclusion. */
export default function MarkdownPreview({content,sourceId,trail,depth=0}:{content:string;sourceId?:string;trail?:string[];depth?:number}){
 const source=content.replace(/\r\n/g,'\n');
 const frontmatter=yamlFrontMatter.exec(source);
 const body=frontmatter?source.slice(frontmatter[0].length).replace(/^\n+/, ''):source;
 const prepared=prepareWikiMarkdown(body);
 const chain=trail??(sourceId?[sourceId]:[]);
 const custom={
  'wiki-ref':({node:_node,...props}:Record<string,unknown>)=>
   <WikiInline target={wikiDecode(String(props['data-target']??''))}
    alias={wikiDecode(String(props['data-alias']??''))||null}
    anchor={wikiDecode(String(props['data-anchor']??''))||null} sourceId={sourceId}/> ,
  'rk-link-card':({node:_node,...props}:Record<string,unknown>)=><LinkCardView url={String(props['data-url']??props.dataUrl??'')} title={String(props['data-title']??props.dataTitle??'')}/>,
  'rk-callout':({node:_node,...props}:Record<string,unknown>)=>{
   const kind=String(props['data-kind']??props.dataKind??'info'),title=String(props['data-title']??props.dataTitle??'');
   if(kind==='tabs')return <TabsPreview>{props.children as React.ReactNode}</TabsPreview>;
   if(kind==='tab')return <div className="rk-tab-pane">{props.children as React.ReactNode}</div>;
   if(kind==='chat')return <ChatMessageList density="compact" align="top">{props.children as React.ReactNode}</ChatMessageList>;
   if(kind==='message'){
    const rawSender=String(props['data-sender']??props.dataSender??'assistant');
    const sender=rawSender==='user'?'user':rawSender==='system'?'system':'assistant';
    return <ChatMessage sender={sender}><ChatMessageBubble name={richTitle(kind,title)}>{props.children as React.ReactNode}</ChatMessageBubble></ChatMessage>;
   }
   if(kind==='details')return <Collapsible trigger={richTitle(kind,title)} defaultIsOpen>{props.children as React.ReactNode}</Collapsible>;
   const status=kind==='danger'?'error':kind==='warning'?'warning':kind==='success'?'success':'info';
   return <Banner status={status} title={richTitle(kind,title)} collapsible={false}>{props.children as React.ReactNode}</Banner>;
  },
  'rk-badge':({node:_node,...props}:Record<string,unknown>)=>{
   const raw=String(props['data-variant']??props.dataVariant??'neutral');
   const valid=['neutral','info','warning','error','success','blue','green','red','purple','orange','yellow'].includes(raw)?raw:'neutral';
   return <Badge variant={valid as 'neutral'|'success'} label={props.children as React.ReactNode}/>;
  },
  'rk-abbr':({node:_node,...props}:Record<string,unknown>)=><Tooltip content={String(props['data-title']??props.dataTitle??'')}><span className="rk-inline-abbr" tabIndex={0}>{props.children as React.ReactNode}</span></Tooltip>,
  'rk-tip':({node:_node,...props}:Record<string,unknown>)=><Tooltip content={String(props['data-content']??props.dataContent??'')}><span className="rk-inline-tip" tabIndex={0}>{props.children as React.ReactNode}</span></Tooltip>,
  'rk-comment':({node:_node,...props}:Record<string,unknown>)=><span className="rk-comment" data-rk-comment="">{props.children as React.ReactNode}</span>,
  'wiki-embed':({node:_node,...props}:Record<string,unknown>)=>
   <WikiEmbed target={wikiDecode(String(props['data-target']??''))}
    anchor={wikiDecode(String(props['data-anchor']??''))||null}
    sourceId={sourceId} trail={chain} depth={depth}
    render={(body,id,next,nextDepth)=><MarkdownPreview content={body} sourceId={id} trail={next} depth={nextDepth}/>}/>
 };
 return <article className="markdown-preview">
  {frontmatter&&<FrontMatterCard source={frontmatter[0]}/>}
  <ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,richRemarkDirective,()=>remarkRichTransforms(prepared),remarkCodeMetadata,remarkMarkedDisplayMath]}
   rehypePlugins={[rehypeRaw,rehypeAlignment,rehypeHeadingIds,[rehypeSanitize,schema],rehypeKatex]}
   components={{...components,...custom} as Components}>{prepared}</ReactMarkdown>
 </article>;
}
