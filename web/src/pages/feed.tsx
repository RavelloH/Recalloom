import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Selector} from '@astryxdesign/core/Selector';
import {Icon} from '../icon';
import {WorkspaceToolbar,WorkspaceSearch} from '../workspace-toolbar';
import {api,mutate,queryString} from '../api';
import {ErrorText,LoadingRows,PageTitle} from './shared';
import {FeedCard,feedKindLabels} from '../feed/feed-card';
import type {FeedDetailItem} from '../feed/feed-detail';
import {FeedPanels,type FeedPanelSession} from '../feed/feed-panels';
import {groupFeedItems} from '../feed/presentation';
import type {FeedItem,FeedStateInput} from '../../../src/feed-model';
import '../styles/components/feed.css';

type View='inbox'|'unread'|'read'|'saved'|'interested'|'not_interested';
type Kind=FeedItem['kind'];
type FeedPageResult={items:FeedItem[];page:{nextCursor:string|null}};
const views:[View,string][]=[
 ['inbox','动态'],['unread','未读'],['read','已读'],['saved','收藏'],['interested','感兴趣'],['not_interested','不感兴趣']
];
const emptyViews:Record<View,[string,string]>={
 inbox:['暂无新的动态','获得写入权限的 Agent 可以通过 publish_feed 提交经过筛选的资讯和发现。'],
 unread:['全部读完了','当你在屏幕中阅读一条动态足够久，它就会被自动标记为已读。'],
 read:['还没有已读动态','浏览过但未主动表达兴趣的内容会出现在这里。'],
 saved:['还没有收藏','特别想长期保留的动态，可以使用收藏按钮。'],
 interested:['还没有感兴趣的动态','你表示有兴趣的内容会汇集在这里。'],
 not_interested:['还没有不感兴趣的动态','明确不想继续收到同类推荐的内容会汇集在这里。']
};
const queryRoot=['feed'] as const;
const effectiveTime=(item:FeedItem)=>item.publishedAt??item.firstSeenAt;

/** Only sustained, intentional visibility counts as reading, never a transient scroll pass. */
function useFeedAutoRead(container:React.RefObject<HTMLDivElement|null>,items:FeedItem[],onRead:(id:string)=>void){
 useEffect(()=>{
  const parent=container.current;
  if(!parent||!('IntersectionObserver' in window))return;
  const timers=new Map<string,ReturnType<typeof setTimeout>>();
  const seen=new Set<string>();
  const visibleEnough=(element:HTMLElement)=>{
   const rect=element.getBoundingClientRect();
   const overlap=Math.max(0,Math.min(rect.bottom,window.innerHeight)-Math.max(rect.top,0));
   return overlap>=Math.min(rect.height*.65,window.innerHeight*.6);
  };
  const cancel=(id:string)=>{clearTimeout(timers.get(id));timers.delete(id);};
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    const el=entry.target as HTMLElement,id=el.dataset.feedId;
    if(!id)continue;
    if(!entry.isIntersecting||!visibleEnough(el)||document.visibilityState!=='visible'||!document.hasFocus()){
     cancel(id);continue;
    }
    if(seen.has(id)||timers.has(id))continue;
    timers.set(id,setTimeout(()=>{
     timers.delete(id);
     if(el.isConnected&&document.visibilityState==='visible'&&document.hasFocus()&&visibleEnough(el)){
      seen.add(id);onRead(id);
     }
    },1400));
   }
  },{threshold:[0,.15,.35,.65,.85]});
  parent.querySelectorAll<HTMLElement>('.feed-story[data-unread]').forEach(element=>observer.observe(element));
  const halt=()=>{for(const id of timers.keys())cancel(id);};
  const resume=()=>{
   if(document.visibilityState!=='visible'||!document.hasFocus())return;
   parent.querySelectorAll<HTMLElement>('.feed-story[data-unread]').forEach(el=>{observer.unobserve(el);observer.observe(el);});
  };
  const onVisibility=()=>{if(document.visibilityState!=='visible')halt();else resume();};
  document.addEventListener('visibilitychange',onVisibility);
  window.addEventListener('blur',halt);
  window.addEventListener('focus',resume);
  return()=>{observer.disconnect();halt();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('blur',halt);window.removeEventListener('focus',resume);};
 },[container,items,onRead]);
}

export function FeedPage(){
 const qc=useQueryClient();
 const reduce=useReducedMotion();
 const [view,setView]=useState<View>('inbox'),[kind,setKind]=useState<Kind|'all'>('all');
 const [search,setSearch]=useState(''),[query,setQuery]=useState('');
 const [panels,setPanels]=useState<FeedPanelSession[]>([]);
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<unknown>(null);
 const [version,setVersion]=useState(0);
 const sentinel=useRef<HTMLDivElement>(null),stream=useRef<HTMLDivElement>(null);
 const unreadSnapshot=useRef<Map<string,FeedItem>>(new Map());
 const removedFromUnread=useRef(new Set<string>());
 const reading=useRef(new Set<string>());
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer);},[search]);
 const changeView=(next:View)=>{unreadSnapshot.current.clear();removedFromUnread.current.clear();setView(next);};
 const filter=useMemo(()=>({view,kind:kind==='all'?undefined:kind,query}),[view,kind,query]);
 const feed=useInfiniteQuery({
  queryKey:[...queryRoot,'list',filter],
  initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>api<FeedPageResult>('/feed?'+queryString({...filter,cursor:pageParam,limit:20}),{signal}),
  getNextPageParam:page=>page.page.nextCursor??undefined,
  refetchOnMount:'always'
 });
 const items=useMemo(()=>{
  const remote=feed.data?.pages.flatMap(page=>page.items)??[];
  if(view!=='unread')return remote;
  // Keep read-during-this-visit cards in place; a fresh tab visit starts a new snapshot.
  for(const item of remote){
   if(removedFromUnread.current.has(item.id))continue;
   const old=unreadSnapshot.current.get(item.id);
   if(!old||item.revision>old.revision)unreadSnapshot.current.set(item.id,item);
  }
  return [...unreadSnapshot.current.values()].sort((a,b)=>effectiveTime(b).localeCompare(effectiveTime(a))||b.id.localeCompare(a.id));
 },[feed.data,view,version]);
 const groups=useMemo(()=>groupFeedItems(items),[items]);
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
 const change=useCallback(async(id:string,input:FeedStateInput)=>{
  if(input.action==='read'){
   if(reading.current.has(id))return;
   reading.current.add(id);
  }else{setBusy(id);}
  setError(null);
  try{
   const result=await mutate<{item:FeedDetailItem}>('/feed/'+id+'/state',input);
   qc.setQueryData([...queryRoot,'item',id],result);
   if(view==='unread'){
    if(input.action==='read')unreadSnapshot.current.set(id,result.item);
    else{unreadSnapshot.current.delete(id);removedFromUnread.current.add(id);}
    setVersion(value=>value+1);
   }
   await qc.invalidateQueries({queryKey:queryRoot});
  }catch(err){setError(err);}
  finally{
   if(input.action==='read')reading.current.delete(id);
   else setBusy(null);
  }
 },[qc,view]);
 const autoRead=useCallback((id:string)=>{void change(id,{action:'read'});},[change]);
 useFeedAutoRead(stream,items,autoRead);
 const open=(item:FeedItem)=>{
  setPanels(current=>{
   const existing=current.find(panel=>panel.id===item.id);
   return existing?current.map(panel=>panel.id===item.id
    ?{...panel,open:true,activation:panel.activation+1}:panel)
    :[...current,{id:item.id,open:true,activation:1}];
  });
  if(item.state.readRevision<item.revision)void change(item.id,{action:'read'});
 };
 const closePanel=useCallback((id:string)=>setPanels(current=>current.map(panel=>
  panel.id===id?{...panel,open:false}:panel)),[]);
 const removePanel=useCallback((id:string)=>setPanels(current=>current.filter(panel=>
  panel.id!==id||panel.open)),[]);

 const filtered=kind!=='all'||query.length>0;
 const [emptyTitle,emptyDescription]=filtered?
  ['没有找到符合条件的动态','试试更换类型或调整搜索关键字。']:emptyViews[view];
 const duration=reduce?0:.22;
 return <div className="page workspace-page feed-page" data-feed-page>
  <PageTitle title="信息流" description="来自 Agent 的新发现，以及与你的知识和项目有关的动态。"
   actions={<IconButton label="刷新信息流" icon={<Icon name="refresh" size="sm"/>}
    variant="ghost" size="sm" isLoading={feed.isRefetching} onClick={()=>void feed.refetch()}/>}/>
  <WorkspaceToolbar filters={<div className="feed-toolbar-filters">
   <nav className="feed-views" aria-label="信息流视图">
    {views.map(([id,label])=><Button key={id} label={label} aria-pressed={view===id}
     size="sm" variant={view===id?'secondary':'ghost'} onClick={()=>changeView(id)}/>)}
   </nav>
   <div className="feed-kind-picker"><Selector label="动态类型" isLabelHidden size="sm" variant="secondary" value={kind} onChange={value=>{unreadSnapshot.current.clear();removedFromUnread.current.clear();setKind(value as Kind|'all');}}
    options={[{value:'all',label:'全部类型'},...Object.entries(feedKindLabels).map(([value,label])=>({value,label}))]} presentation="adaptive"/></div>
  </div>} search={<WorkspaceSearch label="搜索动态" placeholder="搜索标题或摘要…" value={search} onChange={value=>{unreadSnapshot.current.clear();removedFromUnread.current.clear();setSearch(value.slice(0,200));}}/>}/>
  {error!==null&&<div className="feed-inline-error"><ErrorText error={error}/></div>}
  {feed.isPending?<div className="feed-loading"><LoadingRows kind="activity" count={5}/></div>:
   feed.isError&&!items.length?<div className="feed-inline-error"><ErrorText error={feed.error}/><Button label="重试" variant="secondary" onClick={()=>void feed.refetch()}/></div>:
   !items.length?<div className="feed-empty" role="status">
    <div className="feed-empty-icon"><Icon name={view==='saved'?'bookmark':view==='unread'?'check':'feed'} size="lg"/></div>
    <h2>{emptyTitle}</h2><p>{emptyDescription}</p>
    {filtered&&<Button label="清除筛选条件" size="sm" variant="secondary" onClick={()=>{unreadSnapshot.current.clear();removedFromUnread.current.clear();setKind('all');setSearch('');setQuery('');}}/>}
   </div>:<>
    <div className="feed-overview">
     <span>{views.find(([id])=>id===view)?.[1]} <span className="feed-overview-count">{items.length}{feed.hasNextPage?'+':''} 条</span></span>
     <span className="feed-overview-order"><Icon name="clock" size="sm"/>按发布时间排序</span>
    </div>
    <div ref={stream} className="feed-stream">
     <AnimatePresence initial={false} mode="popLayout">
      {groups.map(group=><motion.section key={group.key} layout initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
       exit={{opacity:0,y:-6}} transition={{duration}} className="feed-day" aria-label={group.label}>
       <div className="feed-day-heading"><h2>{group.label}</h2><span>{group.items.length} 条</span></div>
       <div className="feed-day-items">
        <AnimatePresence initial={false} mode="popLayout">
         {group.items.map(item=><motion.div key={item.id} layout initial={{opacity:0,y:8,scale:.99}}
          animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-8,scale:.985}}
          transition={{duration}}><FeedCard item={item} view={view} busy={busy===item.id}
           onOpen={()=>open(item)} onAction={input=>void change(item.id,input)}/></motion.div>)}
        </AnimatePresence>
       </div>
      </motion.section>)}
     </AnimatePresence>
    </div>
    {feed.isFetchNextPageError&&<div className="feed-inline-error"><ErrorText error={feed.error}/></div>}
    <div ref={sentinel} className="feed-list-bottom">
     {feed.hasNextPage&&!feed.isFetchNextPageError?
      <Button label="加载更多动态" variant="ghost" size="sm" isLoading={feed.isFetchingNextPage} onClick={()=>void feed.fetchNextPage()}/>:
      <span>{feed.isFetchNextPageError?'加载失败，刷新后重试':'已经浏览到这里了'}</span>}
    </div>
   </>}
  <FeedPanels sessions={panels} busy={busy} onClose={closePanel} onAfterClose={removePanel}
   onAction={(id,input)=>void change(id,input)}/>
 </div>;
}
