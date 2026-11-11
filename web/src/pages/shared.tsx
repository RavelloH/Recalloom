import {Icon} from '../icon';
import React from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Heading} from '@astryxdesign/core/Heading';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {ApiError} from '../api';
import {AutoResizer,AutoTransition} from '../motion-primitives';

export function PageTitle({title,description,actions}:{title:string;description?:string;actions?:React.ReactNode}){return <header className="page-header"><div className="page-title-copy"><Heading level={1}>{title}</Heading>{description&&<p className="muted">{description}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</header>;}

export const ErrorText=({error}:{error:unknown})=><Banner status="error" container="section" title="操作失败" description={error instanceof ApiError?error.code==='FOLDER_NOT_EMPTY'?'文件夹中仍有文档、归档记录或子文件夹，请先处理这些内容。':error.status===409?'内容已被其他客户端修改，请刷新后重试。':error.message:error instanceof Error?error.message:'操作失败'}/>;

export const Loading=()=> <div className="content-loading" role="status"><Spinner size="md" shade="subtle" label="正在加载…"/></div>;

export type SkeletonKind='files'|'tasks'|'activity'|'compact';

export const LoadingRows=({count=4,kind='files'}:{count?:number;kind?:SkeletonKind})=><div className={'loading-rows skeleton-'+kind} role="status" aria-label="正在加载内容">
 {Array.from({length:count},(_,i)=>kind==='files'?
  <div className="file-row" key={i}><span className="skeleton-name"><Skeleton width={18} height={18} radius={1}/><Skeleton width={i%2?'49%':'72%'} height={14} radius={1}/></span><span><Skeleton width={40} height={12} radius={1}/></span><span><Skeleton width={76} height={12} radius={1}/></span></div>:
  kind==='tasks'?
  <div className="task-item" key={i}><div className="task-heading"><Skeleton width={22} height={22} radius={1}/><Skeleton width={i%2?'68%':'82%'} height={15} radius={1}/><Skeleton width={22} height={12} radius={1}/></div><div className="task-details"><Skeleton width="92%" height={12} radius={1}/><Skeleton width="65%" height={12} radius={1}/></div><div className="task-footer"><Skeleton width={80} height={12} radius={1}/><Skeleton width={118} height={34} radius={2}/></div></div>:
  kind==='activity'?
  <div className="recent-entry" key={i}><Skeleton width={15} height={15} radius={1}/><div className="loading-lines"><Skeleton width={i%2?'65%':'85%'} height={14} radius={1}/><Skeleton width="30%" height={11} radius={1}/></div><Skeleton width={58} height={11} radius={1}/></div>:
  <div className="compact-row" key={i}><Skeleton width={8} height={8} radius={2}/><Skeleton width={i%2?'62%':'80%'} height={14} radius={1}/><Skeleton width={24} height={11} radius={1}/></div>)}</div>;

export const Empty=({title,description}:{title:string;description?:string})=><EmptyState className="knowledge-empty" title={title} description={description} icon={<Icon name="document" size="lg"/>} isCompact/>;

export const fmt=(v?:string|number)=>{if(v===undefined||v===null)return '—';const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(n):String(v)};

export function Swap({state,children,className}:{state:string;children:React.ReactNode;className?:string}){
 return <AutoResizer className={className}><AutoTransition transitionKey={state}>{children}</AutoTransition></AutoResizer>;
}

export const stateOf=(q:{isPending:boolean;isError:boolean},empty:boolean)=>q.isPending?'loading':q.isError?'error':empty?'empty':'ready';

export const ago=(value?:number|string)=>{
 const time=typeof value==='number'?value:value?Date.parse(value):NaN;
 if(!Number.isFinite(time))return '';
 const minutes=Math.round((time-Date.now())/60000);
 const format=new Intl.RelativeTimeFormat('zh-CN',{numeric:'auto'});
 if(Math.abs(minutes)<1)return '刚刚';
 if(Math.abs(minutes)<60)return format.format(minutes,'minute');
 if(Math.abs(minutes)<60*24)return format.format(Math.round(minutes/60),'hour');
 if(Math.abs(minutes)<60*24*7)return format.format(Math.round(minutes/1440),'day');
 return fmt(time);
};

export const greeting=()=>{const hour=new Date().getHours();return hour<5?'夜深了':hour<11?'早上好':hour<13?'中午好':hour<18?'下午好':'晚上好';};

export const statusNames:Record<string,string>={draft:'草稿',active:'正常',completed:'已完成',superseded:'已取代',archived:'已归档'};
