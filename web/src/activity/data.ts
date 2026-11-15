import {infiniteQueryOptions,queryOptions} from '@tanstack/react-query';
import {api,queryString} from '../api';
import type {Event,Paged} from '../types';
import type {TaskActivity} from '../../../src/activity-types';
import type {ISODateString} from '@astryxdesign/core/Calendar';

export type ActivityFilters={from:ISODateString;to:ISODateString;timeZone:string;actor?:string;categories?:string;query?:string;folderId?:string};
export type ActivityEvent=Event&{seq:number;createdAt:string;details?:Record<string,unknown>&{taskActivity?:TaskActivity}};
export type ActivityDay={day:ISODateString;user:number;agent:number;system:number;unknown:number;total:number};
export type ActivitySummary={totals:{activeDays:number;changes:number;resources:number;completed:number};days:ActivityDay[];contributions:{user:number;agent:number;system:number;unknown:number};actors:Array<{actorKey:string;actorName:string;count:number}>;coverage:{taskTrackingSince:string|null;incompleteTaskEvents:number}};
export const dayString=(date:Date)=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-') as ISODateString;
export function dateRange(days=30){const end=new Date(),start=new Date(end.getFullYear(),end.getMonth(),end.getDate()-(days-1));return {from:dayString(start),to:dayString(end)};}
export const defaultActivityFilters=():ActivityFilters=>({...dateRange(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
export const activityFeedQuery=(filters:ActivityFilters)=>infiniteQueryOptions({
 queryKey:['activity-feed',filters],initialPageParam:undefined as number|undefined,
 queryFn:({pageParam,signal})=>api<Paged<ActivityEvent>>('/activity?'+queryString({...filters,cursor:pageParam,limit:50}),{signal}),
 getNextPageParam:page=>page.page.hasMore&&page.page.nextCursor!=null?Number(page.page.nextCursor):undefined
});
export const activitySummaryQuery=(filters:ActivityFilters)=>queryOptions({queryKey:['activity-summary',filters],queryFn:({signal})=>api<ActivitySummary>('/activity/summary?'+queryString(filters),{signal})});
export const activityDetailQuery=(seq:number)=>queryOptions({queryKey:['activity-detail',seq],queryFn:({signal})=>api<{item:ActivityEvent;path:string|null}>('/activity/'+seq,{signal}),staleTime:60_000});
export const categoryLabels={document:'文档',task:'任务',organization:'整理与关联'};
export const actorLabels={user:'本人',agent:'Agent',system:'系统',unknown:'历史操作方'};
export function taskSummary(activity?:TaskActivity){
 if(!activity)return '';
 const parts=[];
 if(activity.created)parts.push('新增 '+activity.created+' 项任务');
 if(activity.completed)parts.push('完成 '+activity.completed+' 项');
 if(activity.reopened)parts.push('重新打开 '+activity.reopened+' 项');
 if(activity.removed)parts.push('移除 '+activity.removed+' 项');
 if(!parts.length&&activity.updated)parts.push('修改 '+activity.updated+' 项任务');
 return parts.join(' · ');
}
export function eventDescription(event:ActivityEvent){
 const task=taskSummary(event.details?.taskActivity);if(task)return task;
 const action=event.details?.action;
 if(action==='reorder'||action==='board_reorder'||action==='place_tasks')return '调整任务顺序';
 if(event.operation==='tag_add')return '添加标签'+(event.details?.tag?'「'+String(event.details.tag)+'」':'');
 if(event.operation==='tag_remove')return '移除标签'+(event.details?.tag?'「'+String(event.details.tag)+'」':'');
 if(event.operation==='link_add')return '添加文档关联';
 if(event.operation==='link_remove')return '移除文档关联';
 if(event.operation==='restore'||action==='restore')return '恢复历史版本';
 return ({create:'创建',update:'更新',metadata:'修改信息',folder_update:'修改文件夹',kind_migrate:'转换类型'} as Record<string,string>)[event.operation??'']??'修改';
}
export type ActivityGroup={key:number;day:string;events:ActivityEvent[]};
export function groupActivity(items:ActivityEvent[],timeZone:string):ActivityGroup[]{
 const date=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}),groups:ActivityGroup[]=[];
 for(const item of items){
  const day=date.format(new Date(item.createdAt)),last=groups.at(-1),previous=last?.events.at(-1);
  if(last&&previous&&last.day===day&&item.actor===previous.actor&&item.entityId===previous.entityId&&item.operation==='update'&&previous.operation==='update'&&previous.category===item.category&&Date.parse(previous.createdAt)-Date.parse(item.createdAt)<=10*60_000)last.events.push(item);
  else groups.push({key:item.seq,day,events:[item]});
 }
 return groups;
}
