import React,{useEffect,useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import type {JSONContent} from '@tiptap/core';
import {Card} from '@astryxdesign/core/Card';
import {TextInput} from '@astryxdesign/core/TextInput';
import {IconButton} from '@astryxdesign/core/IconButton';
import {ExternalLink,Link2,Pencil} from 'lucide-react';
import {normalizedLinkUrl,resolveLinkMetadata,proxyImageUrl,type LinkPreviewMetadata} from '../link-metadata-client';

function safeDirectiveValue(value:string):string{
 return value.replace(/[\r\n"{}]/g,' ').trim().slice(0,2048);
}
export function LinkCardView({url,title}:{url:string;title?:string}){
 const [data,setData]=useState<LinkPreviewMetadata|null>(null);
 const [loaded,setLoaded]=useState(false);
 const [imageError,setImageError]=useState(false);
 const valid=normalizedLinkUrl(url);
 useEffect(()=>{
  let live=true;setData(null);setLoaded(false);setImageError(false);
  if(!valid){setLoaded(true);return;}
  void resolveLinkMetadata(valid).then(result=>{if(live){setData(result);setLoaded(true);}});
  return()=>{live=false;};
 },[valid]);
 const displayTitle=title||data?.title||data?.siteName||valid||'链接卡片';
 const preview=data?.image?proxyImageUrl(data.image):null;
 const icon=data?.icon?proxyImageUrl(data.icon,valid):null;
 return <Card variant="default" padding={3} className="rk-link-card">
  <div className="rk-link-card-row">
   {preview&&!imageError&&<img src={preview} className="rk-link-card-image" alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setImageError(true)}/>}
   <div className="rk-link-card-text">
    <div className="rk-link-card-head">
     {icon?<img className="rk-site-favicon" src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none';}}/>:<Link2 size={16} aria-hidden="true"/>}
     <span>{data?.siteName||'外部链接'}</span>
    </div>
    <div className="rk-link-card-title">{displayTitle}</div>
    {data?.description&&<p className="rk-link-card-desc">{data.description}</p>}
    {!loaded&&<div className="rk-link-card-loading">正在获取链接信息…</div>}
    {valid?<a href={url} target="_blank" rel="noopener noreferrer" className="rk-link-card-open">打开链接 <ExternalLink size={14} aria-hidden="true"/></a>
     :<span className="rk-link-card-loading">请添加有效的 HTTP(S) 地址</span>}
   </div>
  </div>
 </Card>;
}
function LinkCardEditorView({node,updateAttributes}:NodeViewProps){
 const url=String(node.attrs.url??''),title=String(node.attrs.title??'');
 const [draft,setDraft]=useState(url);
 const [edit,setEdit]=useState(false);
 const save=()=>{const normalized=draft.trim();if(normalized!==url)updateAttributes({url:normalized.slice(0,2048)});setEdit(false);};
 return <NodeViewWrapper contentEditable={false} className="rk-rich-link-card" data-rk-link-card="">
  <LinkCardView url={url} title={title}/>
  {edit?<TextInput label="链接卡片 URL" value={draft} onChange={setDraft} onBlur={save}
    onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();save();}else if(event.key==='Escape'){setDraft(url);setEdit(false);}}}/>
   :<IconButton label="编辑链接地址" variant="ghost" size="sm" icon={<Pencil size={15}/>} onClick={()=>{setDraft(url);setEdit(true);}}/>}
 </NodeViewWrapper>;
}
export const RichLinkCard=Node.create({
 name:'richLinkCard',group:'block',atom:true,draggable:true,selectable:true,priority:195,
 addAttributes(){return {url:{default:''},title:{default:''}};},
 parseHTML(){return [{tag:'div[data-rk-link-card]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-rk-link-card':''})];},
 addNodeView(){return ReactNodeViewRenderer(LinkCardEditorView);},
 renderMarkdown(node:JSONContent){
  const url=safeDirectiveValue(String(node.attrs?.url??''));
  const title=safeDirectiveValue(String(node.attrs?.title??''));
  return '::link-card'+(title?'['+title.replace(/[\[\]]/g,'')+']':'')+'{url="'+url+'"}';
 }
});
