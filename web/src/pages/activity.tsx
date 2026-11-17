import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Selector} from '@astryxdesign/core/Selector';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {WorkspaceToolbar,WorkspaceSearch} from '../workspace-toolbar';
import {DateInput} from '@astryxdesign/core/DateInput';
import type {ISODateString} from '@astryxdesign/core/Calendar';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Icon} from '../icon';
import {api,queryString} from '../api';
import type {Paged} from '../types';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {ActivityChart} from '../activity/chart';
import {ActivityTimeline} from '../activity/timeline';
import {activityFeedQuery,activitySummaryQuery,categoryLabels,dateRange,dayString,defaultActivityFilters,groupActivity,type ActivityEvent} from '../activity/data';
import type {ActivitySession} from '../activity/detail';
import {PageTitle,ErrorText,LoadingRows,Empty} from './shared';
import '../activity/activity.css';

const ActivityDetail=lazy(()=>import('../activity/detail').then(module=>({default:module.ActivityDetail})));
type Folder={id:string;name:string;path:string};
const categories=Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>;
const metricLabels={activeDays:'活跃天数',changes:'变更次数',resources:'涉及内容',completed:'完成任务'};

export function ActivityPage(){
 const [range,setRange]=useState(defaultActivityFilters),[preset,setPreset]=useState('30'),[actor,setActor]=useState('all'),[selectedCategories,setCategories]=useState<string[]>(categories);
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[more,setMore]=useState(false),[folderId,setFolderId]=useState('all'),[selectedDay,setSelectedDay]=useState<ISODateString|null>(null);
 const [sessions,setSessions]=useState<ActivitySession[]>([]),activation=useRef(0),sentinel=useRef<HTMLDivElement>(null);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(search.trim());setSelectedDay(null);},220);return()=>clearTimeout(timer);},[search]);
 const filters=useMemo(()=>({...range,actor:actor==='all'?undefined:actor,categories:selectedCategories.join(','),query:query||undefined,folderId:folderId==='all'?undefined:folderId}),[range,actor,selectedCategories,query,folderId]);
 const feedFilters=useMemo(()=>selectedDay?{...filters,from:selectedDay,to:selectedDay}:filters,[filters,selectedDay]);
 const summary=useQuery(activitySummaryQuery(filters)),feed=useInfiniteQuery(activityFeedQuery(feedFilters));
 const folders=useInfiniteQuery({queryKey:['activity-folders'],enabled:more||folderId!=='all',initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>api<Paged<Folder>>('/activity/folders?'+queryString({cursor:pageParam}),{signal}),getNextPageParam:page=>page.page.hasMore?String(page.page.nextCursor):undefined,staleTime:60_000});
 useEffect(()=>{if(more&&folders.hasNextPage&&!folders.isFetchingNextPage&&!folders.isFetchNextPageError)void folders.fetchNextPage();},[more,folders.hasNextPage,folders.isFetchingNextPage,folders.isFetchNextPageError,folders.fetchNextPage]);
 const items=useMemo(()=>feed.data?.pages.flatMap(page=>page.items)??[],[feed.data]);
 const groups=useMemo(()=>groupActivity(items,range.timeZone),[items,range.timeZone]);
 const folderOptions=useMemo(()=>folders.data?.pages.flatMap(page=>page.items).sort((a,b)=>a.path.localeCompare(b.path))??[],[folders.data]);
 const canLoad=Boolean(feed.hasNextPage&&!feed.isFetchingNextPage&&!feed.isFetchNextPageError);
 useEffect(()=>{
  const element=sentinel.current;if(!element||!canLoad)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void feed.fetchNextPage();},{rootMargin:'300px'});
  observer.observe(element);return()=>observer.disconnect();
 },[canLoad,feed.fetchNextPage,items.length]);
 const open=useCallback((event:ActivityEvent)=>{const token=++activation.current;setSessions(current=>current.some(item=>item.event.seq===event.seq)?current.map(item=>item.event.seq===event.seq?{event,open:true,activation:token}:item):[...current,{event,open:true,activation:token}]);},[]);
 const refresh=()=>{void summary.refetch();void feed.refetch();};
 const choosePreset=(value:string)=>{setPreset(value);setSelectedDay(null);if(value!=='custom')setRange(current=>({...current,...dateRange(Number(value))}));};
 const updateRange=(part:'from'|'to',value:ISODateString|undefined)=>{if(!value)return;setRange(current=>({...current,[part]:value,...(part==='from'&&value>current.to?{to:value}:part==='to'&&value<current.from?{from:value}:{})}));setSelectedDay(null);};
 const coverage=summary.data?.coverage,coverageStart=coverage?.taskTrackingSince?dayString(new Date(coverage.taskTrackingSince)):null;
 const partialTasks=Boolean(coverageStart&&(range.from<coverageStart||coverage?.incompleteTaskEvents));
 const contentKey=feed.isPending?'pending':feed.isError&&!items.length?'error':groups.length?'ready':'empty';
 return <div className="page workspace-page activity-page" data-activity-page>
  <PageTitle title="活动" description="回顾知识库的变化，了解每一步进展。" actions={<IconButton label="刷新活动" variant="ghost" size="sm" icon={<Icon name="refresh" size="sm"/>} onClick={refresh} isLoading={summary.isFetching||feed.isRefetching}/>}/>
  <WorkspaceToolbar filters={<>
   <Selector label="时间范围" isLabelHidden size="sm" variant="secondary" value={preset} onChange={choosePreset} options={[{value:'1',label:'今天'},{value:'7',label:'最近 7 天'},{value:'30',label:'最近 30 天'},{value:'custom',label:'自定义时间'}]} presentation="adaptive"/>
   <Selector label="操作方" isLabelHidden size="sm" variant="secondary" value={actor} onChange={value=>{setActor(value);setSelectedDay(null);}} hasSearch options={[{value:'all',label:'所有操作方'},{value:'user',label:'本人'},{value:'agent',label:'全部 Agent'},{value:'system',label:'系统'},{value:'unknown',label:'历史操作方'},...(summary.data?.actors??[]).map(item=>({value:item.actorKey,label:item.actorName}))]} presentation="adaptive"/>
   <div className="activity-type-filter"><MultiSelector label="活动类型" isLabelHidden size="sm" variant="secondary" value={selectedCategories} onChange={values=>{setCategories(categories.filter(value=>values.includes(value)));setSelectedDay(null);}} options={categories.map(value=>({value,label:categoryLabels[value]}))} hasSelectAll hasClear selectAllLabel="全部类型" placeholder="未选择类型" formatValue={values=>values.length===3?'全部类型':values.length===1?values[0].label:values.length+' 种类型'} presentation="adaptive"/>
   <IconButton label="更多筛选" variant={more||folderId!=='all'?'secondary':'ghost'} size="sm" icon={<Icon name="filter" size="sm"/>} aria-expanded={more} onClick={()=>setMore(value=>!value)}/></div>
  </>} search={<WorkspaceSearch label="搜索活动" placeholder="搜索内容或操作方…" value={search} onChange={value=>setSearch(value.slice(0,200))}/>}/>
  <AutoResizer><AutoTransition transitionKey={preset+':'+more}>{(preset==='custom'||more)&&<div className="activity-extra-filters">
   {preset==='custom'&&<div className="activity-custom-range"><DateInput label="开始日期" size="sm" value={range.from} max={range.to} onChange={value=>updateRange('from',value)}/><span className="muted">至</span><DateInput label="结束日期" size="sm" value={range.to} min={range.from} max={dayString(new Date())} onChange={value=>updateRange('to',value)}/><span className="tiny muted">最多选择 366 天</span></div>}
   {more&&<div className="activity-scope-filter"><Selector label="文件夹范围" size="sm" value={folderId} onChange={value=>{setFolderId(value);setSelectedDay(null);}} hasSearch options={[{value:'all',label:'整个知识库'},...folderOptions.map(folder=>({value:folder.id,label:folder.path}))]} presentation="adaptive"/>{folders.isError&&<Button label="重新加载文件夹" variant="ghost" size="sm" onClick={()=>void folders.refetch()}/>}</div>}
  </div>}</AutoTransition></AutoResizer>
  <section className="activity-overview" aria-label="所选时间范围的活动统计" aria-busy={summary.isFetching}>
   <div className="activity-period muted">{range.from.replaceAll('-','/')} — {range.to.replaceAll('-','/')}<span>{summary.data?summary.data.contributions.agent+' 次 Agent 变更 · '+summary.data.contributions.user+' 次本人变更':'活动概览'}</span></div>
   {summary.isError&&<ErrorText error={summary.error}/>}
   {(!summary.isError||summary.data)&&<div className="activity-metrics">{(Object.keys(metricLabels) as Array<keyof typeof metricLabels>).map(key=><div key={key} className="activity-metric" data-activity-metric={key}>
    <span className="muted">{metricLabels[key]}</span><AutoTransition transitionKey={summary.isPending?'pending':String(summary.data?.totals[key]??0)}>{summary.isPending?<Skeleton width={64} height={32} radius={1}/>:<strong>{(summary.data?.totals[key]??0).toLocaleString('zh-CN')}</strong>}</AutoTransition>
    <span className="activity-metric-caption muted">{key==='activeDays'?'有修改的日期':key==='changes'?'成功提交的操作':key==='resources'?'去重的文档与任务列表':partialTasks?'自 '+coverageStart?.replaceAll('-','/')+' 起':'转为已完成的任务'}</span>
   </div>)}</div>}
   <AutoTransition transitionKey={summary.isPending?'pending':summary.isError?'error':JSON.stringify(filters)}>{summary.isPending?<div className="activity-chart-loading"><Skeleton width="100%" height={160} radius={2}/></div>:summary.data?<ActivityChart days={summary.data.days} agents={summary.data.agents} selectedDay={selectedDay} onSelect={setSelectedDay}/>:null}</AutoTransition>
   {partialTasks&&<p className="activity-coverage muted"><Icon name="infoCircle" size="sm"/>任务完成统计自 {coverageStart?.replaceAll('-','/')} 起记录，早期活动仍可在下方查看。{Boolean(coverage?.incompleteTaskEvents)&&'所选范围包含缺少逐项变化的历史记录。'}</p>}
  </section>
  <section className="activity-history" aria-label="活动时间线"><div className="activity-section-heading"><div><h2>活动记录</h2><p className="muted">连续修改合并显示，原始记录完整保留。</p></div>
   <AutoTransition transitionKey={selectedDay??'all'}>{selectedDay?<Button label={selectedDay+' · 清除'} variant="secondary" size="sm" icon={<Icon name="x" size="sm"/>} onClick={()=>setSelectedDay(null)}/>:<span className="muted tiny">按时间倒序</span>}</AutoTransition>
  </div>
  {feed.isRefetchError&&items.length>0&&<ErrorText error={feed.error}/>}
  <AutoTransition transitionKey={JSON.stringify(feedFilters)+':'+contentKey}>{feed.isPending?<LoadingRows kind="activity" count={5}/>:feed.isError&&!items.length?<div><ErrorText error={feed.error}/><Button label="重新加载活动" size="sm" variant="ghost" onClick={()=>void feed.refetch()}/></div>:groups.length?<ActivityTimeline groups={groups} onOpen={open}/>:<Empty title={selectedCategories.length?'这个范围内暂无活动':'选择要显示的活动类型'} description="可以调整时间、操作方或其他筛选条件。"/>}</AutoTransition>
  <div ref={sentinel} className="activity-load-more">{feed.isFetchingNextPage?<Spinner size="sm" label="正在加载更多活动…"/>:feed.isFetchNextPageError?<><ErrorText error={feed.error}/><Button label="重新加载更多" variant="ghost" size="sm" onClick={()=>void feed.fetchNextPage()}/></>:feed.hasNextPage?<Button label="加载更多活动" variant="ghost" size="sm" onClick={()=>void feed.fetchNextPage()}/>:items.length>0?<span className="muted tiny">已显示所选范围内的全部活动</span>:null}</div>
  </section>
  <Suspense fallback={null}>{sessions.map(session=><ActivityDetail key={session.event.seq} session={session} onClose={()=>setSessions(current=>current.map(item=>item.event.seq===session.event.seq?{...item,open:false}:item))} onRemove={()=>setSessions(current=>current.filter(item=>item.event.seq!==session.event.seq))}/>)}</Suspense>
 </div>;
}
