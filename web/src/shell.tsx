import React,{useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useRouterState} from '@tanstack/react-router';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {SideNav} from '@astryxdesign/core/SideNav';
import {IconLayoutSidebarLeftExpand,IconChevronsLeft,IconSearch,IconLogout,IconMenu2,IconX,IconSunMoon,IconSettings} from '@tabler/icons-react';
import {api} from './api';
import {useAppearance} from './theme';
import {clearAllSessionDrafts,hasSessionDrafts,hasActiveEditorDirty,approveLogoutNavigation} from './session-drafts';
import {useConfirmDialog} from './confirm-dialog';
import {menu} from './navigation';
import {PageTree} from './page-tree';
import {QuickSwitcher} from './command-palette';
import {TopbarSlotProvider} from './topbar-slot';
import {clearRecentPages} from './recent-pages';
import {OverlayScroll} from './scrollbars';
import {PageTransition} from './page-transition';
import {useFullWidth} from './preferences';

const quickLinks=menu.filter(item=>['/','/tasks','/activity','/archive','/graph'].includes(item.to));
const shortcut=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform)?'⌘K':'Ctrl K';

export function Shell({children}:{children:React.ReactNode}){
 const [collapsed,setCollapsed]=useState(()=>localStorage.getItem('recalloom:sidebar')==='collapsed');
 const [mobileOpen,setMobileOpen]=useState(false),[commands,setCommands]=useState(false),[scrolled,setScrolled]=useState(false);
 const [slotStart,setSlotStart]=useState<HTMLDivElement|null>(null),[slotEnd,setSlotEnd]=useState<HTMLDivElement|null>(null);
 const scroller=useRef<HTMLDivElement|null>(null);
 const {confirm:askConfirm,confirmation}=useConfirmDialog();
 const navigate=useNavigate();const qc=useQueryClient();const {mode,setMode}=useAppearance();
 // Key on the rendered leaf match: the outgoing page stays mounted while the next one loads,
 // and the incoming page mounts exactly once (resolvedLocation lags the match swap by a tick).
 const pathname=useRouterState({select:state=>state.matches[state.matches.length-1]?.pathname??state.location.pathname});
 const fullWidth=useFullWidth();
 useEffect(()=>{try{localStorage.setItem('recalloom:sidebar',collapsed?'collapsed':'open');}catch{ /* storage may be unavailable */ }},[collapsed]);
 const cycleTheme=()=>setMode(mode==='system'?'light':mode==='light'?'dark':'system');
 const themeName=mode==='system'?'跟随系统':mode==='light'?'浅色':'深色';
 const closeMobile=()=>setMobileOpen(false);
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{
  const mod=event.ctrlKey||event.metaKey;
  if(mod&&event.key.toLowerCase()==='k'){event.preventDefault();setCommands(v=>!v);}
  if(mod&&event.key==='\\'){event.preventDefault();setCollapsed(v=>!v);}
  if(event.key==='Escape')setMobileOpen(false);
 };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
 // The top bar gains its separator only once content scrolls beneath it.
 useEffect(()=>{const el=scroller.current;if(!el)return;const sync=()=>setScrolled(el.scrollTop>2);el.addEventListener('scroll',sync,{passive:true});sync();return()=>el.removeEventListener('scroll',sync);},[]);
 const logout=async()=>{if((hasSessionDrafts()||hasActiveEditorDirty())&&!(await askConfirm({title:'退出并清除草稿？',description:'本标签页仍有未保存草稿。退出登录将删除这些草稿，此操作无法撤销。',actionLabel:'退出并清除',destructive:true})))return;approveLogoutNavigation(true);try{await api('/auth/logout',{method:'POST'});clearAllSessionDrafts();clearRecentPages();qc.clear();await navigate({to:'/login'});}finally{approveLogoutNavigation(false);}};
 return <div className={'shell'+(collapsed?' sidebar-collapsed':'')} data-scrolled={scrolled||undefined} data-width={fullWidth?'full':undefined}>
 <SideNav className={'sidebar'+(mobileOpen?' mobile-open':'')} aria-label="侧边栏"
  header={<div className="brand"><div className="brand-mark">R</div><span className="brand-name">Recalloom</span>
   <IconButton className="sidebar-collapse" variant="ghost" size="sm" label="折叠侧边栏" icon={<IconChevronsLeft/>} onClick={()=>setCollapsed(true)}/>
   <IconButton className="mobile-close" variant="ghost" label="关闭侧栏" icon={<IconX/>} onClick={closeMobile}/></div>}
  footer={<div className="sidebar-footer">
   <Link to="/settings" onClick={closeMobile} className="nav-link" activeProps={{className:'nav-link active'}}><IconSettings/>设置</Link>
   <Button className="nav-link" width="100%" variant="ghost" label={'主题：'+themeName} tooltip="切换主题：跟随系统 → 浅色 → 深色" icon={<IconSunMoon/>} onClick={cycleTheme}/>
   <Button className="nav-link is-danger" width="100%" variant="ghost" label="退出登录" icon={<IconLogout/>} onClick={logout}/>
  </div>}>
  <OverlayScroll className="sidebar-scroll" axis="y">
   <div className="sidebar-quick">
    <Button className="nav-link nav-search" width="100%" variant="ghost" label="搜索" icon={<IconSearch/>} endContent={<kbd className="nav-kbd">{shortcut}</kbd>} onClick={()=>{closeMobile();setCommands(true);}}/>
    <nav aria-label="主导航" className="nav-list">{quickLinks.map(({to,name,icon:Icon})=><Link key={to} to={to} onClick={closeMobile} activeOptions={{exact:to==='/'}} className="nav-link" activeProps={{className:'nav-link active'}}><span className="rk-icon-frame rk-icon-frame--nav"><Icon aria-hidden="true"/></span>{name}</Link>)}</nav>
   </div>
   <PageTree onNavigate={closeMobile}/>
  </OverlayScroll>
 </SideNav>
 <button className={'mobile-scrim'+(mobileOpen?' is-visible':'')} aria-label="关闭导航" aria-hidden={!mobileOpen} tabIndex={mobileOpen?0:-1} onClick={closeMobile}/>
 <div className="workspace"><header className="topbar">
  <div className="topbar-left">
   <IconButton className="mobile-menu" variant="ghost" label="打开导航" icon={<IconMenu2/>} onClick={()=>setMobileOpen(true)}/>
   {collapsed&&<IconButton className="desktop-toggle" variant="ghost" size="sm" label="展开侧边栏" icon={<IconLayoutSidebarLeftExpand/>} onClick={()=>setCollapsed(false)}/>}
   <span className="topbar-title">Recalloom</span>
   <div className="topbar-slot topbar-slot-start" ref={setSlotStart}/>
  </div>
  <div className="topbar-actions"><div className="topbar-slot topbar-slot-end" ref={setSlotEnd}/></div>
 </header><main className="main-content">
  <OverlayScroll className="main-scroll-host" axis="y" persistent viewportClassName="main-scroll" viewportRef={scroller} viewportProps={{role:'region','aria-label':'页面内容',tabIndex:-1}}>
   <TopbarSlotProvider slots={{start:slotStart,end:slotEnd}}>
    <PageTransition scrollTarget={()=>scroller.current}><div key={pathname} className="route-stage">{children}</div></PageTransition>
   </TopbarSlotProvider>
  </OverlayScroll>
 </main></div>
 <div className="bottom-nav">{menu.filter(x=>['/library','/tasks','/search','/settings'].includes(x.to)).map(({to,name,icon:Icon})=><Link key={to} to={to} className="bottom-link" activeProps={{className:'bottom-link active'}}><span className="rk-icon-frame rk-icon-frame--bottom"><Icon aria-hidden="true"/></span><span>{name}</span></Link>)}</div>
 <QuickSwitcher isOpen={commands} onOpenChange={setCommands}/>
 {confirmation}
 </div>;
}
