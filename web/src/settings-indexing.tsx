import './styles/features/index-workspace.css';
import {useEffect,useRef,useState} from 'react';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Badge} from '@astryxdesign/core/Badge';
import {api,queryString} from './api';
import {useConfirmDialog} from './confirm-dialog';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {ErrorText,Empty,Loading,fmt} from './pages/shared';
import {IndexChart} from './index-status-chart';
import {IndexTaskPanel} from './index-task-panel';
import {WikiIndexPanel} from './wiki-index-panel';
import {stateLabels,stageLabels,type IndexTask,type IndexState,type IndexSummary} from './index-status-data';

export function SettingsIndexing(){
 const [days,setDays]=useState('7'),[state,setState]=useState('all'),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[diagnostics,setDiagnostics]=useState(false);
 const [error,setError]=useState<unknown>(null),[busy,setBusy]=useState<string|null>(null),[panels,setPanels]=useState<Array<{task:IndexTask;open:boolean;activation:number}>>([]),sequence=useRef(0);
 const more=useRef<HTMLDivElement>(null),qc=useQueryClient(),{confirm,confirmation}=useConfirmDialog();
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query),250);return()=>clearTimeout(timer);},[query]);
 const summary=useQuery({queryKey:['index-summary',days],queryFn:()=>api<IndexSummary>('/index?days='+days),refetchInterval:5000});
 const tasks=useInfiniteQuery({queryKey:['index-tasks',state,search],initialPageParam:0,queryFn:({pageParam})=>api<{items:IndexTask[];nextOffset:number|null}>('/index/tasks?'+queryString({state:state==='all'?undefined:state,query:search,offset:pageParam})),getNextPageParam:last=>last.nextOffset??undefined,refetchInterval:5000});
 useEffect(()=>{const el=more.current;if(!el||!tasks.hasNextPage||tasks.isFetching)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void tasks.fetchNextPage();},{rootMargin:'180px'});observer.observe(el);return()=>observer.disconnect();},[tasks.hasNextPage,tasks.isFetching,tasks.fetchNextPage]);
 const retry=async(task:IndexTask)=>{if(busy)return;if(task.state==='done'&&!await confirm({title:'重新索引这篇文稿？',description:'将重新分块并生成当前正文的向量，期间原有索引仍可使用。',actionLabel:'重新索引'}))return;setBusy(task.record_id);setError(null);try{await api('/index/tasks/'+task.record_id+'/retry',{method:'POST',body:JSON.stringify({rebuild:task.state==='done'})});await Promise.all([qc.invalidateQueries({queryKey:['index-tasks']}),qc.invalidateQueries({queryKey:['index-summary']}),qc.invalidateQueries({queryKey:['index-runs',task.record_id]})]);}catch(e){setError(e);}finally{setBusy(null);}};
 const rebuild=async()=>{if(busy)return;setBusy('all');setError(null);try{const preview=await api<{count:number;token:string}>('/index/rebuild/preview');if(!preview.count)return;if(!await confirm({title:'重新索引全部有效文稿？',description:'将对 '+preview.count+' 篇未归档文稿重新分块并生成向量，可能消耗较长时间和模型用量。现有索引会保留到替换成功。',actionLabel:'排队重建'}))return;await api('/index/rebuild',{method:'POST',body:JSON.stringify({token:preview.token})});await qc.invalidateQueries({queryKey:['index-tasks']});await summary.refetch();}catch(e){setError(e);}finally{setBusy(null);}};
 const items=tasks.data?.pages.flatMap(p=>p.items)??[],data=summary.data,count=(s:IndexState)=>data?.counts.find(v=>v.state===s)?.count??0;
 const open=(task:IndexTask)=>{const activation=++sequence.current;setPanels(current=>[...current.filter(p=>p.task.record_id!==task.record_id),{task,open:true,activation}]);};
 return <div className="index-workspace">{confirmation}{error!=null&&<ErrorText error={error}/>}
  <div className="index-toolbar"><div><h2>索引运行情况</h2><p className="muted small">写入后自动后台处理 · 每 15 分钟兜底恢复 · 最近提交 {fmt(data?.last.completedAt??undefined)}</p></div><Button label="刷新" size="sm" variant="secondary" onClick={()=>{void summary.refetch();void tasks.refetch();}}/></div>
  {summary.isError&&<ErrorText error={summary.error}/>}<AutoResizer><AutoTransition transitionKey={data?'ready':'loading'}>{!data?<Loading/>:<div className="index-metrics">{[
   {label:'当前版本已索引',value:(data.coverage.indexed??0)+' / '+data.coverage.total,filter:'done'},
   {label:'等待处理 / 重试',value:count('pending')+count('retry'),filter:'waiting'},
   {label:'正在处理',value:count('running'),filter:'running'},
   {label:'处理失败',value:count('failed'),filter:'failed'}
  ].map(metric=><Button className="index-metric" variant="secondary" key={metric.label} label={metric.label} children={<><span>{metric.label}</span><AutoTransition as="span" transitionKey={String(metric.value)}><strong>{metric.value}</strong></AutoTransition></>} onClick={()=>setState(metric.filter)}/>)}</div>}</AutoTransition></AutoResizer>
  <div className="index-toolbar"><p className="muted small">归档文稿不计入覆盖率。最近 {data?.performance.samples??0} 次成功执行：平均 {data?.performance.meanMs!=null?(data.performance.meanMs/1000).toFixed(1)+' 秒':'—'} · P95 {data?.performance.p95Ms!=null?(data.performance.p95Ms/1000).toFixed(1)+' 秒':'—'}。最早等待 {fmt(data?.last.waitingSince??undefined)}</p><Selector label="统计范围" size="sm" value={days} onChange={setDays} options={[{value:'1',label:'24 小时'},{value:'7',label:'7 天'},{value:'30',label:'30 天'}]}/></div>
  <AutoResizer><AutoTransition transitionKey={days}><div className="index-charts"><IndexChart title="处理情况" description="成功与失败的执行次数，包含重试" data={data?.runs??[]} kind="bar" fields={[{key:'completed',label:'已提交'},{key:'failed',label:'失败'}]}/><IndexChart title="积压变化" description="按小时采样的待处理量；未采样的时段不补零" data={data?.samples??[]} fields={[{key:'pending',label:'等待 / 重试'},{key:'running',label:'处理中'}]}/></div></AutoTransition></AutoResizer>
  <Card padding={4}><div className="index-toolbar"><h3>文稿索引任务</h3><div className="index-filters"><TextInput label="搜索文稿" isLabelHidden placeholder="搜索文稿…" value={query} onChange={setQuery} size="sm"/><Selector label="任务状态" size="sm" value={state} onChange={setState} options={[{value:'all',label:'全部状态'},{value:'waiting',label:'等待处理 / 重试'},...Object.entries(stateLabels).map(([value,label])=>({value,label}))]}/></div></div>
   <AutoResizer><AutoTransition transitionKey={state+search+(tasks.isPending?'loading':'ready')+items.map(t=>t.record_id).join('|')}>{tasks.isPending?<Loading/>:tasks.isError?<ErrorText error={tasks.error}/>:!items.length?<Empty title="没有符合条件的任务"/>:<div className="index-task-list">{items.map(task=><Button variant="ghost" className="index-task-row" key={task.record_id} label={task.name} children={<AutoTransition as="span" className="index-task-content" transitionKey={task.name+task.state+task.stage+task.completed_chunks+task.revision}><span className="index-task-name"><strong>{task.name}</strong><span className="muted small">{task.indexed_revision?'R'+task.indexed_revision:'未索引'} → R{task.revision}{task.record_status==='archived'?' · 已归档':''}</span></span><span><Badge variant={task.state==='failed'?'error':task.state==='running'?'info':'neutral'} label={stateLabels[task.state]}/><span className="muted small">{task.state==='running'?(stageLabels[task.stage]??task.stage)+(task.total_chunks?' · '+task.completed_chunks+'/'+task.total_chunks+' 块':''):task.state==='retry'?'重试于 '+fmt(task.next_retry_at??undefined):fmt(task.finished_at??task.updated_at??task.created_at)}</span></span></AutoTransition>} onClick={()=>open(task)}/>)}</div>}</AutoTransition></AutoResizer>
   <div ref={more}>{tasks.hasNextPage&&<Button variant="ghost" label="加载更多" isLoading={tasks.isFetchingNextPage} onClick={()=>void tasks.fetchNextPage()}/>}</div>
  </Card>
  <Collapsible trigger="诊断与维护" isOpen={diagnostics} onOpenChange={setDiagnostics}><Card padding={4}><p>模型 {data?.model??'—'} · {data?.dimensions??'—'} 维</p><p className="muted small">待清理文稿 {data?.cleanup.records??'—'} · 待清理向量批次 {data?.cleanup.batches??'—'}</p><p className="muted small">每项任务最多尝试 5 次，自动退避重试；执行记录保留 30 天，容量采样保留 90 天。已提交索引不等于已验证语义查询可见。</p><Button size="sm" variant="secondary" label="重新索引全部有效文稿" isLoading={busy==='all'} onClick={()=>void rebuild()}/><p><a href="/settings/storage">查看存储容量</a></p></Card><WikiIndexPanel/></Collapsible>
  {panels.map(panel=><IndexTaskPanel key={panel.task.record_id} task={items.find(t=>t.record_id===panel.task.record_id)??panel.task} open={panel.open} activation={panel.activation} onOpenChange={open=>setPanels(p=>p.map(v=>v.task.record_id===panel.task.record_id?{...v,open}:v))} onAfterClose={()=>setPanels(p=>p.filter(v=>v.task.record_id!==panel.task.record_id||v.open))} onRetry={task=>void retry(task)} busy={busy===panel.task.record_id}/>)}
 </div>;
}
