import {useEffect,useRef,useState,type ReactNode} from 'react';
import {SegmentedControl,SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Icon} from '../icon';
import {Link} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {ActivityEntry} from '../activity-entry';
import {useRecentPages} from '../recent-pages';
import {sharedSourceAttributes,markSharedNavigationSource} from '../shared-view-transition';
import {documentDisplayName} from '../document-filename';
import {activityQuery,recentUpdatesQuery,tasksQuery} from '../queries';
import {PageTitle,ErrorText,LoadingRows,Empty,ago,greeting} from './shared';
import {AutoResizer,AutoTransition} from '../motion-primitives';

type RecentMode='visited'|'updated';
const recentModeKey='recalloom:home-recent-mode';
function initialRecentMode():RecentMode{
 try{return sessionStorage.getItem(recentModeKey)==='updated'?'updated':'visited';}
 catch{return 'visited';}
}

/** Owns the scroll/edge-fade lifecycle for each mounted transition pane.
 * An exiting pane and its replacement must NEVER share a ref or observer. */
function RecentRail({children,loading=false,itemCount}:{children:ReactNode;loading?:boolean;itemCount:number}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const rail=ref.current;
  if(!rail)return;
  const update=()=>{
   const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
   rail.dataset.canScrollLeft=rail.scrollLeft>2?'true':'false';
   rail.dataset.canScrollRight=rail.scrollLeft<max-2?'true':'false';
  };
  rail.addEventListener('scroll',update,{passive:true});
  const observer=new ResizeObserver(update);
  observer.observe(rail);
  for(const child of rail.children)observer.observe(child);
  update();
  return ()=>{rail.removeEventListener('scroll',update);observer.disconnect();};
 },[itemCount,loading]);
 return <div className="recent-pages" ref={ref} role={loading?'status':undefined}
  aria-label={loading?'正在加载最近更新':undefined}>{children}</div>;
}

export function HomePage(){
 const [recentMode,setRecentMode]=useState<RecentMode>(initialRecentMode);
 const recentModeHasSwitched=useRef(false);
 const switchRecentMode=(next:string)=>{
  const mode:RecentMode=next==='updated'?'updated':'visited';
  recentModeHasSwitched.current=true;
  setRecentMode(mode);
  try{sessionStorage.setItem(recentModeKey,mode);}catch{/* private browsing */}
 };
 const {data:todo,isPending,isError,error:todoError}=useQuery(tasksQuery());
 const events=useQuery(activityQuery());
 const updated=useQuery({...recentUpdatesQuery(),enabled:recentMode==='updated'});
 const recent=useRecentPages();
 const cards=recentMode==='visited'?recent:updated.data?.items??[];
 const active=todo?.items.filter(t=>!['done','cancelled'].includes(t.status))??[];
 const shortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ K':'Ctrl K';
 return <div className="page home-page"><PageTitle title="概览" description={greeting()+'。从最近的页面继续，或查看待办与近期变化。'}/>
 <section className="home-section" aria-label="最近访问与更新">
  <div className="recent-mode-heading">
   <SegmentedControl value={recentMode} onChange={switchRecentMode} label="最近记录分类" size="lg" layout="hug">
    <SegmentedControlItem value="visited" label="最近访问" icon={<Icon name="clock" size="sm"/>}/>
    <SegmentedControlItem value="updated" label="最近更新" icon={<Icon name="updated" size="sm"/>}/>
   </SegmentedControl>
  </div>
  <AutoResizer className="home-recent-resizer">
   <AutoTransition transitionKey={recentMode} className="home-recent-content" duration={.18}>
    {recentMode==='updated'&&updated.isPending?<RecentRail loading itemCount={4}>
     {Array.from({length:4},(_,index)=><div className="recent-page" key={index}>
      <span className="recent-page-cover" aria-hidden="true"/>
      <span className="recent-page-icon"><Skeleton width={20} height={20} radius={1}/></span>
      <strong className="recent-page-name"><Skeleton width={index%2?'74%':'93%'} height={16} radius={1}/></strong>
      <small className="recent-page-meta"><Skeleton width={64} height={12} radius={1}/></small>
     </div>)}
    </RecentRail>
    :recentMode==='updated'&&updated.isError?<div className="home-recent-feedback"><ErrorText error={updated.error}/></div>
    :cards.length?<RecentRail itemCount={cards.length}>{cards.slice(0,8).map(page=>{
   const sourceKey=(recentMode==='visited'?'recent:':'updated:')+page.id;
   const timestamp=recentMode==='visited'?'visitedAt':'updatedAt';
   const meta=timestamp==='visitedAt'&&'visitedAt' in page?page.visitedAt:'updatedAt' in page?page.updatedAt:undefined;
   return <Link key={page.id} to="/records/$recordId" params={{recordId:page.id}} className={'recent-page'+(recentModeHasSwitched.current?' recent-page-enter':'')} onClick={()=>markSharedNavigationSource(sourceKey)}>
    <span className="recent-page-cover" aria-hidden="true"/>
    <span className="recent-page-icon" aria-hidden="true">{page.kind==='task_list'?<Icon name="taskList" size="md"/>:<Icon name="document" size="md"/>}</span>
    <strong className="recent-page-name"><span className="rk-shared-text" {...sharedSourceAttributes('record',page.id,sourceKey)}>{page.kind==='document'?documentDisplayName(page.name):page.name}</span>{page.kind==='document'&&/\.md$/i.test(page.name)&&<span className="rk-shared-extension">{page.name.slice(-3)}</span>}</strong>
    <small className="recent-page-meta truncate" title={recentMode==='updated'&&'actorName' in page&&page.actorName?String(page.actorName):undefined}>{ago(meta)}{recentMode==='updated'&&'actorName' in page&&page.actorName?' · '+page.actorName:''}</small>
   </Link>;
  })}</RecentRail>
    :<div className="recent-empty"><p className="muted small">{recentMode==='updated'?'暂无内容更新记录。':'最近打开的页面会显示在这里。按 '+shortcut+' 可随时搜索。'}</p><Link to="/library" className="small text-link">浏览知识库</Link></div>}
   </AutoTransition>
  </AutoResizer>
 </section>
 <div className="dashboard-grid">
  <section className="home-card"><div className="panel-heading"><h2>未完成事项</h2><Link to="/tasks">查看全部</Link></div>
   {isPending?<LoadingRows kind="compact" count={5}/>:isError?<ErrorText error={todoError}/>:active.length?active.slice(0,5).map(t=><div className="compact-row" key={t.id}><span className={'status-dot '+t.status}/><Link to="/records/$recordId" params={{recordId:t.recordId}} search={{task:t.id}} resetScroll={false} onClick={()=>markSharedNavigationSource('todo:'+t.id)}><span className="rk-shared-text" {...sharedSourceAttributes('task',t.id,'todo:'+t.id)}>{t.title}</span></Link><span className="muted tiny">P{t.priority}</span></div>):<Empty title="暂无待办" description="在任务列表中创建后会显示在这里。"/>}</section>
  <section className="home-card"><div className="panel-heading"><h2>最近活动</h2><Link to="/activity">查看全部</Link></div>
   {events.isPending?<LoadingRows kind="activity" count={5}/>:events.isError?<ErrorText error={events.error}/>:events.data?.items?.length?events.data.items.slice(0,5).map(e=><ActivityEntry key={e.seq} item={e} compact/>):<Empty title="暂无活动"/>}</section>
 </div></div>;
}
