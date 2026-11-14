import {Icon} from './icon';
import {sharedViewTransitionName,sharedTitleAttributes,type SharedResourceKind} from './shared-view-transition';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {Token} from '@astryxdesign/core/Token';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Button} from '@astryxdesign/core/Button';

import {ApiError,api} from './api';
import {TopbarPortal} from './topbar-slot';
import {useCompactLayout,useMediaQuery} from './use-media';
import {AutoResizer,AutoTransition} from './motion-primitives';

/** Wide desktop actions belong to the shell topbar. Tablet widths keep the
 * complete action row inline beneath the document title so it cannot collide
 * with breadcrumbs; phones keep save actions pinned in the shell topbar. */
export function PageActions({className='',children,pinned}:{className?:string;children:React.ReactNode;pinned?:React.ReactNode}){
 const compact=useCompactLayout();
 const tabletActions=useMediaQuery('(max-width: 1200px)');
 const classes=('page-actions-bar '+className).trim();
 if(!tabletActions)return <TopbarPortal slot="end"><div className={classes}>{children}{pinned}</div></TopbarPortal>;
 // A tablet has an always-visible breadcrumb topbar but not enough width for
 // both breadcrumbs and the full editor mode/action bar. Keep the latter in
 // the document's scroll flow rather than covering the fixed topbar.
 if(!compact)return <div className={classes}>{children}{pinned}</div>;
 return <>
  <div className={classes}>{children}</div>
  {pinned&&<TopbarPortal slot="end"><div className="page-actions-bar page-actions-pinned">{pinned}</div></TopbarPortal>}
 </>;
}

export const errorMessage=(error:unknown)=>error instanceof ApiError
 ?error.status===409?(error.code==='PATH_CONFLICT'?'同一目录下已有同名页面。':'内容已被其他客户端修改，请刷新后重试。'):error.message
 :error instanceof Error?error.message:'操作失败';

type FolderNode={id:string;name:string;parentId:string|null};
/** Ancestor folders from the root down to folderId, walking parent links. */
export function useFolderTrail(folderId:string|null|undefined){
 return useQuery({
  queryKey:['folder-trail',folderId],enabled:Boolean(folderId),staleTime:30_000,
  queryFn:async()=>{
   const trail:FolderNode[]=[];
   let next:string|null=folderId??null;
   for(let depth=0;next&&depth<32;depth++){
    const folder:FolderNode=await api<FolderNode>('/folders/'+next);
    trail.unshift(folder);
    next=folder.parentId;
   }
   return trail;
  }
 });
}

export function Breadcrumbs({folderId,current}:{folderId:string|null|undefined;current?:string}){
 const trail=useFolderTrail(folderId);
 const folders=trail.data??[];
 return <nav className="crumbs" aria-label="页面路径">
  <Link to="/library" className="crumb">知识库</Link>
  {folders.map(folder=><React.Fragment key={folder.id}><Icon name="chevronRight" inline className="crumb-sep" aria-hidden="true"/><Link to="/library/$folderId" params={{folderId:folder.id}} className="crumb truncate" style={{viewTransitionName:sharedViewTransitionName('folder',folder.id)}}>{folder.name}</Link></React.Fragment>)}
  {folderId&&trail.isPending&&<><Icon name="chevronRight" inline className="crumb-sep" aria-hidden="true"/><span className="crumb muted">…</span></>}
  {current&&<><Icon name="chevronRight" inline className="crumb-sep" aria-hidden="true"/><span className="crumb crumb-current truncate" aria-current="page">{current}</span></>}
 </nav>;
}

/** Editable document title: Enter or blur commits a rename, Escape reverts. */
export function InlineTitle({value,onRename,placeholder='未命名',autoFocus=false,allowSlash=false,transitionName,transitionResource}:{value:string;onRename?:(name:string)=>Promise<void>;placeholder?:string;autoFocus?:boolean;allowSlash?:boolean;transitionName?:string;transitionResource?:{kind:SharedResourceKind;id:string}}){
 const ref=useRef<HTMLHeadingElement>(null);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 useLayoutEffect(()=>{const el=ref.current;if(el&&document.activeElement!==el)el.textContent=value;},[value]);
 useEffect(()=>{
  const el=ref.current;
  if(!autoFocus||!el)return;
  el.focus();
  const range=document.createRange();range.selectNodeContents(el);
  const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);
 },[autoFocus]);
 const commit=async()=>{
  const el=ref.current;
  if(!el||!onRename)return;
  const next=(el.textContent??'').replace(/\s+/g,' ').trim();
  if(!next||next===value){el.textContent=value;return;}
  if((!allowSlash&&/[\\/]/.test(next))||next.length>180){setError('名称需为 1–180 个字符，且不能包含 / 或 \\。');el.textContent=value;return;}
  setSaving(true);setError('');
  try{await onRename(next);}
  catch(e){setError(errorMessage(e));el.textContent=value;}
  finally{setSaving(false);}
 };
 return <div className="page-title-block">
  <h1 ref={ref} className={'page-title'+(onRename?' is-editable':'')} style={transitionName?{viewTransitionName:transitionName}:undefined} {...(transitionResource?sharedTitleAttributes(transitionResource.kind,transitionResource.id):{})} data-placeholder={placeholder}
   contentEditable={onRename&&!saving?'plaintext-only':false} suppressContentEditableWarning spellCheck={false}
   onKeyDown={event=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
    if(event.key==='Escape'){event.currentTarget.textContent=value;event.currentTarget.blur();}
   }}
   onBlur={()=>void commit()}/>
  <AutoResizer><AutoTransition transitionKey={error||'none'}>{error&&<p className="page-title-error" role="alert">{error}</p>}</AutoTransition></AutoResizer>
 </div>;
}

export function Properties({children}:{children:React.ReactNode}){
 return <dl className="page-properties">{children}</dl>;
}
export function Property({label,children}:{label:string;children:React.ReactNode}){
 return <div className="property-row"><dt className="property-label">{label}</dt><dd className="property-value">{children}</dd></div>;
}

export function TagEditor({tags,onChange}:{tags:string[];onChange:(tag:string,action:'add'|'remove')=>Promise<void>}){
 const [adding,setAdding]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=async(tag:string,action:'add'|'remove')=>{
  setBusy(true);setError('');
  try{await onChange(tag,action);}
  catch(e){setError(errorMessage(e));}
  finally{setBusy(false);}
 };
 const submit=async()=>{
  const tag=draft.trim().toLowerCase();
  setDraft('');setAdding(false);
  if(!tag||tags.includes(tag))return;
  if(tag.length>64){setError('标签不能超过 64 个字符。');return;}
  await run(tag,'add');
 };
 return <div className="tag-editor">
  {tags.map(tag=><Token key={tag} size="sm" label={tag} isDisabled={busy} onRemove={()=>void run(tag,'remove')}/>)}
  {adding
   ?<div className="tag-input" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))void submit();}}>
     <TextInput label="新标签" isLabelHidden size="sm" width={160} hasAutoFocus placeholder="输入后回车" value={draft} onChange={setDraft} onEnter={()=>void submit()} onKeyDown={event=>{if(event.key==='Escape'){setDraft('');setAdding(false);}}}/>
    </div>
   :<Button label="添加标签" className="property-add" size="sm" variant="ghost" isIconOnly={tags.length>0} icon={<Icon name="plus" size="sm"/>} isDisabled={busy} onClick={()=>setAdding(true)}/>}
  {error&&<span className="property-error" role="alert">{error}</span>}
 </div>;
}
