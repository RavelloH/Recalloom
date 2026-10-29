import {Button} from '@astryxdesign/core/Button';
import React from 'react';
import {createRootRoute,createRoute,createRouter,Outlet,Navigate,useLocation} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api} from './api';
import {Shell} from './shell';
import {LoginPage,HomePage,LibraryPage,RecordPage,TasksPage,SearchPage,ActivityPage,SettingsPage} from './pages';
export const sessionQuery=()=>({queryKey:['auth-session'],queryFn:()=>api<{authenticated:boolean;session:{id:string}}>('/auth/session'),retry:false,staleTime:60000});
function Root(){const state=useQuery(sessionQuery());const onLogin=useLocation({select:location=>location.pathname})==='/login';
 if(onLogin)return <Outlet/>;
 if(state.isPending)return <div className="center-screen"><span className="spin"/>正在连接…</div>;
 if(state.isError){if(state.error instanceof ApiError&&state.error.status===401)return <Navigate to="/login" replace/>;return <div className="center-screen"><div><p>无法连接 Recalloom</p><p className="muted">{state.error.message}</p><Button label="重试" variant="secondary" onClick={()=>state.refetch()}/></div></div>;}
 return <Shell><Outlet/></Shell>;
}
const root=createRootRoute({component:Root,notFoundComponent:()=> <div className="page"><h2>页面不存在</h2><a href="/library">返回知识库</a></div>});
const list=[
 createRoute({getParentRoute:()=>root,path:'/',component:HomePage}),
 createRoute({getParentRoute:()=>root,path:'/login',component:LoginPage}),
 createRoute({getParentRoute:()=>root,path:'/library',component:LibraryPage}),
 createRoute({getParentRoute:()=>root,path:'/library/$folderId',component:LibraryPage}),
 createRoute({getParentRoute:()=>root,path:'/records/$recordId',component:RecordPage}),
 createRoute({getParentRoute:()=>root,path:'/tasks',component:TasksPage}),
 createRoute({getParentRoute:()=>root,path:'/search',component:SearchPage}),
 createRoute({getParentRoute:()=>root,path:'/activity',component:ActivityPage}),
 createRoute({getParentRoute:()=>root,path:'/settings',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/appearance',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/sessions',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/indexing',component:SettingsPage}),
 createRoute({getParentRoute:()=>root,path:'/settings/backup',component:SettingsPage})
];
export const router=createRouter({routeTree:root.addChildren(list),defaultPreload:'intent'});
declare module '@tanstack/react-router'{interface Register{router:typeof router;}}
