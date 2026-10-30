import React,{useEffect,useState} from 'react';
import {Link,useNavigate,useLocation} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {SideNav} from '@astryxdesign/core/SideNav';
import {Dialog} from '@astryxdesign/core/Dialog';
import {PanelLeft,FileText,FolderOpen,ListTodo,Search,History,Settings,LogOut,Menu,X,ChevronRight,SunMoon,Command,LayoutDashboard,Plus} from 'lucide-react';
import {api,browse} from './api';
import type {Entry} from './types';
import {useAppearance} from './theme';
import {clearAllSessionDrafts,hasSessionDrafts,hasActiveEditorDirty,approveLogoutNavigation} from './session-drafts';
const menu=[{to:'/',name:'概览',icon:LayoutDashboard},{to:'/library',name:'知识库',icon:FolderOpen},{to:'/tasks',name:'任务',icon:ListTodo},{to:'/search',name:'搜索',icon:Search},{to:'/activity',name:'活动',icon:History},{to:'/settings',name:'设置',icon:Settings}] as const;
function Navigation({onNavigate}:{onNavigate?:()=>void}){const {data}=useQuery({queryKey:['browse',null],queryFn:()=>browse(null)});return <>
 <div className="nav-label">工作区</div><nav aria-label="主导航" className="nav-list">{menu.map(({to,name,icon:Icon})=><Link key={to} to={to} onClick={onNavigate} activeOptions={{exact:to==='/'}} className="nav-link" activeProps={{className:'nav-link active'}}><Icon size={16}/>{name}</Link>)}</nav>
 <div className="nav-label nav-label-row"><span>最近目录</span><Link to="/library" onClick={onNavigate} title="打开知识库"><Plus size={14}/></Link></div>
 <nav aria-label="目录" className="folder-list">{data?.items.filter((x:Entry)=>x.entityType==='folder').slice(0,12).map((folder:Entry)=><Link key={folder.id} to="/library/$folderId" params={{folderId:folder.id}} onClick={onNavigate} className="folder-link"><ChevronRight size={13}/><FolderOpen size={15}/><span className="truncate">{folder.name}</span></Link>)}</nav>
 </>}
export function Shell({children}:{children:React.ReactNode}){
 const [collapsed,setCollapsed]=useState(false),[mobileOpen,setMobileOpen]=useState(false),[commands,setCommands]=useState(false);
 const navigate=useNavigate();const pathname=useLocation({select:state=>state.pathname});const qc=useQueryClient();const {mode,setMode}=useAppearance();
 const cycleTheme=()=>setMode(mode==='system'?'light':mode==='light'?'dark':'system');
 const themeName=mode==='system'?'跟随系统':mode==='light'?'浅色':'深色';
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setCommands(v=>!v);}if(event.key==='Escape'){setCommands(false);setMobileOpen(false);}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
 const logout=async()=>{if((hasSessionDrafts()||hasActiveEditorDirty())&&!confirm('本标签页仍有未保存草稿。退出登录将删除这些草稿，确定退出吗？'))return;approveLogoutNavigation(true);try{await api('/auth/logout',{method:'POST'});clearAllSessionDrafts();qc.clear();await navigate({to:'/login'});}finally{approveLogoutNavigation(false);}};
 return <div className={'shell'+(collapsed?' sidebar-collapsed':'')}>
 <SideNav className={'sidebar'+(mobileOpen?' mobile-open':'')} aria-label="侧边栏" header={<div className="brand"><div className="brand-mark">R</div><span className="brand-name">Recalloom</span><IconButton className="mobile-close" variant="ghost" label="关闭侧栏" icon={<X size={18}/>} onClick={()=>setMobileOpen(false)}/></div>} footer={<div className="sidebar-footer"><Button className="nav-link" width="100%" variant="ghost" label={'主题：'+themeName} icon={<SunMoon size={16}/>} onClick={cycleTheme}/><Button className="nav-link" width="100%" variant="ghost" label="退出登录" icon={<LogOut size={16}/>} onClick={logout}/></div>}><Navigation onNavigate={()=>setMobileOpen(false)}/></SideNav>
 <button className={'mobile-scrim'+(mobileOpen?' is-visible':'')} aria-label="关闭导航" aria-hidden={!mobileOpen} tabIndex={mobileOpen?0:-1} onClick={()=>setMobileOpen(false)}/>
 <div className="workspace"><header className="topbar">
  <div className="topbar-left"><IconButton className="mobile-menu" variant="ghost" label="打开导航" icon={<Menu size={19}/>} onClick={()=>setMobileOpen(true)}/><IconButton className="desktop-toggle" variant="ghost" label="折叠侧边栏" icon={<PanelLeft size={18}/>} onClick={()=>setCollapsed(v=>!v)}/><span className="topbar-title">Recalloom</span></div>
  <div className="topbar-actions"><Button className="search-trigger" variant="ghost" label="快速跳转" icon={<Search size={15}/>} endContent={<kbd>⌘ K</kbd>} onClick={()=>setCommands(true)}/><IconButton variant="ghost" label={'切换主题（当前：'+themeName+'）'} icon={<SunMoon size={17}/>} onClick={cycleTheme}/></div>
 </header><main className="main-content"><div key={pathname} className="route-stage">{children}</div></main></div>
 <div className="bottom-nav">{menu.filter(x=>['/library','/tasks','/search','/settings'].includes(x.to)).map(({to,name,icon:Icon})=><Link key={to} to={to} className="bottom-link" activeProps={{className:'bottom-link active'}}><Icon size={19}/><span>{name}</span></Link>)}</div>
 <Dialog isOpen={commands} onOpenChange={setCommands} width={440} padding={4} purpose="info" aria-label="快速导航"><div className="command-surface"><div className="command-title"><Command size={18}/><strong>快速跳转</strong><IconButton variant="ghost" label="关闭" icon={<X size={18}/>} onClick={()=>setCommands(false)}/></div><div className="command-items">{menu.map(({to,name,icon:Icon})=><Button key={to} variant="ghost" width="100%" label={name} className="command-item" onClick={()=>{navigate({to});setCommands(false);}} icon={<Icon size={17}/>}/>)}</div></div></Dialog>
 </div>;
}
