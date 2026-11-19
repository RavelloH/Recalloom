import {useEffect,useMemo,useRef,useState} from 'react';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Selector} from '@astryxdesign/core/Selector';
import {ContextPanel} from '../context-panel';
import {Icon} from '../icon';
import {WorkspaceToolbar,WorkspaceSearch} from '../workspace-toolbar';
import {api,mutate,queryString} from '../api';
import {ErrorText,LoadingRows,PageTitle} from './shared';
import {FeedCard} from '../feed/feed-card';
import {FeedDetail,type FeedDetailItem} from '../feed/feed-detail';
import {feedKindLabels} from '../feed/feed-card';
import {groupFeedItems} from '../feed/presentation';
import type {FeedItem,FeedStateInput} from '../../../src/feed-model';
import '../styles/components/feed.css';

type View='inbox'|'unread'|'saved'|'later'|'dismissed';
type Kind=FeedItem['kind'];
type FeedPageResult={items:FeedItem[];page:{nextCursor:string|null}};
const views:[View,string][]=[['inbox','动态'],['unread','未读'],['saved','收藏'],['later','稍后'],['dismissed','已忽略']];
const emptyViews:Record<View,[string,string]>={
 inbox:['暂无新的动态','获得写入权限的 Agent 可以通过 publish_feed 提交经过筛选的资讯和发现。'],
 unread:['全部读完了','有新动态或已有内容出现重要更新时，会再次显示在这里。'],
 saved:['还没有收藏','遇到值得长期关注的动态，可以点击书签保存到这里。'],
 later:['没有稍后阅读的动态','暂时没空阅读？点击动态下方的时钟，即可在 24 小时后再看。'],
 dismissed:['没有已忽略的动态','不感兴趣的内容可以忽略，之后也能在这里恢复。']
};
const queryRoot=['feed'] as const;

export function FeedPage(){
 const qc=useQueryClient();
 const [view,setView]=useState<View>('inbox'),[kind,setKind]=useState<Kind|'all'>('all');
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[opened,setOpened]=useState<string|null>(null);
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<unknown>(null);
 const sentinel=useRef<HTMLDivElement>(null);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer);},[search]);
 const filter=useMemo(()=>({view,kind:kind==='all'?undefined:kind,query}),[view,kind,query]);
 const feed=useInfiniteQuery({
  queryKey:[...queryRoot,'list',filter],
  initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>api<FeedPageResult>('/feed?'+queryString({...filter,cursor:pageParam,limit:20}),{signal}),
  getNextPageParam:page=>page.page.nextCursor??undefined,
  refetchOnMount:'always'
 });
 const items=useMemo(()=>feed.data?.pages.flatMap(page=>page.items)??[],[feed.data]);
 const groups=useMemo(()=>groupFeedItems(items),[items]);
 const detail=useQuery({
  queryKey:[...queryRoot,'item',opened],
  enabled:opened!==null,
  queryFn:({signal})=>api<{item:FeedDetailItem}>('/feed/'+opened,{signal})
 });
 const canLoad=Boolean(feed.hasNextPage&&!feed.isFetchingNextPage&&!feed.isFetchNextPageError);
 useEffect(()=>{
  const element=sentinel.current;
  if(!element||!canLoad)return;
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting))void feed.fetchNextPage();
  },{rootMargin:'280px'});
  observer.observe(element);
  return()=>observer.disconnect();
 },[canLoad,feed.fetchNextPage,items.length]);
 const change=async(id:string,input:FeedStateInput)=>{
  setError(null);
  setBusy(id+':'+input.action);
  try{
   const result=await mutate<{item:FeedDetailItem}>('/feed/'+id+'/state',input);
   qc.setQueryData([...queryRoot,'item',id],result);
   await qc.invalidateQueries({queryKey:queryRoot});
  }catch(err){setError(err);}
  finally{setBusy(null);}
 };
 const open=(item:FeedItem)=>{
  setOpened(item.id);
  if(item.state.readRevision<item.revision)void change(item.id,{action:'read'});
 };
 const filtered=kind!=='all'||query.length>0;
 const [emptyTitle,emptyDescription]=filtered?
  ['没有找到符合条件的动态','试试更换类型或调整搜索关键字。']:emptyViews[view];
 return <div className="page workspace-page feed-page" data-feed-page>
  <PageTitle title="信息流" description="来自 Agent 的新发现，以及与你的知识和项目有关的动态。"
   actions={<IconButton label="刷新信息流" icon={<Icon name="refresh" size="sm"/>}
    variant="ghost" size="sm" isLoading={feed.isRefetching} onClick={()=>void feed.refetch()}/>}/>
  <WorkspaceToolbar filters={<div className="feed-toolbar-filters">
   <nav className="feed-views" aria-label="信息流视图">
    {views.map(([id,label])=><Button key={id} label={label} aria-pressed={view===id}
     size="sm" variant={view===id?'secondary':'ghost'} onClick={()=>setView(id)}/>)}
   </nav>
   <div className="feed-kind-picker"><Selector label="动态类型" isLabelHidden size="sm" variant="secondary" value={kind} onChange={value=>setKind(value as Kind|'all')}
    options={[{value:'all',label:'全部类型'},...Object.entries(feedKindLabels).map(([value,label])=>({value,label}))]} presentation="adaptive"/></div>
  </div>} search={<WorkspaceSearch label="搜索动态" placeholder="搜索标题或摘要…" value={search} onChange={value=>setSearch(value.slice(0,200))}/>}/>
  {error!==null&&<div className="feed-inline-error"><ErrorText error={error}/></div>}
  {feed.isPending?<div className="feed-loading"><LoadingRows kind="activity" count={5}/></div>:
   feed.isError&&!items.length?<div className="feed-inline-error"><ErrorText error={feed.error}/><Button label="重试" variant="secondary" onClick={()=>void feed.refetch()}/></div>:
   !items.length?<div className="feed-empty" role="status">
    <div className="feed-empty-icon"><Icon name={view==='saved'?'bookmark':view==='later'?'clock':view==='unread'?'check':'feed'} size="lg"/></div>
    <h2>{emptyTitle}</h2><p>{emptyDescription}</p>
    {filtered&&<Button label="清除筛选条件" size="sm" variant="secondary" onClick={()=>{setKind('all');setSearch('');setQuery('');}}/>}
   </div>:<>
    <div className="feed-overview">
     <span>{views.find(([id])=>id===view)?.[1]} <span className="feed-overview-count">{items.length}{feed.hasNextPage?'+':''} 条</span></span>
     <span className="feed-overview-order"><Icon name="clock" size="sm"/>按发现时间排序</span>
    </div>
    <div className="feed-stream">
     {groups.map(group=><section key={group.key} className="feed-day" aria-label={group.label}>
      <div className="feed-day-heading"><h2>{group.label}</h2><span>{group.items.length} 条</span></div>
      <div className="feed-day-items">{group.items.map(item=><FeedCard key={item.id} item={item} view={view} busy={busy!==null}
       onOpen={()=>open(item)} onAction={input=>void change(item.id,input)}/>)}</div>
     </section>)}
    </div>
    {feed.isFetchNextPageError&&<div className="feed-inline-error"><ErrorText error={feed.error}/></div>}
    <div ref={sentinel} className="feed-list-bottom">
     {feed.hasNextPage&&!feed.isFetchNextPageError?
      <Button label="加载更多动态" variant="ghost" size="sm" isLoading={feed.isFetchingNextPage} onClick={()=>void feed.fetchNextPage()}/>:
      <span>{feed.isFetchNextPageError?'加载失败，刷新后重试':'已经浏览到这里了'}</span>}
    </div>
   </>}
  <ContextPanel open={opened!==null} onOpenChange={next=>{if(!next)setOpened(null);}} label="动态详情" id="feed-detail">
   {detail.isPending?<LoadingRows kind="activity" count={3}/>:
    detail.isError?<ErrorText error={detail.error}/>:
    detail.data?<FeedDetail item={detail.data.item} busy={busy!==null} onClose={()=>setOpened(null)}
     onAction={input=>void change(detail.data!.item.id,input)}/>:null}
  </ContextPanel>
 </div>;
}
