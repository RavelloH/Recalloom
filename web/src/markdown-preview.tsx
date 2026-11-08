import React,{useMemo} from 'react';
import ReactMarkdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {richRemarkDirective,remarkRichTransforms} from './rich-remark';
import {richTitle} from './tiptap/rich-schema';
import {Banner} from '@astryxdesign/core/Banner';
import {Badge} from '@astryxdesign/core/Badge';
import {Card} from '@astryxdesign/core/Card';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {ChatMessage,ChatMessageBubble,ChatMessageList} from '@astryxdesign/core/Chat';
import {Tooltip} from '@astryxdesign/core/Tooltip';
import {SmartLink} from './link-icons';
import {LinkCardView} from './tiptap/rich-link-card';
import {TabsPreview} from './rich-tabs';
import {remarkCodeMetadata} from './code-remark';
import ShikiCodePreview,{codePropsFromElement} from './code-preview';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {OverlayScroll} from './scrollbars';
import {remarkMarkedDisplayMath} from './tiptap/marked-display-math';
import {prepareWikiMarkdown} from './wiki-remark';
import {prepareCriticMarkdown,type CriticKind} from './critic-syntax';
import {CriticDisplay} from './tiptap/rich-critic';
import ClozeReveal from './cloze-reveal';
import {remarkFigureAttributes} from './remark-figure';
import {remarkTableCaptions} from './remark-table-caption';
import {safeTableId,cleanTableCaption} from './table-caption';
import {collectPreviewRefs,remarkCrossRefDisplay} from './markdown-cross-reference';
import {shieldEquationIdClosers,validCrossRefId} from './cross-reference';
import {safeFigureImageSrc} from './figure-syntax';
import {WikiInline,WikiEmbed,wikiDecode} from './wiki-components';
import {slugHeading,headingAnchor,explicitHeadingAnchor,explicitBlockAnchor} from './wiki-slug';

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
 tagNames:[...(defaultSchema.tagNames??[]),'mark','u','wiki-ref','wiki-embed','rk-callout','rk-link-card','rk-critic','rk-badge','rk-abbr','rk-tip','rk-kbd','rk-cloze','rk-comment','rk-figure','rk-table-caption','rk-cross-ref','rk-numbered-math'],
 attributes:{...defaultSchema.attributes,...Object.fromEntries(aligned.map(tag=>[tag,[...(defaultSchema.attributes?.[tag]??[]),'dataAlign',...(tag.startsWith('h')||tag==='p'?['id']:[])]])),
  div:[...(defaultSchema.attributes?.div??[]),'dataHighlightedMath'],
  'wiki-ref':['dataTarget','dataAlias','dataAnchor'],
  'wiki-embed':['dataTarget','dataAnchor'],
  'rk-callout':['dataKind','dataTitle','dataSender'],
  'rk-link-card':['dataUrl','dataTitle'],
  'rk-critic':['dataKind','dataValue','dataBefore'],
  'rk-badge':['dataVariant'],
  'rk-abbr':['dataTitle'],
  'rk-tip':['dataContent'],
  'rk-cloze':['dataHint'],
  'rk-figure':['dataPayload'],
  'rk-table-caption':['dataId','dataCaption'],
  'rk-cross-ref':['dataId'],
  'rk-numbered-math':['dataId'],
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
 // A YAML-looking header is ordinary document text, not Recalloom metadata.
 // Isolate it from the CommonMark parser so --- is not reinterpreted as rules.
 const frontmatter=/^\uFEFF?(?:---|\+\+\+)[ \t]*\n[\s\S]*?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?=\n|$)/.exec(source);
 const body=frontmatter?source.slice(frontmatter[0].length).replace(/^\n+/, ''):source;
 const prepared=prepareCriticMarkdown(prepareWikiMarkdown(body));
 const refIndex=useMemo(()=>collectPreviewRefs(prepared),[prepared]);
 const parseSource=useMemo(()=>shieldEquationIdClosers(prepared),[prepared]);
 const chain=trail??(sourceId?[sourceId]:[]);
 const custom={
  'wiki-ref':({node:_node,...props}:Record<string,unknown>)=>
   <WikiInline target={wikiDecode(String(props['data-target']??''))}
    alias={wikiDecode(String(props['data-alias']??''))||null}
    anchor={wikiDecode(String(props['data-anchor']??''))||null} sourceId={sourceId}/> ,
  'rk-critic':({node:_node,...props}:Record<string,unknown>)=>{
   const kind=String(props['data-kind']??props.dataKind??'comment');
   if(!['addition','deletion','substitution','comment','highlight'].includes(kind))return null;
   const decode=(raw:unknown)=>{try{return decodeURIComponent(String(raw??''));}catch{return '';}};
   return <CriticDisplay kind={kind as CriticKind} text={decode(props['data-value']??props.dataValue)} before={decode(props['data-before']??props.dataBefore)}/>;
  },
  'rk-figure':({node:_node,...props}:Record<string,unknown>)=>{
   let raw:unknown;
   try{raw=JSON.parse(decodeURIComponent(String(props['data-payload']??props.dataPayload??'')));}catch{return null;}
   if(!raw||typeof raw!=='object')return null;
   const attrs=raw as {src?:string;alt?:string;title?:string;width?:number;height?:number;caption?:string;id?:string};
   if(!safeFigureImageSrc(String(attrs.src??'')))return null;
   const size=(n:unknown)=>typeof n==='number'&&Number.isInteger(n)&&n>=40&&n<=1800?n:undefined;
   const width=size(attrs.width),height=size(attrs.height);
   const caption=String(attrs.caption??'').slice(0,240);
   const id=validCrossRefId(attrs.id,'fig')?attrs.id:null;
   const number=id?refIndex.get(id)?.label:null;
   return <figure id={id?headingAnchor(id):undefined} data-rk-figure-id={id??undefined} className="rk-rich-figure rk-rich-figure-projection">
    <img src={attrs.src} alt={String(attrs.alt??'')} title={String(attrs.title??'')||undefined}
     loading="lazy" referrerPolicy="no-referrer" style={{width:width?width+'px':undefined,height:height?height+'px':undefined,objectFit:'contain'}}/>
    {(caption||number)&&<figcaption className="rk-rich-figcaption">{number&&<strong className="rk-cross-caption-number">{number}{caption?'：':''}</strong>}{caption}</figcaption>}
   </figure>;
  },
    'rk-cross-ref':({node:_node,...props}:Record<string,unknown>)=>{
   const id=String(props['data-id']??props.dataId??'');
   if(!validCrossRefId(id))return null;
   const item=refIndex.get(id);
   return item?<a href={'#'+headingAnchor(id)} className="rk-cross-reference-read">{item.label}</a>
    :<span className="rk-cross-reference-read rk-cross-reference-missing" title={'缺少目标块 '+id}>{'引用不存在：'+id}</span>;
  },
  'rk-numbered-math':({node:_node,...props}:Record<string,unknown>)=>{
   const id=String(props['data-id']??props.dataId??'');
   if(!validCrossRefId(id,'eq'))return null;
   const item=refIndex.get(id);
   return <div className="rk-numbered-math-projection" id={headingAnchor(id)} data-rk-equation-id={id}>
    <div className="rk-numbered-math-content">{props.children as React.ReactNode}</div>
    {item&&<span className="rk-numbered-math-label">({item.number})</span>}
   </div>;
  },
'rk-table-caption':({node:_node,...props}:Record<string,unknown>)=>{
   let id='',caption='';
   try{
    id=decodeURIComponent(String(props['data-id']??props.dataId??''));
    caption=cleanTableCaption(decodeURIComponent(String(props['data-caption']??props.dataCaption??'')));
   }catch{return null;}
   if(!safeTableId(id)||!caption)return null;
   return <div className="rk-table-caption-read" data-rk-table-id={id} id={headingAnchor(id)}>{caption}</div>;
  },
  'rk-link-card':({node:_node,...props}:Record<string,unknown>)=><LinkCardView url={String(props['data-url']??props.dataUrl??'')} title={String(props['data-title']??props.dataTitle??'')}/>,
  'rk-callout':({node:_node,...props}:Record<string,unknown>)=>{
   const kind=String(props['data-kind']??props.dataKind??'info'),title=String(props['data-title']??props.dataTitle??'');
   if(kind==='flashcard')return <Card variant="default" padding={3} className="rk-flashcard rk-flashcard-read">
    <div className="rk-flashcard-heading">{richTitle(kind,title)}</div>
    <div className="rk-flashcard-body">{props.children as React.ReactNode}</div>
   </Card>;
   if(kind==='front')return <section className="rk-flashcard-front">
    <div className="rk-flashcard-panel-title">{richTitle(kind,title)}</div>
    <div className="rk-flashcard-content">{props.children as React.ReactNode}</div>
   </section>;
   if(kind==='back')return <Collapsible trigger="显示答案" defaultIsOpen={false}>
     <div className="rk-flashcard-content rk-flashcard-answer">{props.children as React.ReactNode}</div>
    </Collapsible>;
   if(kind==='glossary')return <Card variant="muted" padding={3} className="rk-glossary-read">
    <div className="rk-glossary-title">{richTitle(kind,title)}</div>
    <div className="rk-glossary-entries">{props.children as React.ReactNode}</div>
   </Card>;
   if(kind==='definition')return <dl className="rk-definition-read">
    <dt className="rk-definition-term">{richTitle(kind,title)}</dt>
    <dd className="rk-definition-body">{props.children as React.ReactNode}</dd>
   </dl>;
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
  'rk-kbd':({node:_node,...props}:Record<string,unknown>)=><kbd className="rk-keycap">{props.children as React.ReactNode}</kbd>,
  'rk-cloze':({node:_node,...props}:Record<string,unknown>)=><ClozeReveal hint={String(props['data-hint']??props.dataHint??'')}>{props.children as React.ReactNode}</ClozeReveal>,
  'rk-comment':({node:_node,...props}:Record<string,unknown>)=><span className="rk-comment" data-rk-comment="">{props.children as React.ReactNode}</span>,
  'wiki-embed':({node:_node,...props}:Record<string,unknown>)=>
   <WikiEmbed target={wikiDecode(String(props['data-target']??''))}
    anchor={wikiDecode(String(props['data-anchor']??''))||null}
    sourceId={sourceId} trail={chain} depth={depth}
    render={(body,id,next,nextDepth)=><MarkdownPreview content={body} sourceId={id} trail={next} depth={nextDepth}/>}/>
 };
 return <article className="markdown-preview">
  {frontmatter&&<p className="rk-verbatim-document-text">{frontmatter[0]}</p>}
  <ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,richRemarkDirective,remarkFigureAttributes,remarkTableCaptions,()=>remarkCrossRefDisplay(prepared),()=>remarkRichTransforms(prepared),remarkCodeMetadata,remarkMarkedDisplayMath]}
   rehypePlugins={[rehypeRaw,rehypeAlignment,rehypeHeadingIds,[rehypeSanitize,schema],rehypeKatex]}
   components={{...components,...custom} as Components}>{parseSource}</ReactMarkdown>
 </article>;
}
