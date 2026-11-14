import {Icon} from './icon';
import {BrandMark} from './brand-mark';
import {NavRow} from './nav-row';
import React,{useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useRouterState} from '@tanstack/react-router';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {SideNav} from '@astryxdesign/core/SideNav';

import {api} from './api';
import {useAppearance} from './theme';
import {clearAllSessionDrafts,hasSessionDrafts,hasActiveEditorDirty,approveLogoutNavigation} from './session-drafts';
import {useConfirmDialog} from './confirm-dialog';
import {menu} from './navigation';
import {PageTree} from './page-tree';
// Load the sizeable command palette only on first use; retain it after closing
// so its dismissal animation and in-memory search state still behave normally.
const loadQuickSwitcher=()=>import('./command-palette');
const QuickSwitcher=React.lazy(()=>loadQuickSwitcher().then(module=>({default:module.QuickSwitcher})));
import {TopbarSlotProvider} from './topbar-slot';
import {clearRecentPages} from './recent-pages';
import {OverlayScroll} from './scrollbars';
import {PageTransition} from './page-transition';
import {useFullWidth} from './preferences';
import {WorkspacePanels} from './workspace-panels';

const quickLinks=menu.filter(item=>['/','/tasks','/activity','/archive','/graph'].includes(item.to));
const shortcut=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform)?'⌘K':'Ctrl K';

export function Shell({children}:{children:React.ReactNode}){
 const [collapsed,setCollapsed]=useState(()=>localStorage.getItem('recalloom:sidebar')==='collapsed');
 const [mobileOpen,setMobileOpen]=useState(false),[commands,setCommands]=useState(false),[paletteActivated,setPaletteActivated]=useState(false),[scrolled,setScrolled]=useState(false);
 const [slotStart,setSlotStart]=useState<HTMLDivElement|null>(null),[slotEnd,setSlotEnd]=useState<HTMLDivElement|null>(null);
 const scroller=useRef<HTMLDivElement|null>(null);
 const pendingSidebarLink=useRef<HTMLAnchorElement|null>(null);
 const replayingSidebarLink=useRef(false);
 const sidebarExitFallback=useRef<number|null>(null);
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
 const finishSidebarNavigation=()=>{
  if(sidebarExitFallback.current!==null){
   window.clearTimeout(sidebarExitFallback.current);
   sidebarExitFallback.current=null;
  }
  const anchor=pendingSidebarLink.current;
  pendingSidebarLink.current=null;
  if(!anchor?.isConnected)return;
  // Replay the original TanStack Link click after the drawer has completely
  // left the screen. This preserves params, search, preloading and history
  // semantics without duplicating or re-implementing route navigation.
  replayingSidebarLink.current=true;
  try{anchor.click();}finally{replayingSidebarLink.current=false;}
 };
 const onSidebarClickCapture=(event:React.MouseEvent<HTMLElement>)=>{
  if(!mobileOpen||replayingSidebarLink.current||event.defaultPrevented||
   event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  const target=event.target;
  const anchor=target instanceof Element?target.closest<HTMLAnchorElement>('a[href]'):null;
  if(!anchor||!event.currentTarget.contains(anchor)||anchor.hasAttribute('download')||
   (anchor.target&&anchor.target!=='_self')||anchor.origin!==location.origin)return;
  event.preventDefault();
  event.stopPropagation();
  pendingSidebarLink.current=anchor;
  setMobileOpen(false);
  if(sidebarExitFallback.current!==null)window.clearTimeout(sidebarExitFallback.current);
  // CSS fires transitionend for transform (280ms). The timeout handles
  // reduced-motion, interrupted transitions and browsers without the event.
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  sidebarExitFallback.current=window.setTimeout(finishSidebarNavigation,reduced?0:420);
 };
 const onSidebarTransitionEnd=(event:React.TransitionEvent<HTMLElement>)=>{
  if(event.target===event.currentTarget&&event.propertyName==='transform'&&
   pendingSidebarLink.current&&!mobileOpen)finishSidebarNavigation();
 };
 useEffect(()=>()=>{if(sidebarExitFallback.current!==null)window.clearTimeout(sidebarExitFallback.current);},[]);
 // Prewarm the sizeable palette after the shell has painted. On first click
 // the Dialog's built-in open animation then runs without a cold chunk delay.
 useEffect(()=>{
  if(typeof window.requestIdleCallback==='function'){
   const handle=window.requestIdleCallback(()=>{void loadQuickSwitcher();},{timeout:1800});
   return()=>window.cancelIdleCallback(handle);
  }
  const handle=window.setTimeout(()=>{void loadQuickSwitcher();},500);
  return()=>window.clearTimeout(handle);
 },[]);
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{
  const mod=event.ctrlKey||event.metaKey;
  if(mod&&event.key.toLowerCase()==='k'){event.preventDefault();setPaletteActivated(true);setCommands(v=>!v);}
  if(mod&&event.key==='\\'){event.preventDefault();setCollapsed(v=>!v);}
  if(event.key==='Escape')setMobileOpen(false);
 };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
 // The top bar gains its separator only once content scrolls beneath it.
 useEffect(()=>{const el=scroller.current;if(!el)return;const sync=()=>setScrolled(el.scrollTop>2);el.addEventListener('scroll',sync,{passive:true});sync();return()=>el.removeEventListener('scroll',sync);},[]);
 const logout=async()=>{if((hasSessionDrafts()||hasActiveEditorDirty())&&!(await askConfirm({title:'退出并清除草稿？',description:'本标签页仍有未保存草稿。退出登录将删除这些草稿，此操作无法撤销。',actionLabel:'退出并清除',destructive:true})))return;approveLogoutNavigation(true);try{await api('/auth/logout',{method:'POST'});clearAllSessionDrafts();clearRecentPages();qc.clear();await navigate({to:'/login'});}finally{approveLogoutNavigation(false);}};
 return <div className={'shell'+(collapsed?' sidebar-collapsed':'')} data-scrolled={scrolled||undefined} data-width={fullWidth?'full':undefined}>
 <SideNav className={'sidebar'+(mobileOpen?' mobile-open':'')} aria-label="侧边栏"
  onClickCapture={onSidebarClickCapture} onTransitionEnd={onSidebarTransitionEnd}
  header={<div className="brand"><BrandMark className="brand-mark"/><span className="brand-name">Recalloom</span>
   <IconButton className="sidebar-collapse" variant="ghost" size="sm" label="折叠侧边栏" icon={<Icon name="chevronsLeft"/>} onClick={()=>setCollapsed(true)}/>
   <IconButton className="mobile-close" variant="ghost" label="关闭侧栏" icon={<Icon name="x"/>} onClick={closeMobile}/></div>}
  footer={<div className="sidebar-footer">
   <NavRow to="/settings" icon="settings" label="设置" onClick={closeMobile}/>
   <NavRow icon="sunMoon" label={'主题：'+themeName} title="切换主题：跟随系统 → 浅色 → 深色" onClick={cycleTheme}/>
   <NavRow icon="logout" label="退出登录" onClick={()=>void logout()}/>
  </div>}>
  <OverlayScroll className="sidebar-scroll" axis="y">
   <div className="sidebar-quick">
    <NavRow icon="search" label="搜索" className="nav-search" trailing={<kbd className="nav-kbd">{shortcut}</kbd>} onPointerEnter={()=>{void loadQuickSwitcher();}} onFocus={()=>{void loadQuickSwitcher();}} onClick={()=>{closeMobile();setPaletteActivated(true);setCommands(true);}}/>
    <nav aria-label="主导航" className="nav-list">{quickLinks.map(({to,name,icon})=><NavRow key={to} to={to} icon={icon} label={name} onClick={closeMobile} exact={to==='/'}/>)}</nav>
   </div>
   <PageTree onNavigate={closeMobile}/>
  </OverlayScroll>
 </SideNav>
 <button className={'mobile-scrim'+(mobileOpen?' is-visible':'')} aria-label="关闭导航" aria-hidden={!mobileOpen} tabIndex={mobileOpen?0:-1} onClick={closeMobile}/>
 <WorkspacePanels><header className="topbar">
  <div className="topbar-left">
   <IconButton className="mobile-menu" variant="ghost" label="打开导航" icon={<Icon name="menu2"/>} onClick={()=>{
    if(sidebarExitFallback.current!==null)window.clearTimeout(sidebarExitFallback.current);
    sidebarExitFallback.current=null;
    pendingSidebarLink.current=null;
    setMobileOpen(true);
   }}/>
   {collapsed&&<IconButton className="desktop-toggle" variant="ghost" size="sm" label="展开侧边栏" icon={<Icon name="layoutSidebarLeftExpand"/>} onClick={()=>setCollapsed(false)}/>}
   <span className="topbar-title">Recalloom</span>
   <div className="topbar-slot topbar-slot-start" ref={setSlotStart}/>
  </div>
  <div className="topbar-actions"><div className="topbar-slot topbar-slot-end" ref={setSlotEnd}/></div>
 </header><main className="main-content">
  <OverlayScroll className="main-scroll-host" axis="y" persistent viewportClassName="main-scroll" viewportRef={scroller} viewportProps={{role:'region','aria-label':'页面内容',tabIndex:-1}}>
   <TopbarSlotProvider slots={{start:slotStart,end:slotEnd}}>
    <PageTransition><div key={pathname} className="route-stage">{children}</div></PageTransition>
   </TopbarSlotProvider>
  </OverlayScroll>
 </main></WorkspacePanels>
 <div className="bottom-nav">{menu.filter(x=>['/library','/tasks','/search','/settings'].includes(x.to)).map(({to,name,icon})=><Link key={to} to={to} className="bottom-link" activeProps={{className:'bottom-link active'}}><Icon name={icon} size="lg"/><span>{name}</span></Link>)}</div>
 {paletteActivated&&<React.Suspense fallback={commands?<div className="palette-loading" role="status"><span className="spin"/>正在打开搜索…</div>:null}><QuickSwitcher isOpen={commands} onOpenChange={setCommands}/></React.Suspense>}
 {confirmation}
 </div>;
}
