import {infiniteQueryOptions,queryOptions} from '@tanstack/react-query';
import {api,queryString} from '../api';
import type {Paged,Task} from '../types';

export type TaskStatus=Task['status'];
export type TaskCounts=Record<TaskStatus,number>;
export type TaskList={id:string;name:string;path:string;folderId:string|null;status:string;revision:number;order:'priority'|'manual';counts:TaskCounts;total:number};
export type TaskItem=Task&{position:number;updatedAt:string;list:TaskList};
export type TaskScope={recordId?:string;query?:string};
export type TaskListsPage=Paged<TaskList>&{counts:TaskCounts};
export const taskStatuses:TaskStatus[]=['todo','in_progress','blocked','done','cancelled'];
export const statusLabels:Record<TaskStatus,string>={todo:'待开始',in_progress:'进行中',blocked:'阻塞',done:'已完成',cancelled:'取消'};
export const emptyCounts:TaskCounts={todo:0,in_progress:0,blocked:0,done:0,cancelled:0};
export const taskListPages=(scope:TaskScope={})=>infiniteQueryOptions({
 queryKey:['task-workspace','lists',scope.recordId??null,scope.query??''],
 initialPageParam:null as string|null,
 queryFn:({pageParam,signal})=>api<TaskListsPage>('/task-lists?'+queryString({...scope,limit:40,cursor:pageParam}),{signal}),
 getNextPageParam:(page:TaskListsPage)=>page.page.nextCursor as string|null,
 staleTime:15000
});
export const taskPages=(scope:TaskScope,statuses:TaskStatus[])=>infiniteQueryOptions({
 queryKey:['task-workspace','view',scope.recordId??null,scope.query??'',statuses.join(',')],
 initialPageParam:null as string|null,
 queryFn:({pageParam,signal})=>api<Paged<TaskItem>>('/tasks/view?'+queryString({...scope,statuses:statuses.join(','),limit:40,cursor:pageParam}),{signal}),
 getNextPageParam:(page:Paged<TaskItem>)=>page.page.nextCursor as string|null,
 staleTime:15000
});
export const taskItemQuery=(id:string)=>queryOptions({queryKey:['task-workspace','item',id],queryFn:({signal})=>api<{item:TaskItem}>('/tasks/'+encodeURIComponent(id),{signal}),staleTime:0});

type Preferences={version:1;view:'board'|'list';statuses:TaskStatus[]};
const preferenceKey='recalloom:tasks:v1';
export function readTaskPreferences():Preferences{
 try{
  const value=JSON.parse(localStorage.getItem(preferenceKey)??'null') as Partial<Preferences>|null;
  if(value?.version===1&&Array.isArray(value.statuses))return {version:1,view:value.view==='list'?'list':'board',statuses:taskStatuses.filter(s=>value.statuses!.includes(s))};
 }catch{/* Storage is optional in private browsing. */}
 return {version:1,view:'board',statuses:[...taskStatuses]};
}
export function writeTaskPreferences(view:'board'|'list',statuses:TaskStatus[]){try{localStorage.setItem(preferenceKey,JSON.stringify({version:1,view,statuses}));}catch{/* Keep this session usable without storage. */}}
