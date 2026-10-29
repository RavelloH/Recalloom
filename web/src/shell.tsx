import React,{useEffect,useState} from 'react';
import {Link,useNavigate} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {PanelLeft,FileText,FolderOpen,ListTodo,Search,History,Settings,LogOut,Menu,X,ChevronRight,SunMoon,Command,LayoutDashboard,Plus} from 'lucide-react';
import {api,browse} from './api';
import type {Entry} from './types';
import {useAppearance} from './theme';
const menu=[{to:'/',name:'概览',icon:LayoutDashboard},{to:'/library',name:'知识库',icon:FolderOpen},{to:'/tasks',name:'任务',icon:ListTodo},{to:'/search',name:'搜索',icon:Search},{to:'/activity',name:'活动',icon:History},{to:'/settings',name:'设置',icon:Settings}] as const;
function Navigation({onNavigate}:{onNavigate?:()=>void}){const {data}=useQuery({queryKey:['browse',null],queryFn:()=>browse(null)});return <>
 <div className="nav-label">工作区</div><nav aria-label="主导航" className="nav-list">{menu.map(({to,name,icon:Icon})=><Link key={to} to={to} onClick={onNavigate} activeOptions={{exact:to==='/'}} className="nav-link" activeProps={{className:'nav-link active'}}><Icon size={16}/>{name}</Link>)}</nav>
 <div className="nav-label nav-label-row"><span>最近目录</span><Link to="/library" onClick={onNavigate} title="打开知识库"><Plus size={14}/></Link></div>
 <nav aria-label="目录" className="folder-list">{data?.items.filter((x:Entry)=>x.entityType==='folder').slice(0,12).map((folder:Entry)=><Link key={folder.id} to="/library/$folderId" params={{folderId:folder.id}} onClick={onNavigate} className="folder-link"><ChevronRight size={13}/><FolderOpen size={15}/><span className="truncate">{folder.name}</span></Link>)}</nav>
 </>}
export function Shell({children}:{children:React.ReactNode}){
 const [collapsed,setCollapsed]=useState(false),[mobileOpen,setMobileOpen]=useState(false),[commands,setCommands]=useState(false);
 const navigate=useNavigate();const qc=useQueryClient();const {mode,setMode}=useAppearance();
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setCommands(v=>!v);}if(event.key==='Escape'){setCommands(false);setMobileOpen(false);}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
 const logout=async()=>{await api('/auth/logout',{method:'POST'});qc.clear();navigate({to:'/login'});};
 return <div className={'shell'+(collapsed?' sidebar-collapsed':'')}>
 <aside className={'sidebar'+(mobileOpen?' mobile-open':'')} aria-label="侧边栏">
  <div className="brand"><div className="brand-mark">R</div><span className="brand-name">Recalloom</span><button className="icon-button mobile-close" onClick={()=>setMobileOpen(false)} aria-label="关闭侧栏"><X size={18}/></button></div>
  <div className="sidebar-content"><Navigation onNavigate={()=>setMobileOpen(false)}/></div>
  <div className="sidebar-footer"><button className="nav-link" onClick={()=>setMode(mode==='dark'?'light':'dark')}><SunMoon size={16}/>切换主题</button><button className="nav-link" onClick={logout}><LogOut size={16}/>退出登录</button></div>
 </aside>
 {mobileOpen&&<button className="mobile-scrim" aria-label="关闭导航" onClick={()=>setMobileOpen(false)}/>}
 <div className="workspace"><header className="topbar">
  <div className="topbar-left"><button className="icon-button mobile-menu" onClick={()=>setMobileOpen(true)} aria-label="打开导航"><Menu size={19}/></button><button className="icon-button desktop-toggle" onClick={()=>setCollapsed(v=>!v)} aria-label="折叠侧边栏"><PanelLeft size={18}/></button><span className="topbar-title">Recalloom</span></div>
  <div className="topbar-actions"><button className="search-trigger" onClick={()=>setCommands(true)}><Search size={15}/>快速跳转 <kbd>⌘ K</kbd></button><button className="icon-button" onClick={()=>navigate({to:'/settings/appearance'})} title="外观设置"><SunMoon size={17}/></button></div>
 </header><main className="main-content">{children}</main></div>
 <div className="bottom-nav">{menu.filter(x=>['/library','/tasks','/search','/settings'].includes(x.to)).map(({to,name,icon:Icon})=><Link key={to} to={to} className="bottom-link"><Icon size={19}/><span>{name}</span></Link>)}</div>
 {commands&&<div className="modal-backdrop" onClick={()=>setCommands(false)}><div className="command-dialog" role="dialog" aria-modal="true" aria-label="快速导航" onClick={e=>e.stopPropagation()}><div className="command-title"><Command size={17}/>快速跳转 <button className="icon-button" onClick={()=>setCommands(false)} aria-label="关闭"><X size={16}/></button></div>{menu.map(({to,name,icon:Icon})=><button key={to} className="command-item" onClick={()=>{navigate({to});setCommands(false);}}><Icon size={16}/>{name}</button>)}</div></div>}
 </div>;
}
