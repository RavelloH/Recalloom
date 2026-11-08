import {LayoutDashboard,FolderOpen,ListTodo,Search,History,Settings,Archive,Network,BookOpen} from 'lucide-react';

export const menu=[
 {to:'/',name:'概览',icon:LayoutDashboard},
 {to:'/library',name:'知识库',icon:FolderOpen},
 {to:'/tasks',name:'任务',icon:ListTodo},
 {to:'/search',name:'搜索',icon:Search},
 {to:'/activity',name:'活动',icon:History},
 {to:'/archive',name:'归档',icon:Archive},
 {to:'/graph',name:'关系网',icon:Network},
 {to:'/help',name:'语法帮助',icon:BookOpen},
 {to:'/settings',name:'设置',icon:Settings}
] as const;
