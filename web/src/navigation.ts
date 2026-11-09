import {IconLayoutDashboard,IconFolderOpen,IconChecklist,IconSearch,IconHistory,IconSettings,IconArchive,IconTopologyStar3,IconBook2} from '@tabler/icons-react';

export const menu=[
 {to:'/',name:'概览',icon:IconLayoutDashboard},
 {to:'/library',name:'知识库',icon:IconFolderOpen},
 {to:'/tasks',name:'任务',icon:IconChecklist},
 {to:'/search',name:'搜索',icon:IconSearch},
 {to:'/activity',name:'活动',icon:IconHistory},
 {to:'/archive',name:'归档',icon:IconArchive},
 {to:'/graph',name:'关系网',icon:IconTopologyStar3},
 {to:'/help',name:'语法帮助',icon:IconBook2},
 {to:'/settings',name:'设置',icon:IconSettings}
] as const;
