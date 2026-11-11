import {Button} from '@astryxdesign/core/Button';
import React from 'react';
import {createRootRoute,createRoute,createRouter,Outlet,Navigate,useLocation,lazyRouteComponent} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api} from './api';
import {Shell} from './shell';
// Route modules load only when visited/preloaded, rather than entering the
// initial shell bundle. TanStack preloads these on navigation intent.
const LoginPage=lazyRouteComponent(()=>import('./pages/login'),'LoginPage');
const HomePage=lazyRouteComponent(()=>import('./pages/home'),'HomePage');
const LibraryPage=lazyRouteComponent(()=>import('./pages/library'),'LibraryPage');
const ArchivePage=lazyRouteComponent(()=>import('./pages/archive'),'ArchivePage');
const RecordPage=lazyRouteComponent(()=>import('./pages/record'),'RecordPage');
const TasksPage=lazyRouteComponent(()=>import('./pages/tasks'),'TasksPage');
const SearchPage=lazyRouteComponent(()=>import('./pages/search'),'SearchPage');
const ActivityPage=lazyRouteComponent(()=>import('./pages/activity'),'ActivityPage');
const SettingsPage=lazyRouteComponent(()=>import('./pages/settings'),'SettingsPage');
import {queryClient,recordQuery,folderQuery,folderPagesQuery,archivedRecordsQuery,tasksQuery,activityQuery,activityPagesQuery,searchQuery,isSearchMode,type SearchMode} from './queries';
import {preloadEditor} from './editor-chunks';
const KnowledgeGraphPage=React.lazy(()=>import('./knowledge-graph'));
const RmdHelpPage=React.lazy(()=>import('./rmd-help-page'));
const HelpRoute=()=> <React.Suspense fallback={<div className="page" role="status">正在加载 RMD 语法帮助…</div>}><RmdHelpPage/></React.Suspense>;
const GraphRoute=()=> <React.Suspense fallback={<div className="page graph-loading" role="status">正在准备关系网…</div>}><KnowledgeGraphPage/></React.Suspense>;
export const sessionQuery=()=>({queryKey:['auth-session'],queryFn:()=>api<{authenticated:boolean;session:{id:string}}>('/auth/session'),retry:false,staleTime:60000});
function Root(){const state=useQuery(sessionQuery());const onLogin=useLocation({select:location=>location.pathname})==='/login';
 if(onLogin)return <React.Suspense fallback={<div className="center-screen" role="status">正在加载登录页面…</div>}><Outlet/></React.Suspense>;
 if(state.isPending)return <div className="center-screen"><span className="spin"/>正在连接…</div>;
 if(state.isError){if(state.error instanceof ApiError&&state.error.status===401)return <Navigate to="/login" replace/>;return <div className="center-screen"><div><p>无法连接 Recalloom</p><p className="muted">{state.error.message}</p><Button label="重试" variant="secondary" onClick={()=>state.refetch()}/></div></div>;}
 return <Shell><React.Suspense fallback={<div className="page" role="status">正在加载页面…</div>}><Outlet/></React.Suspense></Shell>;
}
// Loaders only warm caches; pages still own their loading and error states,
// so a failed prefetch never replaces the page with a router error screen.
// Waiting is capped: a slow request shows the page's own loading state instead of holding the old page.
const WARM_LIMIT_MS=600;
const warm=(...work:Array<Promise<unknown>>)=>Promise.race([Promise.allSettled(work),new Promise(resolve=>setTimeout(resolve,WARM_LIMIT_MS))]).then(()=>undefined);
const root=createRootRoute({component:Root,notFoundComponent:()=> <div className="page"><h2>页面不存在</h2><a href="/library">返回知识库</a></div>});
const list=[
 createRoute({getParentRoute:()=>root,path:'/',component:HomePage,loader:()=>warm(queryClient.ensureQueryData(tasksQuery()),queryClient.ensureQueryData(activityQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/login',component:LoginPage}),
 createRoute({getParentRoute:()=>root,path:'/library',component:LibraryPage,loader:()=>warm(queryClient.ensureInfiniteQueryData(folderPagesQuery(null)))}),
 createRoute({getParentRoute:()=>root,path:'/library/$folderId',component:LibraryPage,loader:({params})=>warm(queryClient.ensureInfiniteQueryData(folderPagesQuery(params.folderId)),queryClient.ensureQueryData(folderQuery(params.folderId)))}),
 createRoute({getParentRoute:()=>root,path:'/records/$recordId',component:RecordPage,
  validateSearch:(search:Record<string,unknown>):{mode?:'source'}=>search.mode==='source'?{mode:'source'}:{},
  loaderDeps:({search})=>({mode:search.mode}),
  loader:({params,deps})=>warm((async()=>{
   const item=await queryClient.ensureQueryData(recordQuery(params.recordId)).catch(()=>null);
   await (item?.kind==='task_list'?queryClient.ensureQueryData(tasksQuery(params.recordId)):preloadEditor(deps.mode??'visual'));
  })())}),
 createRoute({getParentRoute:()=>root,path:'/tasks',component:TasksPage,loader:()=>warm(queryClient.ensureQueryData(tasksQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/archive',component:ArchivePage,loader:()=>warm(queryClient.ensureInfiniteQueryData(archivedRecordsQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/graph',component:GraphRoute,
  validateSearch:(search:Record<string,unknown>):{focus?:string}=>typeof search.focus==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(search.focus)?{focus:search.focus}:{}}),
 createRoute({getParentRoute:()=>root,path:'/search',component:SearchPage,
  validateSearch:(search:Record<string,unknown>):{q?:string;mode?:SearchMode}=>({
   ...(typeof search.q==='string'&&search.q.trim()?{q:search.q.slice(0,4000)}:{}),
   ...(isSearchMode(search.mode)&&search.mode!=='auto'?{mode:search.mode}:{})
  }),
  loaderDeps:({search})=>({q:search.q,mode:search.mode}),
  loader:({deps})=>deps.q?warm(queryClient.ensureQueryData(searchQuery(deps.q,deps.mode??'auto'))):undefined}),
 createRoute({getParentRoute:()=>root,path:'/activity',component:ActivityPage,loader:()=>warm(queryClient.ensureInfiniteQueryData(activityPagesQuery()))}),
 createRoute({getParentRoute:()=>root,path:'/help',component:HelpRoute}),
 createRoute({getParentRoute:()=>root,path:'/settings',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/appearance',component:()=> <Navigate to="/settings" replace/>}),
 createRoute({getParentRoute:()=>root,path:'/settings/oauth',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/sessions',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/indexing',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/backup',component:SettingsPage})
];
// Loaders read through the shared query cache; the router itself never caches stale data.
// Native snapshots are opt-in per shared-resource Link. Snapshotting every
// navigation makes unrelated content blend and ghost on WebKit.
export const router=createRouter({routeTree:root.addChildren(list),defaultPreload:'intent',defaultPreloadStaleTime:0});
declare module '@tanstack/react-router'{interface Register{router:typeof router;}}
