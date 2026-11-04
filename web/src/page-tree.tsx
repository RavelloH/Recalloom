import React,{createContext,useContext,useState,useSyncExternalStore} from 'react';
import {Link,useLocation,useNavigate} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import type {DropdownMenuOption} from '@astryxdesign/core/DropdownMenu';
import {ChevronRight,FileText,Folder,FolderOpen,ListTodo,Plus} from 'lucide-react';
import {browse} from './api';
import type {Entry} from './types';
import {createUntitled,type NewPageKind} from './create-page';
import {AutoResizer} from './motion-primitives';

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
 const Icon=folder?(open?FolderOpen:Folder):entry.kind==='task_list'?ListTodo:FileText;
 const label=<><Icon size={15} className="tree-icon"/><span className="truncate">{entry.name}</span></>;
 return <li>
  <div className={'tree-row'+(active?' is-active':'')} style={{'--tree-depth':depth} as React.CSSProperties}>
   {folder
    ?<button type="button" className={'tree-toggle'+(open?' is-open':'')} aria-label={(open?'收起 ':'展开 ')+entry.name} aria-expanded={open} onClick={()=>toggleFolder(entry.id)}><ChevronRight size={14}/></button>
    :<span className="tree-toggle is-leaf" aria-hidden="true"/>}
   {folder
    ?<Link to="/library/$folderId" params={{folderId:entry.id}} className="tree-link" onClick={onNavigate} aria-current={active?'page':undefined}>{label}</Link>
    :<Link to="/records/$recordId" params={{recordId:entry.id}} className="tree-link" onClick={onNavigate} aria-current={active?'page':undefined}>{label}</Link>}
   {folder&&<div className="tree-actions"><MoreMenu size="sm" variant="ghost" label={'在「'+entry.name+'」中新建'} icon={<Plus size={14}/>} items={createItems(entry.id)}/></div>}
  </div>
  {folder&&<AutoResizer duration={0.2}>{open&&<TreeChildren folderId={entry.id} depth={depth+1}/>}</AutoResizer>}
 </li>;
}

function TreeChildren({folderId,depth}:{folderId:string|null;depth:number}){
 const {onNavigate}=useContext(TreeContext);
 const q=useQuery({queryKey:['browse',folderId],queryFn:()=>browse(folderId)});
 const indent={'--tree-depth':depth} as React.CSSProperties;
 if(q.isPending)return <div className="tree-hint" style={indent}>加载中…</div>;
 if(q.isError)return <div className="tree-hint" style={indent}>无法加载此目录</div>;
 const items=q.data.items.filter(visible);
 return <ul className="tree-list">
  {items.map(entry=><TreeNode key={entry.id} entry={entry} depth={depth}/>)}
  {!items.length&&<li className="tree-hint" style={indent}>{folderId?'暂无页面':'知识库还是空的'}</li>}
  {q.data.page.hasMore&&<li className="tree-hint" style={indent}>{folderId
   ?<Link to="/library/$folderId" params={{folderId}} onClick={onNavigate} className="tree-more">查看全部…</Link>
   :<Link to="/library" onClick={onNavigate} className="tree-more">查看全部…</Link>}</li>}
 </ul>;
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
  {label:'新建文档',icon:<FileText size={15}/>,isDisabled:busy,onClick:()=>void create('document',parentId)},
  {label:'新建任务列表',icon:<ListTodo size={15}/>,isDisabled:busy,onClick:()=>void create('task_list',parentId)},
  {label:'新建文件夹',icon:<Folder size={15}/>,isDisabled:busy,onClick:()=>void create('folder',parentId)}
 ];
 return <TreeContext.Provider value={{createItems,onNavigate}}>
  <div className="nav-label nav-label-row tree-heading">
   <Link to="/library" onClick={onNavigate} className="tree-heading-link">知识库</Link>
   <MoreMenu size="sm" variant="ghost" label="在知识库根目录新建" icon={<Plus size={14}/>} items={createItems(null)}/>
  </div>
  <AutoResizer>{error&&<p className="tree-error" role="alert">{error}</p>}</AutoResizer>
  <nav aria-label="页面树" className="page-tree"><TreeChildren folderId={null} depth={0}/></nav>
 </TreeContext.Provider>;
}
