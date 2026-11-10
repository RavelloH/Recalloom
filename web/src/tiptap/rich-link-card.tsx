import React,{useEffect,useRef,useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {Card} from '@astryxdesign/core/Card';
import {IconExternalLink,IconLink} from '@tabler/icons-react';
import {normalizedLinkUrl,resolveLinkMetadata,proxyImageUrl,type LinkPreviewMetadata} from '../link-metadata-client';
import {normalizeLeafFields} from './rmd-leaf-attributes';

export function LinkCardView({url,title,titleEditor}:{
 url:string;title?:string;titleEditor?:(visibleTitle:string)=>React.ReactNode;
}){
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
    {titleEditor?titleEditor(displayTitle):<div className="rk-link-card-title">{displayTitle}</div>}
    {data?.description&&<p className="rk-link-card-desc">{data.description}</p>}
    {!loaded&&<div className="rk-link-card-loading">正在获取链接信息…</div>}
    {valid?<a href={url} target="_blank" rel="noopener noreferrer" className="rk-link-card-open">{domain||'打开链接'} <IconExternalLink size="1em" aria-hidden="true"/></a>
     :<span className="rk-link-card-loading">请添加有效的 HTTP(S) 地址</span>}
   </div>
   {preview&&!imageError&&<img src={preview} className="rk-link-card-image" alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setImageError(true)}/>}
  </div>
 </Card>;
}
function LinkCardEditorView({node,updateAttributes}:NodeViewProps){
 const url=String(node.attrs.url??''),title=String(node.attrs.title??'');
 const text=useRef<HTMLDivElement|null>(null);
 const editing=useRef(false);
 const initial=useRef('');
 const [frozenTitle,setFrozenTitle]=useState<string|null>(null);
 const finish=(save:boolean)=>{
  if(!editing.current)return;
  editing.current=false;
  const visible=text.current?.textContent??'';
  const next=visible.replace(/[\r\n]/g,' ');
  const valid=normalizeLeafFields('richLinkCard','title',next);
  if(save&&next!==initial.current&&valid.ok&&valid.attrs.title!==title)
   updateAttributes(valid.attrs);
  else if(text.current&&(!save||!valid.ok))text.current.textContent=initial.current;
  setFrozenTitle(null);
 };
 return <NodeViewWrapper contentEditable={false} className="rk-rich-link-card" data-rk-link-card="">
  <LinkCardView url={url} title={title} titleEditor={display=>
   <div ref={text} className="rk-link-card-title rk-link-card-direct-title"
    contentEditable suppressContentEditableWarning role="textbox"
    aria-label="直接编辑链接卡片标题" aria-multiline={false}
    spellCheck tabIndex={0} title="点击文字原位修改链接卡片标题"
    onPointerDown={event=>event.stopPropagation()}
    onClick={event=>event.stopPropagation()}
    onFocus={()=>{editing.current=true;initial.current=display;setFrozenTitle(display);}}
    onBlur={()=>finish(true)}
    onKeyDown={event=>{
     event.stopPropagation();if(event.nativeEvent.isComposing)return;
     if(event.key==='Enter'){event.preventDefault();finish(true);event.currentTarget.blur();}
     if(event.key==='Escape'){event.preventDefault();finish(false);event.currentTarget.blur();}
    }}>{frozenTitle??display}</div>}/>
 </NodeViewWrapper>;
}
export const RichLinkCard=Node.create({
 name:'richLinkCard',group:'block',atom:true,draggable:true,selectable:true,priority:195,
 addAttributes(){return {url:{default:''},title:{default:''}};},
 parseHTML(){return [{tag:'div[data-rk-link-card]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-rk-link-card':''})];},
 addNodeView(){return ReactNodeViewRenderer(LinkCardEditorView);}
});
