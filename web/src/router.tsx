import {Button} from '@astryxdesign/core/Button';
import React from 'react';
import {createRootRoute,createRoute,createRouter,Outlet,Navigate,useLocation,lazyRouteComponent} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api} from './api';
import {Shell} from './shell';
import {prepareScrollbars,useScrollbarsReady} from './scrollbars';
import {preparePairedNavigation,type ResolveSharedLabel} from './shared-view-transition';
import {getRecentPages} from './recent-pages';
import {documentDisplayName} from './document-filename';
import type {Task,Event,Entry,RecentUpdate} from './types';
import type {SearchResult} from './queries';
// Route modules load only when visited/preloaded, rather than entering the
// initial shell bundle. TanStack preloads these on navigation intent.
const importLogin=()=>import('./pages/login');
const importHome=()=>import('./pages/home');
const importLibrary=()=>import('./pages/library');
const importArchive=()=>import('./pages/archive');
const importRecord=()=>import('./pages/record');
const importTasks=()=>import('./pages/tasks');
const importSearch=()=>import('./pages/search');
const importActivity=()=>import('./pages/activity');
const importSettings=()=>import('./pages/settings');
const LoginPage=lazyRouteComponent(importLogin,'LoginPage');
const HomePage=lazyRouteComponent(importHome,'HomePage');
const LibraryPage=lazyRouteComponent(importLibrary,'LibraryPage');
const ArchivePage=lazyRouteComponent(importArchive,'ArchivePage');
const RecordPage=lazyRouteComponent(importRecord,'RecordPage');
const TasksPage=lazyRouteComponent(importTasks,'TasksPage');
const SearchPage=lazyRouteComponent(importSearch,'SearchPage');
const ActivityPage=lazyRouteComponent(importActivity,'ActivityPage');
const SettingsPage=lazyRouteComponent(importSettings,'SettingsPage');
import {queryClient,recordQuery,folderQuery,folderPagesQuery,archivedRecordsQuery,tasksQuery,activityQuery,activityPagesQuery,isSearchMode,type SearchMode} from './queries';
import {preloadEditor} from './editor-chunks';
const importGraph=()=>import('./knowledge-graph');
const importHelp=()=>import('./rmd-help-page');
const KnowledgeGraphPage=React.lazy(importGraph);
const RmdHelpPage=React.lazy(importHelp);
const HelpRoute=()=> <React.Suspense fallback={<div className="page" role="status">正在加载 RMD 语法帮助…</div>}><RmdHelpPage/></React.Suspense>;
const GraphRoute=()=> <React.Suspense fallback={<div className="page graph-loading" role="status">正在准备关系网…</div>}><KnowledgeGraphPage/></React.Suspense>;
export const sessionQuery=()=>({queryKey:['auth-session'],queryFn:()=>api<{authenticated:boolean;session:{id:string}}>('/auth/session'),retry:false,staleTime:60000});
function Root(){const state=useQuery(sessionQuery());const onLogin=useLocation({select:location=>location.pathname})==='/login';
 const scrollbarReady=useScrollbarsReady();
 React.useEffect(()=>{if(!onLogin&&!scrollbarReady)void prepareScrollbars();},[onLogin,scrollbarReady]);
 if(onLogin)return <React.Suspense fallback={<div className="center-screen" role="status">正在加载登录页面…</div>}><Outlet/></React.Suspense>;
 if(state.isPending)return <div className="center-screen"><span className="spin"/>正在连接…</div>;
 if(state.isError){if(state.error instanceof ApiError&&state.error.status===401)return <Navigate to="/login" replace/>;return <div className="center-screen"><div><p>无法连接 Recalloom</p><p className="muted">{state.error.message}</p><Button label="重试" variant="secondary" onClick={()=>state.refetch()}/></div></div>;}
 // The shell's scroll viewports must initialize before they paint; do not
 // withhold the login page or auth request while the engine chunk downloads.
 if(!scrollbarReady)return <div className="center-screen" role="status"><span className="spin"/>正在准备界面…</div>;
 return <Shell><React.Suspense fallback={<div className="page" role="status">正在加载页面…</div>}><Outlet/></React.Suspense></Shell>;
}
// Wait for critical page data AND lazy component code before committing the
// destination. The former 600ms cap could resolve while the cache was still
// pending, so View Transitions captured Skeleton/Suspense instead of a title.
// Existing content stays visible under the route progress bar until ready.
// Errors are still rendered by the page's own query/error components.
const ready=async(...work:Array<Promise<unknown>>)=>{await Promise.allSettled(work);};
const root=createRootRoute({component:Root,notFoundComponent:()=> <div className="page"><h2>页面不存在</h2><a href="/library">返回知识库</a></div>});
const list=[
 createRoute({getParentRoute:()=>root,path:'/',component:HomePage,loader:()=>ready(importHome(),queryClient.ensureQueryData(tasksQuery()),queryClient.ensureQueryData(activityQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/login',component:LoginPage,loader:()=>ready(importLogin())}),
 createRoute({getParentRoute:()=>root,path:'/library',component:LibraryPage,loader:()=>ready(importLibrary(),queryClient.ensureInfiniteQueryData(folderPagesQuery(null)))}),
 createRoute({getParentRoute:()=>root,path:'/library/$folderId',component:LibraryPage,loader:({params})=>ready(importLibrary(),queryClient.ensureInfiniteQueryData(folderPagesQuery(params.folderId)),queryClient.ensureQueryData(folderQuery(params.folderId)))}),
 createRoute({getParentRoute:()=>root,path:'/records/$recordId',component:RecordPage,
  validateSearch:(search:Record<string,unknown>):{mode?:'source';task?:string}=>({
   ...(search.mode==='source'?{mode:'source' as const}:{}),
   ...(typeof search.task==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(search.task)?{task:search.task}:{})
  }),
  loaderDeps:({search})=>({mode:search.mode}),
  loader:async({params,deps})=>{
   const chunk=importRecord();
   const item=await queryClient.ensureQueryData(recordQuery(params.recordId)).catch(()=>null);
   // The editor is part of a document's first fully rendered view, not a
   // second-stage placeholder. Task lists instead need their initial tasks.
   await ready(chunk,...(item?[item.kind==='task_list'
    ?queryClient.ensureQueryData(tasksQuery(params.recordId))
    :preloadEditor(deps.mode??'visual')]:[]));
  }}),
 createRoute({getParentRoute:()=>root,path:'/tasks',component:TasksPage,loader:()=>ready(importTasks(),queryClient.ensureQueryData(tasksQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/archive',component:ArchivePage,loader:()=>ready(importArchive(),queryClient.ensureInfiniteQueryData(archivedRecordsQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/graph',component:GraphRoute,loader:()=>ready(importGraph()),
  validateSearch:(search:Record<string,unknown>):{focus?:string}=>typeof search.focus==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(search.focus)?{focus:search.focus}:{}}),
 createRoute({getParentRoute:()=>root,path:'/search',component:SearchPage,
  validateSearch:(search:Record<string,unknown>):{q?:string;mode?:SearchMode}=>({
   ...(typeof search.q==='string'&&search.q.trim()?{q:search.q.slice(0,4000)}:{}),
   ...(isSearchMode(search.mode)&&search.mode!=='auto'?{mode:search.mode}:{})
  }),
  loaderDeps:({search})=>({q:search.q,mode:search.mode}),
  // Search is interactive: commit query/mode changes immediately and let the
  // page's React Query state show progress instead of blocking navigation.
  loader:()=>ready(importSearch())}),
 createRoute({getParentRoute:()=>root,path:'/activity',component:ActivityPage,loader:()=>ready(importActivity(),queryClient.ensureInfiniteQueryData(activityPagesQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/help',component:HelpRoute,loader:()=>ready(importHelp())}),
 createRoute({getParentRoute:()=>root,path:'/settings',component:SettingsPage,loader:()=>ready(importSettings())}),
 createRoute({getParentRoute:()=>root,path:'/settings/appearance',component:()=> <Navigate to="/settings" replace/>}),
 createRoute({getParentRoute:()=>root,path:'/settings/oauth',component:SettingsPage,loader:()=>ready(importSettings())}),
 createRoute({getParentRoute:()=>root,path:'/settings/sessions',component:SettingsPage,loader:()=>ready(importSettings())}),
 createRoute({getParentRoute:()=>root,path:'/settings/indexing',component:SettingsPage,loader:()=>ready(importSettings())}),
 createRoute({getParentRoute:()=>root,path:'/settings/backup',component:SettingsPage,loader:()=>ready(importSettings())})
];
/**
 * Verify the exact label on both sides BEFORE capturing an old snapshot.
 * Cache membership is mandatory for history navigation: a missing destination
 * must fall back to the normal route crossfade instead of a floating name.
 */
const labelForRecord=(name:string,recordKind?:string)=>
 recordKind==='document'?documentDisplayName(name):name;
const resolveSharedLabel:ResolveSharedLabel=(kind,id,direction,source,location,key)=>{
 if(direction==='forward'){
  if(kind==='folder')return queryClient.getQueryData<{name:string}>(['folder',id])?.name;
  if(kind==='task'){
   const parent=/^\/records\/([^/]+)$/.exec(location.pathname);
   const tasks=parent?queryClient.getQueryData<{items:Task[]}>(['tasks',decodeURIComponent(parent[1])]):null;
   return tasks?.items.find(item=>item.id===id)?.title;
  }
  const record=queryClient.getQueryData<{kind:string;name:string}>(['record',id]);
  if(record)return labelForRecord(record.name,record.kind);
  // A server-fed recent update is often a record the user has NEVER opened.
  // Its fresh, identity-keyed summary is a valid source for the first visit;
  // waiting for a detail cache would silently disable the new shared title.
  if(source==='updated'){
   const summary=queryClient.getQueryData<{items:RecentUpdate[]}>(['recent-updates'])?.items.find(item=>item.id===id);
   return summary?labelForRecord(summary.name,summary.kind):undefined;
  }
  return undefined;
 }
 if(source==='library'){
  const match=/^\/library\/([^/]+)$/.exec(location.pathname);
  const folder=location.pathname==='/library'?null:match?.[1];
  if(folder===undefined)return undefined;
  const data=queryClient.getQueryData<{pages:Array<{items:Entry[]}>}>(['browse-pages',folder]);
  const item=data?.pages.flatMap(page=>page.items).find(entry=>entry.id===id&&entry.entityType===kind);
  return item?kind==='record'?labelForRecord(item.name,item.kind):item.name:undefined;
 }
 if(source==='recent'){
  const item=getRecentPages().find(entry=>entry.id===id);
  return item?labelForRecord(item.name,item.kind):undefined;
 }
 if(source==='updated'){
  const item=queryClient.getQueryData<{items:RecentUpdate[]}>(['recent-updates'])?.items.find(entry=>entry.id===id);
  return item?labelForRecord(item.name,item.kind):undefined;
 }
 if(source==='todo'){
  const item=queryClient.getQueryData<{items:Task[]}>(['tasks','all'])?.items.find(t=>t.id===id);
  return item?.title;
 }
 if(source==='search'){
  const query=location.search?.q,mode=location.search?.mode;
  if(typeof query!=='string'||!query)return undefined;
  const searchMode=typeof mode==='string'?mode as SearchMode:'auto';
  const hits=queryClient.getQueryData<SearchResult>(['search',query,searchMode,30])?.items??[];
  const item=hits.find((hit,index)=>hit.id===id&&key==='search:'+hit.id+':'+index);
  return item?labelForRecord(item.name,item.kind):undefined;
 }
 if(source==='archive'){
  const pages=queryClient.getQueryData<{pages:Array<{items:Array<{id:string;name:string;kind:string}>}>}>(['archived-records','']);
  const item=pages?.pages.flatMap(page=>page.items).find(entry=>entry.id===id);
  return item?labelForRecord(item.name,item.kind):undefined;
 }
 if(source==='activity'){
  const seq=key.slice('activity:'.length);
  const events:Event[]=location.pathname==='/activity'
   ?queryClient.getQueryData<{pages:Array<{items:Event[]}>}>(['recent-activity'])?.pages.flatMap(page=>page.items)??[]
   :queryClient.getQueryData<{items:Event[]}>(['activity'])?.items??[];
  const event=events.find(entry=>String(entry.seq??entry.id??'unknown')===seq&&
   (entry.entityId||entry.recordId)===id);
  return event?.resourceName?kind==='record'?documentDisplayName(event.resourceName):event.resourceName:undefined;
 }
 return undefined;
};

// Loaders read through the shared query cache; the router itself never caches stale data.
// Every route gets the native transition, including browser history. The
// default root snapshot preserves persistent navigation, while the fixed main
// scroll viewport and stable resource IDs animate separately.
export const router=createRouter({routeTree:root.addChildren(list),defaultPreload:'intent',defaultPreloadStaleTime:0,
 // The app scrolls inside a persistent div, not window. Router-managed
 // history keys reset NEW destinations and restore POP positions. Instant
 // avoids a second scroll animation underneath native View Transitions.
 scrollRestoration:true,scrollToTopSelectors:['.main-scroll'],scrollRestorationBehavior:'instant',
 defaultViewTransition:{types:({fromLocation,toLocation})=>
  preparePairedNavigation(fromLocation,toLocation,resolveSharedLabel)}

});
declare module '@tanstack/react-router'{interface Register{router:typeof router;}}
