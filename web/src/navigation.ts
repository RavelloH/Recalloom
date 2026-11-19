import type {IconName} from './icon';


export const menu=[
 {to:'/',name:'概览',icon:"overview"},
 {to:'/library',name:'知识库',icon:"library"},
 {to:'/tasks',name:'任务',icon:"taskList"},
 {to:'/feed',name:'信息流',icon:"feed"},
 {to:'/search',name:'搜索',icon:"search"},
 {to:'/tags',name:'标签',icon:"tags"},
 {to:'/collections',name:'智能集合',icon:"sparkles"},
 {to:'/activity',name:'活动',icon:"activity"},
 {to:'/archive',name:'归档',icon:"archive"},
 {to:'/graph',name:'关系网',icon:"relationGraph"},
 {to:'/help',name:'语法帮助',icon:"helpBook"},
 {to:'/settings',name:'设置',icon:"settings"}
] as const satisfies readonly {to:string;name:string;icon:IconName}[];
