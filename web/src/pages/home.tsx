import {Icon} from '../icon';
import {Link} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {ActivityEntry} from '../activity-entry';
import {useRecentPages} from '../recent-pages';
import {sharedViewTransitionName} from '../shared-view-transition';
import {activityQuery,tasksQuery} from '../queries';
import {PageTitle,ErrorText,LoadingRows,Empty,ago,greeting} from './shared';

export function HomePage(){const {data:todo,isPending,isError,error:todoError}=useQuery(tasksQuery());const events=useQuery(activityQuery());const recent=useRecentPages();const active=todo?.items.filter(t=>!['done','cancelled'].includes(t.status))??[];
 const shortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ K':'Ctrl K';
 return <div className="page home-page"><PageTitle title="概览" description={greeting()+'。从最近的页面继续，或查看待办与近期变化。'}/>
 <section className="home-section" aria-labelledby="home-recent"><h2 id="home-recent" className="section-heading"><Icon name="clock" size="sm"/>最近访问</h2>
  {recent.length?<div className="recent-pages">{recent.slice(0,8).map(page=><Link key={page.id} to="/records/$recordId" params={{recordId:page.id}} className="recent-page"><span className="recent-page-cover" aria-hidden="true"/><span className="recent-page-icon" aria-hidden="true">{page.kind==='task_list'?<Icon name="taskList" size="md"/>:<Icon name="document" size="md"/>}</span><strong className="recent-page-name" style={{viewTransitionName:recent.findIndex(other=>other.id===page.id)===recent.indexOf(page)?sharedViewTransitionName('record',page.id):undefined}}>{page.name}</strong><small className="recent-page-meta truncate">{ago(page.visitedAt)}</small></Link>)}</div>
  :<div className="recent-empty"><p className="muted small">最近打开的页面会显示在这里。按 <kbd>{shortcut}</kbd> 可随时搜索。</p><Link to="/library" className="small text-link">浏览知识库</Link></div>}
 </section>
 <div className="dashboard-grid">
  <section className="home-card"><div className="panel-heading"><h2>未完成事项</h2><Link to="/tasks">查看全部</Link></div>
   {isPending?<LoadingRows kind="compact" count={5}/>:isError?<ErrorText error={todoError}/>:active.length?active.slice(0,5).map(t=><div className="compact-row" key={t.id}><span className={'status-dot '+t.status}/><Link to="/records/$recordId" params={{recordId:t.recordId}}>{t.title}</Link><span className="muted tiny">P{t.priority}</span></div>):<Empty title="暂无待办" description="在任务列表中创建后会显示在这里。"/>}</section>
  <section className="home-card"><div className="panel-heading"><h2>最近活动</h2><Link to="/activity">查看全部</Link></div>
   {events.isPending?<LoadingRows kind="activity" count={5}/>:events.isError?<ErrorText error={events.error}/>:events.data?.items?.length?events.data.items.slice(0,5).map(e=><ActivityEntry key={e.seq} item={e} compact/>):<Empty title="暂无活动"/>}</section>
 </div></div>;
}
