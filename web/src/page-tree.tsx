import {Icon} from './icon';
import {markSharedNavigationSource} from './shared-view-transition';
import React,{createContext,useContext,useEffect,useState,useSyncExternalStore} from 'react';
import {Link,useLocation,useNavigate} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {IconButton} from '@astryxdesign/core/IconButton';
import type {DropdownMenuOption} from '@astryxdesign/core/DropdownMenu';

import {browse} from './api';
import type {Entry} from './types';
import {createUntitled,type NewPageKind} from './create-page';
import {documentDisplayName} from './document-filename';

const storageKey='recalloom:tree-open';
const listeners=new Set<()=>void>();
let openIds:ReadonlySet<string>=loadOpen();
// Explicit user collapses take precedence over background record refreshes.
const manuallyClosed=new Set<string>();
function loadOpen():ReadonlySet<string>{
 try{
  const value:unknown=JSON.parse(localStorage.getItem(storageKey)??'[]');
  return new Set(Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'):[]);
 }catch{return new Set();}
}
function setOpen(next:Set<string>){
 openIds=next;
 try{localStorage.setItem(storageKey,JSON.stringify([...next].slice(-300)));}catch{ /* storage may be unavailable */ }
 listeners.forEach(fn=>fn());
}
const useOpenIds=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>openIds,()=>openIds);
function toggleFolder(id:string){
 const next=new Set(openIds);
 if(next.has(id)){next.delete(id);manuallyClosed.add(id);}
 else{next.add(id);manuallyClosed.delete(id);}
 setOpen(next);
}
export function revealFolder(id:string|null|undefined,force=false){
 if(id&&(!manuallyClosed.has(id)||force)&&!openIds.has(id)){
  if(force)manuallyClosed.delete(id);
  setOpen(new Set([...openIds,id]));
 }
}

type TreeActions={createItems:(parentId:string|null)=>DropdownMenuOption[];onNavigate?:()=>void};
const TreeContext=createContext<TreeActions>({createItems:()=>[]});
const visible=(entry:Entry)=>entry.entityType==='folder'||entry.status!=='archived';

function TreeNode({entry,depth}:{entry:Entry;depth:number}){
 const {createItems,onNavigate}=useContext(TreeContext);
 const open=useOpenIds().has(entry.id);
 const pathname=useLocation({select:state=>state.pathname});
 const folder=entry.entityType==='folder';
 const active=pathname===(folder?'/library/':'/records/')+entry.id;
 const icon=folder?(open?"folderOpen":"folder"):entry.kind==='task_list'?"taskList":"document";
 const clean=entry.kind==='document'?documentDisplayName(entry.name):entry.name;
 const label=<><Icon name={icon} size="md" className="tree-icon" aria-hidden="true"/><span className="truncate"><span>{clean}</span>{entry.kind==='document'&&/\.md$/i.test(entry.name)&&<span className="rk-shared-extension">{entry.name.slice(-3)}</span>}</span></>;
 return <li>
  <div className={'tree-row'+(active?' is-active':'')} style={{'--tree-depth':depth} as React.CSSProperties}>
   {folder
    ?<IconButton label={(open?'收起 ':'展开 ')+entry.name} variant="ghost" size="sm" className={'tree-toggle'+(open?' is-open':'')} aria-expanded={open} onClick={()=>toggleFolder(entry.id)} icon={<Icon name="chevronRight"/>}/>
    :<span className="tree-toggle is-leaf" aria-hidden="true"/>}
   {folder
    ?<Link to="/library/$folderId" params={{folderId:entry.id}} className="tree-link" onClick={()=>{markSharedNavigationSource('sidebar');onNavigate?.();}} aria-current={active?'page':undefined}>{label}</Link>
    :<Link to="/records/$recordId" params={{recordId:entry.id}} className="tree-link" onClick={()=>{markSharedNavigationSource('sidebar');onNavigate?.();}} aria-current={active?'page':undefined}>{label}</Link>}
   {folder&&<div className="tree-actions"><MoreMenu size="sm" variant="ghost" label={'在「'+entry.name+'」中新建'} icon={<Icon name="plus"/>} items={createItems(entry.id)}/></div>}
  </div>
  {folder&&<TreeBranch folderId={entry.id} depth={depth+1} open={open}/>}
 </li>;
}

type TreeData=Awaited<ReturnType<typeof browse>>;

/** Do not show a short-lived "加载中…" row as an expanded folder. Wait
 * for its data, mount the real rows inside a collapsed grid, then reveal it
 * on a later frame. Keep the children during collapse so 1fr -> 0fr can
 * actually animate, instead of removing them before the transition starts. */
function TreeBranch({folderId,depth,open}:{folderId:string;depth:number;open:boolean}){
 const q=useQuery({queryKey:['browse',folderId],queryFn:()=>browse(folderId),enabled:open,staleTime:30_000});
 const ready=Boolean(q.data)||q.isError;
 const [mounted,setMounted]=useState(false);
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{
  if(!open||!ready){setExpanded(false);return;}
  setMounted(true);
  // The collapsed content must reach layout before grid-template-rows changes.
  let second=0;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setExpanded(true));});
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
 },[open,ready]);
 useEffect(()=>{
  if(open||!mounted)return;
  // Includes reduced-motion and interrupted transitions with no transitionend.
  const timeout=window.setTimeout(()=>setMounted(false),260);
  return()=>clearTimeout(timeout);
 },[open,mounted]);
 return <div className="tree-branch-region" data-visible={expanded} data-loading={open&&!ready?"true":undefined}
  aria-hidden={!expanded}
  onTransitionEnd={event=>{
   if(event.target===event.currentTarget&&event.propertyName==='grid-template-rows'&&!open)setMounted(false);
  }}>
  <div className="tree-branch-inner">{mounted&&(q.data?<TreeItems data={q.data} folderId={folderId} depth={depth}/>:
   q.isError?<div className="tree-hint" style={{'--tree-depth':depth} as React.CSSProperties}>无法加载此目录</div>:null)}</div>
 </div>;
}

function TreeItems({folderId,depth,data}:{folderId:string|null;depth:number;data:TreeData}){
 const {onNavigate}=useContext(TreeContext);
 const items=data.items.filter(visible);
 const indent={'--tree-depth':depth} as React.CSSProperties;
 return <ul className="tree-list">
  {items.map(entry=><TreeNode key={entry.id} entry={entry} depth={depth}/>)}
  {!items.length&&<li className="tree-hint" style={indent}>{folderId?'暂无页面':'知识库还是空的'}</li>}
  {data.page.hasMore&&<li className="tree-hint" style={indent}>{folderId
   ?<Link to="/library/$folderId" params={{folderId}} onClick={onNavigate} className="tree-more">查看全部…</Link>
   :<Link to="/library" onClick={onNavigate} className="tree-more">查看全部…</Link>}</li>}
 </ul>;
}

function TreeChildren({folderId,depth}:{folderId:string|null;depth:number}){
 const q=useQuery({queryKey:['browse',folderId],queryFn:()=>browse(folderId)});
 const indent={'--tree-depth':depth} as React.CSSProperties;
 if(q.isPending)return <div className="tree-hint" style={indent}>加载中…</div>;
 if(q.isError)return <div className="tree-hint" style={indent}>无法加载此目录</div>;
 return <TreeItems data={q.data} folderId={folderId} depth={depth}/>;
}

export function PageTree({onNavigate}:{onNavigate?:()=>void}){
 const qc=useQueryClient(),navigate=useNavigate();
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const create=async(kind:NewPageKind,parentId:string|null)=>{
  if(busy)return;
  setBusy(true);setError('');
  try{
   const id=await createUntitled(qc,kind,parentId);
   revealFolder(parentId,true);
   onNavigate?.();
   if(kind==='folder')await navigate({to:'/library/$folderId',params:{folderId:id}});
   else await navigate({to:'/records/$recordId',params:{recordId:id}});
  }catch(e){setError(e instanceof Error?e.message:'创建失败');}
  finally{setBusy(false);}
 };
 const createItems=(parentId:string|null):DropdownMenuOption[]=>[
  {label:'新建文档',icon:<Icon name="document" size="sm"/>,isDisabled:busy,onClick:()=>void create('document',parentId)},
  {label:'新建任务列表',icon:<Icon name="taskList" size="sm"/>,isDisabled:busy,onClick:()=>void create('task_list',parentId)},
  {label:'新建文件夹',icon:<Icon name="folder" size="sm"/>,isDisabled:busy,onClick:()=>void create('folder',parentId)}
 ];
 return <TreeContext.Provider value={{createItems,onNavigate}}>
  <div className="nav-label nav-label-row tree-heading">
   <Link to="/library" onClick={onNavigate} className="tree-heading-link">知识库</Link>
   <MoreMenu size="sm" variant="ghost" label="在知识库根目录新建" icon={<Icon name="plus"/>} items={createItems(null)}/>
  </div>
  <div className="tree-error-region" data-visible={Boolean(error)}><div className="tree-error-inner">{error&&<p className="tree-error" role="alert">{error}</p>}</div></div>
  <nav aria-label="页面树" className="page-tree"><TreeChildren folderId={null} depth={0}/></nav>
 </TreeContext.Provider>;
}
