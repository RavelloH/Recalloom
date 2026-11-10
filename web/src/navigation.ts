import type {IconName} from './icon';
export const menu=[
 {to:'/',name:'概览',icon:'overview'},
 {to:'/library',name:'知识库',icon:'folder'},
 {to:'/tasks',name:'任务',icon:'taskList'},
 {to:'/search',name:'搜索',icon:'search'},
 {to:'/activity',name:'活动',icon:'activity'},
 {to:'/archive',name:'归档',icon:'archive'},
 {to:'/graph',name:'关系网',icon:'graph'},
 {to:'/help',name:'语法帮助',icon:'help'},
 {to:'/settings',name:'设置',icon:'settings'}
] as const satisfies readonly {to:string;name:string;icon:IconName}[];
