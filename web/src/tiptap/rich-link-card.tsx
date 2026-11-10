import React,{useEffect,useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {Card} from '@astryxdesign/core/Card';
import {IconExternalLink,IconLink} from '@tabler/icons-react';
import {normalizedLinkUrl,resolveLinkMetadata,proxyImageUrl,type LinkPreviewMetadata} from '../link-metadata-client';

export function LinkCardView({url,title,onEdit}:{url:string;title?:string;onEdit?:()=>void}){
 const [data,setData]=useState<LinkPreviewMetadata|null>(null);
 const [loaded,setLoaded]=useState(false);
 const [imageError,setImageError]=useState(false);
 const [iconError,setIconError]=useState(false);
 const valid=normalizedLinkUrl(url);
 useEffect(()=>{
  let live=true;setData(null);setLoaded(false);setImageError(false);setIconError(false);
  if(!valid){setLoaded(true);return;}
  void resolveLinkMetadata(valid).then(result=>{if(live){setData(result);setLoaded(true);}});
  return()=>{live=false;};
 },[valid]);
 const displayTitle=title||data?.title||data?.siteName||valid||'链接卡片';
 const domain=valid?new URL(valid).hostname.replace(/^www\./,''):'';
 const preview=data?.image?proxyImageUrl(data.image):null;
 const icon=data?.icon?proxyImageUrl(data.icon,valid):null;
 return <Card variant="default" padding={3} className="rk-link-card">
  <div className="rk-link-card-row">

   <div className="rk-link-card-text">
    <div className="rk-link-card-head">
     {icon&&!iconError?<img className="rk-site-favicon" src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setIconError(true)}/>:<IconLink size="var(--rk-icon-sm)" aria-hidden="true"/>}
     <span>{data?.siteName||domain||'外部链接'}</span>
    </div>
    <div className="rk-link-card-title" role={onEdit?'button':undefined} tabIndex={onEdit?0:undefined}
     aria-label={onEdit?'编辑链接卡片':undefined} title={onEdit?'点击编辑链接卡片属性':undefined}
     onClick={onEdit?event=>{event.stopPropagation();onEdit();}:undefined}
     onKeyDown={onEdit?event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onEdit();}
     }:undefined}>{displayTitle}</div>
    {data?.description&&<p className="rk-link-card-desc">{data.description}</p>}
    {!loaded&&<div className="rk-link-card-loading">正在获取链接信息…</div>}
    {valid?<a href={url} target="_blank" rel="noopener noreferrer" className="rk-link-card-open">{domain||'打开链接'} <IconExternalLink size="1em" aria-hidden="true"/></a>
     :<span className="rk-link-card-loading">请添加有效的 HTTP(S) 地址</span>}
   </div>
   {preview&&!imageError&&<img src={preview} className="rk-link-card-image" alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setImageError(true)}/>}
  </div>
 </Card>;
}
function LinkCardEditorView({node,editor,getPos}:NodeViewProps){
 const url=String(node.attrs.url??''),title=String(node.attrs.title??'');
 const open=()=>{
  const pos=getPos();if(typeof pos!=='number')return;
  editor.view.dom.dispatchEvent(new CustomEvent('rmd-open-block-editor',{detail:{pos}}));
 };
 return <NodeViewWrapper contentEditable={false} className="rk-rich-link-card" data-rk-link-card="">
  <LinkCardView url={url} title={title} onEdit={open}/>
 </NodeViewWrapper>;
}
export const RichLinkCard=Node.create({
 name:'richLinkCard',group:'block',atom:true,draggable:true,selectable:true,priority:195,
 addAttributes(){return {url:{default:''},title:{default:''}};},
 parseHTML(){return [{tag:'div[data-rk-link-card]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-rk-link-card':''})];},
 addNodeView(){return ReactNodeViewRenderer(LinkCardEditorView);}
});
