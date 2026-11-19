import {useEffect,useMemo,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ContextPanel} from '../context-panel';
import {Icon,type IconName} from '../icon';
import {api,mutate,queryString} from '../api';
import {ErrorText,Empty,LoadingRows,PageTitle,ago} from './shared';
import type {FeedItem,FeedObservation,FeedRelation,FeedStateInput} from '../../../src/feed-model';
import '../styles/components/feed.css';


type View='inbox'|'unread'|'saved'|'later'|'dismissed';
type Kind=FeedItem['kind'];
type Detail=FeedItem&{observations:FeedObservation[];relations:FeedRelation[]};
type FeedPageResult={items:FeedItem[];page:{nextCursor:string|null}};
const views:[View,string][]=[['inbox','全部动态'],['unread','未读'],['saved','已收藏'],['later','稍后阅读'],['dismissed','已忽略']];
const kinds:Record<Kind,string>={news:'资讯',release:'版本发布',insight:'Agent 发现',alert:'重要提醒',digest:'摘要'};
const kindIcons:Record<Kind,IconName>={news:'feed',release:'tool',insight:'sparkles',alert:'warning',digest:'list'};
const queryRoot=['feed'] as const;

export function FeedPage(){
 const qc=useQueryClient(),[view,setView]=useState<View>('inbox'),[kind,setKind]=useState<Kind|'all'>('all');
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[opened,setOpened]=useState<string|null>(null);
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<unknown>(null);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),280);return()=>clearTimeout(timer);},[search]);
 const filter=useMemo(()=>({view,kind:kind==='all'?undefined:kind,query}),[view,kind,query]);
 const feed=useInfiniteQuery({
  queryKey:[...queryRoot,'list',filter],
  initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>api<FeedPageResult>('/feed?'+queryString({...filter,cursor:pageParam,limit:20}),{signal}),
  getNextPageParam:page=>page.page.nextCursor??undefined,
  refetchOnMount:'always'
 });
 const items=feed.data?.pages.flatMap(page=>page.items)??[];
 const detail=useQuery({
  queryKey:[...queryRoot,'item',opened],
  enabled:opened!==null,
  queryFn:({signal})=>api<{item:Detail}>('/feed/'+opened,{signal})
 });
 const change=async(id:string,input:FeedStateInput)=>{
  setError(null);setBusy(id+':'+input.action);
  try{
   const result=await mutate<{item:Detail}>('/feed/'+id+'/state',input);
   qc.setQueryData([...queryRoot,'item',id],result);
   await qc.invalidateQueries({queryKey:queryRoot});
  }catch(err){setError(err);}
  finally{setBusy(null);}
 };
 const open=(item:FeedItem)=>{
  setOpened(item.id);
  if(item.state.readRevision<item.revision)void change(item.id,{action:'read'});
 };
 return <div className="page workspace-page feed-page">
  <PageTitle title="信息流" description="由 Agent 提供值得关注的资讯和发现，保存有价值的内容，忽略不相关的信息。"
   actions={<Button label="刷新动态" icon={<Icon name="refresh" size="sm"/>} variant="ghost" size="sm"
    isLoading={feed.isRefetching} onClick={()=>void feed.refetch()}/>}/>
  <section className="feed-filters" aria-label="信息流筛选">
   <div className="feed-views">{views.map(([id,label])=>
    <Button key={id} label={label} size="sm" variant={view===id?'secondary':'ghost'} onClick={()=>setView(id)}/>)}</div>
   <div className="feed-search">
    <TextInput label="搜索动态" isLabelHidden placeholder="搜索标题或摘要" value={search} onChange={setSearch} width="100%" />
    <Selector label="动态类型" isLabelHidden size="sm" variant="secondary" value={kind} onChange={value=>setKind(value as Kind|'all')}
     options={[{value:'all',label:'全部类型'},...Object.entries(kinds).map(([value,label])=>({value,label}))]}/>
   </div>
  </section>
  {error!==null&&<div className="feed-inline-error"><ErrorText error={error}/></div>}
  {feed.isPending?<LoadingRows count={4} kind="activity"/>:feed.isError&&!items.length?
   <div className="feed-inline-error"><ErrorText error={feed.error}/><Button label="重试" variant="secondary" onClick={()=>void feed.refetch()}/></div>:
   !items.length?<Empty title="暂时没有符合条件的动态" description="连接的 Agent 可以通过 publish_feed 投稿。新的内容会出现在这里。"/>:
   <div className="feed-stream">{items.map(item=><article key={item.id} className="feed-card" data-unread={item.state.readRevision<item.revision||undefined}>
    <div className="feed-card-head">
     <span className="feed-card-kind"><Icon name={kindIcons[item.kind]} size="sm"/>{kinds[item.kind]}</span>
     <span className="muted feed-card-time">{ago(item.firstSeenAt)}{item.sourceCount>1?' · '+item.sourceCount+' 个来源':''}</span>
    </div>
    <h2 className="feed-card-title">{item.title}</h2>
    <p className="feed-card-summary">{item.summary}</p>
    {item.whyRelevant&&<div className="feed-card-reason"><Icon name="sparkles" size="sm"/><span>{item.whyRelevant}</span></div>}
    <div className="feed-card-foot">
     <div className="feed-card-actions">
      <Button size="sm" variant="ghost" label="查看详情" onClick={()=>open(item)}/>
      <Button size="sm" variant={item.state.savedAt?'secondary':'ghost'}
       label={item.state.savedAt?'已收藏':'收藏'} icon={<Icon name="bookmark" size="sm"/>}
       isDisabled={busy!==null} onClick={()=>void change(item.id,{action:item.state.savedAt?'unsave':'save'})}/>
      {view==='dismissed'?
       <Button size="sm" variant="ghost" label="恢复" isDisabled={busy!==null} onClick={()=>void change(item.id,{action:'restore'})}/>:
       <Button size="sm" variant="ghost" label="忽略" isDisabled={busy!==null} onClick={()=>void change(item.id,{action:'dismiss'})}/>}
     </div>
     {item.state.readRevision<item.revision?<span className="feed-new-state">未读</span>:null}
    </div>
   </article>)}</div>}
  {feed.isFetchNextPageError&&<ErrorText error={feed.error}/>}
  {feed.hasNextPage&&<div className="feed-load-more"><Button label="加载更多动态" variant="secondary"
   isLoading={feed.isFetchingNextPage} onClick={()=>void feed.fetchNextPage()}/></div>}
  <ContextPanel open={opened!==null} onOpenChange={open=>{if(!open)setOpened(null);}} label="动态详情" id="feed-detail">
   {detail.isPending?<LoadingRows count={3} kind="activity"/>:detail.isError?<ErrorText error={detail.error}/>:detail.data?<div className="feed-detail">
    <div className="feed-detail-head"><span className="feed-card-kind"><Icon name={kindIcons[detail.data.item.kind]} size="sm"/>{kinds[detail.data.item.kind]}</span>
     <Button label="关闭" variant="ghost" size="sm" icon={<Icon name="x" size="sm"/>} onClick={()=>setOpened(null)}/></div>
    <h2>{detail.data.item.title}</h2>
    <p className="feed-detail-lead">{detail.data.item.summary}</p>
    {detail.data.item.whyRelevant&&<section className="feed-detail-section"><h3>为什么推荐</h3><p>{detail.data.item.whyRelevant}</p></section>}
    <section className="feed-detail-section"><h3>来源与证据</h3>
     {detail.data.item.observations.map(observation=><div key={observation.id} className="feed-observation">
      <strong>{observation.publisher||observation.sourceKind}</strong>
      <span className="muted">{observation.actorName} · {ago(observation.observedAt)}</span>
      {observation.evidenceExcerpt&&<p>{observation.evidenceExcerpt}</p>}
      {observation.sourceUrl&&<a href={observation.sourceUrl} target="_blank" rel="noopener noreferrer">查看原始来源 <Icon name="externalLink" size="sm"/></a>}
     </div>)}
    </section>
    {detail.data.item.relations.length>0&&<section className="feed-detail-section"><h3>关联内容</h3>
     {detail.data.item.relations.map((relation,index)=><div key={index} className="feed-relation">
      {relation.targetType==='record'?<Link to="/records/$recordId" params={{recordId:relation.targetId}}>关联文档</Link>:
       relation.targetType==='tag'?<Link to="/tags/$tagId" params={{tagId:relation.targetId}}>相关标签</Link>:
       relation.targetType==='collection'?<Link to="/collections/$collectionId" params={{collectionId:relation.targetId}}>智能集合</Link>:
       <Link to="/tasks">相关任务</Link>}
      <small className="muted">{relation.reason||relation.relation}</small>
     </div>)}
    </section>}
    <section className="feed-detail-section">
     <h3>处理动态</h3>
     <div className="feed-detail-actions">
      <Button label={detail.data.item.state.savedAt?'取消收藏':'收藏'} variant="secondary" size="sm"
       isDisabled={busy!==null} onClick={()=>void change(detail.data.item.id,{action:detail.data.item.state.savedAt?'unsave':'save'})}/>
      <Button label="24 小时后再看" variant="ghost" size="sm" isDisabled={busy!==null}
       onClick={()=>void change(detail.data.item.id,{action:'snooze',until:new Date(Date.now()+86400000).toISOString()})}/>
      <Button label="忽略" variant="ghost" size="sm" isDisabled={busy!==null}
       onClick={()=>void change(detail.data.item.id,{action:'dismiss'})}/>
     </div>
    </section>
    <section className="feed-detail-section"><h3>这条信息有用吗？</h3>
     <p className="muted feed-feedback-description">你的反馈会保留，帮助以后评估推荐与过滤策略。</p>
     <div className="feed-detail-actions">
      <Button label="有帮助" size="sm" variant={detail.data.item.state.feedback==='helpful'?'secondary':'ghost'}
       isDisabled={busy!==null} onClick={()=>void change(detail.data.item.id,{action:'feedback',value:detail.data.item.state.feedback==='helpful'?'clear':'helpful'})}/>
      <Button label="不相关" size="sm" variant={detail.data.item.state.feedback==='irrelevant'?'secondary':'ghost'}
       isDisabled={busy!==null} onClick={()=>void change(detail.data.item.id,{action:'feedback',value:detail.data.item.state.feedback==='irrelevant'?'clear':'irrelevant'})}/>
     </div>
    </section>
   </div>:null}
  </ContextPanel>
 </div>;
}
