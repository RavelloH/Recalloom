import {LayoutDashboard,FolderOpen,ListTodo,Search,History,Settings} from 'lucide-react';

export const menu=[
 {to:'/',name:'概览',icon:LayoutDashboard},
 {to:'/library',name:'知识库',icon:FolderOpen},
 {to:'/tasks',name:'任务',icon:ListTodo},
 {to:'/search',name:'搜索',icon:Search},
 {to:'/activity',name:'活动',icon:History},
 {to:'/settings',name:'设置',icon:Settings}
] as const;
