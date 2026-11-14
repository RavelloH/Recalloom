import React,{useMemo,useRef} from 'react';
// Preview is a lazily loaded route. The shared RMD component stylesheet must
// also be loaded here; importing it only from VisualEditor loses highlight
// colors, interactive rich component styling and layout on direct preview.
import './styles/features/rmd.css';
import './tiptap/editor.css';
import ReactMarkdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import {remarkRmdSyntax} from './rmd-remark';
import {useSketchAnnotations} from './sketch-annotations';
import {isSketchKind} from './sketch-geometry';
import {prepareMarkdownPreview,rehypeAlignment,rehypeHeadingIds,previewSchema,scopedPreviewIds} from './markdown-preview-pipeline';
import {revisionWordHighlight} from './revision-word-highlight';
import {richTitle} from './tiptap/rich-schema';
import {calloutIcon} from './callout-icon';
import {asAstryBadgeVariant} from './rmd-badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Badge} from '@astryxdesign/core/Badge';
import {Card} from '@astryxdesign/core/Card';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {RmdChatMessage,RmdChatTranscript} from './rmd-chat';
import {SmartLink} from './link-icons';
import {LinkCardView} from './tiptap/rich-link-card';
import {TabsPreview} from './rich-tabs';
import FlashcardPreview from './flashcard-preview';

import ShikiCodePreview,{codePropsFromElement} from './code-preview';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {OverlayScroll} from './scrollbars';


import type {CriticKind} from './critic-syntax';
import {CriticDisplay} from './tiptap/rich-critic';
import ClozeReveal from './cloze-reveal';


import {collectRmdPreviewRefs} from './rmd-cross-reference';
import {validCrossRefId} from './cross-reference';
import {isRmdId} from './rmd-schema';
import {safeFigureImageSrc} from './figure-syntax';
import {WikiInline,WikiEmbed,wikiDecode} from './wiki-components';
import {headingAnchor} from './wiki-slug';

// Wide blocks scroll inside the column with the same overlay scrollbar as the editor.
const components:Components={
 a:({node:_node,...props})=><SmartLink {...props}/>,
 table:({node:_node,...props})=>{
  const values=props as Record<string,unknown>;
  const caption=String(values['data-rmd-caption']??values.dataRmdCaption??'');
  return <div className="rk-rmd-table-projection">
   <OverlayScroll axis="x" edges className="tableWrapper rk-hscroll"><table {...props}/></OverlayScroll>
   {caption&&<div className="rk-table-caption-read">{caption}</div>}
  </div>;
 },
 pre:({node:_node,children})=><ShikiCodePreview {...codePropsFromElement(React.Children.toArray(children)[0])}/>
};

/** Safe, read-only preview: GFM, math, and bounded wiki transclusion. */
export default function MarkdownPreview({content,sourceId,trail,depth=0,referenceIndex,comparison,isRevisionPreview=false,idScope}:{
 content:string;sourceId?:string;trail?:string[];depth?:number;
 referenceIndex?:ReturnType<typeof collectRmdPreviewRefs>;comparison?:{content:string;side:'added'|'removed'}
 isRevisionPreview?:boolean;idScope?:string;
}){
 const sketchRef=useRef<HTMLElement>(null);
 useSketchAnnotations(sketchRef,true,content);
 const {frontmatter,body:syntaxSource,analysis,parseSource}=useMemo(()=>prepareMarkdownPreview(content),[content]);
 const refIndex=useMemo(()=>referenceIndex??collectRmdPreviewRefs(syntaxSource,analysis),[referenceIndex,syntaxSource,analysis]);
 const highlight=useMemo(()=>comparison?revisionWordHighlight(comparison.content,comparison.side):null,[comparison?.content,comparison?.side]);
 const scopeIds=useMemo(()=>idScope?scopedPreviewIds(idScope):null,[idScope]);
 const anchor=(id:string)=>(idScope??'')+headingAnchor(id);
 const chain=trail??(sourceId?[sourceId]:[]);
 const custom={
  'rk-sketch':({node:_node,...props}:Record<string,unknown>)=>{
   const get=(key:string)=>props['data-rk-sketch-'+key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())]??props['dataRkSketch'+key[0]!.toUpperCase()+key.slice(1)];
   const kind=String(get('kind')??'');if(!isSketchKind(kind))return <>{props.children as React.ReactNode}</>;
   return <span className="rk-sketch-inline" data-rk-sketch-kind={kind}
    data-rk-sketch-color={String(get('color')??'')||undefined}
    data-rk-sketch-stroke={get('stroke')??undefined}
    data-rk-sketch-padding={get('padding')??undefined}
    data-rk-sketch-roughness={get('roughness')??undefined}
    data-rk-sketch-opacity={get('opacity')??undefined}>{props.children as React.ReactNode}</span>;
  },
  'rk-sketch-block':({node:_node,...props}:Record<string,unknown>)=>{
   const get=(key:string)=>props['data-rk-sketch-'+key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())]??props['dataRkSketch'+key[0]!.toUpperCase()+key.slice(1)];
   const kind=String(get('kind')??'');if(!isSketchKind(kind))return <>{props.children as React.ReactNode}</>;
   const rawId=String(props['data-id']??props.dataId??'');
   return <section id={isRmdId(rawId)?anchor(rawId):undefined} className="rk-sketch-block" data-rk-sketch-kind={kind}
    data-rk-sketch-color={String(get('color')??'')||undefined}
    data-rk-sketch-stroke={get('stroke')??undefined}
    data-rk-sketch-padding={get('padding')??undefined}
    data-rk-sketch-roughness={get('roughness')??undefined}
    data-rk-sketch-opacity={get('opacity')??undefined}
    data-rk-sketch-math-only={String(get('mathOnly')??'')==='true'?'true':undefined}>
     <div className="rk-sketch-content">{props.children as React.ReactNode}</div>
    </section>;
  },
  'wiki-ref':({node:_node,...props}:Record<string,unknown>)=>
    isRevisionPreview?<span className="wiki-link">{wikiDecode(String(props['data-alias']??''))||wikiDecode(String(props['data-target']??''))}</span>:<WikiInline target={wikiDecode(String(props['data-target']??''))}
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
   return <figure id={id?anchor(id):undefined} data-rk-figure-id={id??undefined} className="rk-rich-figure rk-rich-figure-projection">
    <img src={attrs.src} alt={String(attrs.alt??'')} title={String(attrs.title??'')||undefined}
     loading="lazy" referrerPolicy="no-referrer" style={{width:width?width+'px':undefined,height:height?height+'px':undefined,objectFit:'contain'}}/>
    {(caption||number)&&<figcaption className="rk-rich-figcaption">{number&&<strong className="rk-cross-caption-number">{number}{caption?'：':''}</strong>}{caption}</figcaption>}
   </figure>;
  },
    'rk-cross-ref':({node:_node,...props}:Record<string,unknown>)=>{
   const id=String(props['data-id']??props.dataId??'');
   if(!isRmdId(id))return null;
   const item=refIndex.get(id);
   return item?isRevisionPreview?<span className="rk-cross-reference-read">{item.label}</span>:<a href={'#'+anchor(id)} className="rk-cross-reference-read">{item.label}</a>
    :<span className="rk-cross-reference-read rk-cross-reference-missing" title={'缺少目标块 '+id}>{'引用不存在：'+id}</span>;
  },
  'rk-numbered-math':({node:_node,...props}:Record<string,unknown>)=>{
   const id=String(props['data-id']??props.dataId??'');
   if(!validCrossRefId(id,'eq'))return null;
   const item=refIndex.get(id);
   return <div className="rk-numbered-math-projection" id={anchor(id)} data-rk-equation-id={id}>
    <div className="rk-numbered-math-content">{props.children as React.ReactNode}</div>
    {item?.kind==='eq'&&item.number!==undefined&&<span className="rk-numbered-math-label">({item.number})</span>}
   </div>;
  },
  'rk-link-card':({node:_node,...props}:Record<string,unknown>)=>isRevisionPreview?<div className="revision-diff-link-card"><strong>{String(props['data-title']??props.dataTitle??'')||'链接卡片'}</strong><span>{String(props['data-url']??props.dataUrl??'')}</span></div>:<div className="rk-rich-link-card"><LinkCardView url={String(props['data-url']??props.dataUrl??'')} title={String(props['data-title']??props.dataTitle??'')}/></div>,
  'rk-callout':({node:_node,...props}:Record<string,unknown>)=>{
   const kind=String(props['data-kind']??props.dataKind??'info'),title=String(props['data-title']??props.dataTitle??'');
   const rawId=String(props['data-id']??props.dataId??'');
   const content=()=>{
   if(kind==='flashcard')return <FlashcardPreview title={title}>{props.children as React.ReactNode}</FlashcardPreview>;
   if(kind==='front')return <Card variant="muted" padding={3} className="rk-flashcard-panel rk-flashcard-front">
    <div className="rk-flashcard-panel-title">{richTitle(kind,title)}</div>
    <div className="rk-flashcard-content">{props.children as React.ReactNode}</div>
   </Card>;
   if(kind==='back')return <Card variant="muted" padding={3} className="rk-flashcard-panel rk-flashcard-back">
    <div className="rk-flashcard-panel-title">{richTitle(kind,title)}</div>
    <div className="rk-flashcard-content">{props.children as React.ReactNode}</div>
   </Card>;
   if(kind==='glossary')return <Card variant="muted" padding={3} className="rk-glossary-read">
    <div className="rk-glossary-title">{richTitle(kind,title)}</div>
    <div className="rk-glossary-entries">{props.children as React.ReactNode}</div>
   </Card>;
   if(kind==='definition')return <dl className="rk-definition-read">
    <dt className="rk-definition-term">{richTitle(kind,title)}</dt>
    <dd className="rk-definition-body">{props.children as React.ReactNode}</dd>
   </dl>;
   if(kind==='tabs')return <TabsPreview title={title}>{props.children as React.ReactNode}</TabsPreview>;
   if(kind==='tab')return <div className="rk-tab-pane">{props.children as React.ReactNode}</div>;
   if(kind==='chat')return <RmdChatTranscript title={title}>{props.children as React.ReactNode}</RmdChatTranscript>;
   if(kind==='message'){
    const rawSender=String(props['data-sender']??props.dataSender??'assistant');
    const sender=rawSender==='user'?'user':rawSender==='system'?'system':'assistant';
    return <RmdChatMessage sender={sender} name={richTitle(kind,title)}>{props.children as React.ReactNode}</RmdChatMessage>;
   }
   if(kind==='details')return <Collapsible trigger={richTitle(kind,title)} defaultIsOpen>{props.children as React.ReactNode}</Collapsible>;
   const status=kind==='danger'?'error':kind==='warning'?'warning':kind==='success'?'success':'info';
   return <div className="rk-rmd-callout" data-rk-kind={kind}><Banner status={status} icon={calloutIcon(kind)} title={richTitle(kind,title)} collapsible={false} container="card">{props.children as React.ReactNode}</Banner></div>;
   };
   return isRmdId(rawId)?<div id={anchor(rawId)} data-rk-container-id={rawId}>{content()}</div>:content();
  },
  'rk-rmd-block-mark':({node:_node,...props}:Record<string,unknown>)=><section id={isRmdId(String(props['data-id']??props.dataId??''))?anchor(String(props['data-id']??props.dataId)):undefined} className={'rk-rmd-block-mark'+((props['data-rk-math-only']??props.dataRkMathOnly)==='true'?' rk-rmd-mark-math-only':'')} data-rk-color={props['data-rk-color']??props.dataRkColor??undefined}>{props.children as React.ReactNode}</section>,
  'rk-badge':({node:_node,...props}:Record<string,unknown>)=>{
   const raw=String(props['data-variant']??props.dataVariant??'neutral');
   return <Badge variant={asAstryBadgeVariant(raw)} label={props.children as React.ReactNode}/>;
  },
  'rk-abbr':({node:_node,...props}:Record<string,unknown>)=>{
   const description=String(props['data-title']??props.dataTitle??'');
   return <span className="rk-tooltip-inline rk-inline-abbr" tabIndex={0}
    data-rk-tooltip={description||undefined} aria-label={description?'查看解释：'+description:undefined}>{props.children as React.ReactNode}</span>;
  },
  'rk-tooltip':({node:_node,...props}:Record<string,unknown>)=>{
   const description=String(props['data-content']??props.dataContent??'');
   return <span className="rk-tooltip-inline rk-inline-tooltip" tabIndex={0}
    data-rk-tooltip={description||undefined} aria-label={description?'查看解释：'+description:undefined}>{props.children as React.ReactNode}</span>;
  },
  'rk-kbd':({node:_node,...props}:Record<string,unknown>)=><kbd className="rk-keycap">{props.children as React.ReactNode}</kbd>,
  'rk-cloze':({node:_node,...props}:Record<string,unknown>)=><ClozeReveal hint={String(props['data-hint']??props.dataHint??'')}>{props.children as React.ReactNode}</ClozeReveal>,
  'rk-comment':({node:_node,...props}:Record<string,unknown>)=><span className="rk-comment" data-rk-comment="">{props.children as React.ReactNode}</span>,
  'wiki-embed':({node:_node,...props}:Record<string,unknown>)=>
    isRevisionPreview?<div className="revision-diff-embed"><strong>嵌入文档</strong><code>{wikiDecode(String(props['data-target']??''))}{props['data-anchor']?' #'+wikiDecode(String(props['data-anchor'])):''}</code><span>此处仅比较嵌入引用。</span></div>:<WikiEmbed target={wikiDecode(String(props['data-target']??''))}
    anchor={wikiDecode(String(props['data-anchor']??''))||null}
    sourceId={sourceId} trail={chain} depth={depth}
    render={(body,id,next,nextDepth)=><MarkdownPreview content={body} sourceId={id} trail={next} depth={nextDepth}/>}/>
 };
 return <article className="markdown-preview" ref={sketchRef}>
  {frontmatter&&<p className="rk-verbatim-document-text">{frontmatter}</p>}
  <ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,()=>remarkRmdSyntax(syntaxSource,analysis)]}
   rehypePlugins={[rehypeRaw,rehypeAlignment,rehypeHeadingIds,[rehypeSanitize,previewSchema],...(scopeIds?[scopeIds]:[]),...(highlight?[highlight]:[]),rehypeKatex]}
   components={{...components,...custom} as Components}>{parseSource}</ReactMarkdown>
 </article>;
}
