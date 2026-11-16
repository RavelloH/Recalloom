import './styles/features/index-workspace.css';
import {useEffect,useRef,useState} from 'react';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Badge} from '@astryxdesign/core/Badge';
import {Table,TableHeader,TableBody,TableRow,TableHeaderCell,TableCell} from '@astryxdesign/core/Table';
import {api,queryString} from './api';
import {useConfirmDialog} from './confirm-dialog';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {ErrorText,Empty,Loading,fmt} from './pages/shared';
import {IndexChart} from './index-status-chart';
import {IndexTaskPanel} from './index-task-panel';
import {SettingsPropertyTable} from './settings-property-table';
import {stateLabels,stageLabels,type IndexTask,type IndexState,type IndexSummary} from './index-status-data';

export function SettingsIndexing(){
 const [state,setState]=useState('all'),[query,setQuery]=useState(''),[search,setSearch]=useState('');
 const [error,setError]=useState<unknown>(null),[busy,setBusy]=useState<string|null>(null),[panels,setPanels]=useState<Array<{task:IndexTask;open:boolean;activation:number}>>([]),sequence=useRef(0);
 const more=useRef<HTMLDivElement>(null),qc=useQueryClient(),{confirm,confirmation}=useConfirmDialog();
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query),250);return()=>clearTimeout(timer);},[query]);
 const summary=useQuery({queryKey:['index-summary'],queryFn:()=>api<IndexSummary>('/index'),staleTime:15_000,refetchInterval:query=>query.state.data?.counts.some(c=>(c.state==='pending'||c.state==='running')&&c.count>0)?5000:60_000});
 const tasks=useInfiniteQuery({queryKey:['index-tasks',state,search],initialPageParam:0,queryFn:({pageParam})=>api<{items:IndexTask[];nextOffset:number|null}>('/index/tasks?'+queryString({state:state==='all'?undefined:state,query:search,offset:pageParam})),getNextPageParam:last=>last.nextOffset??undefined,staleTime:15_000,refetchInterval:query=>query.state.data?.pages.some(p=>p.items.some(t=>t.state==='pending'||t.state==='running'))?5000:60_000});
 useEffect(()=>{const el=more.current;if(!el||!tasks.hasNextPage||tasks.isFetching)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void tasks.fetchNextPage();},{rootMargin:'180px'});observer.observe(el);return()=>observer.disconnect();},[tasks.hasNextPage,tasks.isFetching,tasks.fetchNextPage]);
 const retry=async(task:IndexTask)=>{if(busy)return;if(task.state==='done'&&!await confirm({title:'重新索引这篇文稿？',description:'将重新分块并生成当前正文的向量，期间原有索引仍可使用。',actionLabel:'重新索引'}))return;setBusy(task.record_id);setError(null);try{await api('/index/tasks/'+task.record_id+'/retry',{method:'POST',body:JSON.stringify({rebuild:task.state==='done'})});await Promise.all([qc.invalidateQueries({queryKey:['index-tasks']}),qc.invalidateQueries({queryKey:['index-summary']}),qc.invalidateQueries({queryKey:['index-runs',task.record_id]})]);}catch(e){setError(e);}finally{setBusy(null);}};
 const rebuild=async()=>{if(busy)return;setBusy('all');setError(null);try{const preview=await api<{count:number;token:string}>('/index/rebuild/preview');if(!preview.count)return;if(!await confirm({title:'重新索引全部有效文稿？',description:'将对 '+preview.count+' 篇未归档文稿重新分块并生成向量，可能消耗较长时间和模型用量。现有索引会保留到替换成功。',actionLabel:'排队重建'}))return;await api('/index/rebuild',{method:'POST',body:JSON.stringify({token:preview.token})});await qc.invalidateQueries({queryKey:['index-tasks']});await summary.refetch();}catch(e){setError(e);}finally{setBusy(null);}};
 const items=tasks.data?.pages.flatMap(p=>p.items)??[],data=summary.data,count=(s:IndexState)=>data?.counts.find(v=>v.state===s)?.count??0;
 const open=(task:IndexTask)=>{const activation=++sequence.current;setPanels(current=>[...current.filter(p=>p.task.record_id!==task.record_id),{task,open:true,activation}]);};
 return <div className="index-workspace">{confirmation}{error!=null&&<ErrorText error={error}/>}
  <div className="index-toolbar"><div><h2>索引运行情况</h2><p className="muted small">写入后自动后台处理 · 每 15 分钟兜底恢复 · 最近提交 {fmt(data?.last.completedAt??undefined)}</p></div><Button label="刷新" size="sm" variant="secondary" onClick={()=>{void summary.refetch();void tasks.refetch();}}/></div>
  {summary.isError&&<ErrorText error={summary.error}/>}<AutoResizer><AutoTransition transitionKey={data?'ready':'loading'}>{!data?<Loading/>:<div className="index-metrics">{[
   {label:'当前版本已索引',value:(data.coverage.indexed??0)+' / '+data.coverage.total,filter:'done',hint:'未归档文稿的当前版本'},
   {label:'等待处理 / 重试',value:count('pending')+count('retry'),filter:'waiting',hint:'等待执行或自动重试'},
   {label:'正在处理',value:count('running'),filter:'running',hint:'正在生成或提交索引'},
   {label:'处理失败',value:count('failed'),filter:'failed',hint:'已停止自动重试'}
  ].map(metric=><Card padding={4} className="index-metric-card" key={metric.label}><span className="muted small">{metric.label}</span><AutoTransition transitionKey={String(metric.value)}><strong className="storage-value">{metric.value}</strong></AutoTransition><p className="muted small">{metric.hint}</p><Button className="index-metric-action" variant="ghost" label={'筛选：'+metric.label} children={<span aria-hidden="true"/>} onClick={()=>setState(metric.filter)}/></Card>)}</div>}</AutoTransition></AutoResizer>
  <Card padding={4} className="index-config-card">
   <div className="index-model-title"><h3>索引配置</h3><AutoTransition transitionKey={data?.model??'loading'}><Badge label={data?.model.split('/').at(-1)?.toUpperCase()??'读取中…'}/></AutoTransition></div>
   <SettingsPropertyTable label="索引配置参数" rows={[
    {label:'嵌入模型',value:<code>{data?.model??'—'}</code>,transitionKey:data?.model??'loading'},
    {label:'向量维度',value:data?data.dimensions+' 维':'—',transitionKey:String(data?.dimensions)},
    {label:'重试策略',value:'最多尝试 5 次，自动退避重试',transitionKey:'retry'},
    {label:'待清理文稿',value:data?.cleanup.records??'—',transitionKey:String(data?.cleanup.records)},
    {label:'待清理向量批次',value:data?.cleanup.batches??'—',transitionKey:String(data?.cleanup.batches)}
   ]}/>
   <div className="index-config-actions"><Button href="/settings/storage" size="sm" variant="ghost" label="查看存储"/><Button size="sm" variant="secondary" label="重新索引全部有效文稿" isLoading={busy==='all'} onClick={()=>void rebuild()}/></div>
  </Card>
  <p className="muted small">归档文稿不计入覆盖率。最早等待 {fmt(data?.last.waitingSince??undefined)} · 统计基于当前任务，查看页面时计算。</p>
  {data&&<IndexChart title="待处理任务" emptyTitle="无待处理任务" description="距最近入队的时间，含等待重试；不是累计排队耗时" data={count('pending')+count('retry')>0?data.ageBuckets:[]} kind="bar" fields={[{key:'pending',label:'等待处理'},{key:'retry',label:'等待重试'}]}/>}
  <Card padding={4}><div className="index-toolbar"><h3>文稿索引任务</h3><div className="index-filters"><TextInput label="搜索文稿" isLabelHidden placeholder="搜索文稿…" value={query} onChange={setQuery} size="sm"/><Selector label="任务状态" isLabelHidden size="sm" value={state} onChange={setState} options={[{value:'all',label:'全部状态'},{value:'waiting',label:'等待处理 / 重试'},...Object.entries(stateLabels).map(([value,label])=>({value,label}))]}/></div></div>
   <AutoResizer><AutoTransition transitionKey={state+search+(tasks.isPending?'loading':'ready')+items.map(t=>t.record_id).join('|')}>{tasks.isPending?<Loading/>:tasks.isError?<ErrorText error={tasks.error}/>:!items.length?<Empty title="没有符合条件的任务"/>:<Table aria-label="文稿索引任务" className="index-task-list" dividers="rows" density="balanced" verticalAlign="top" textOverflow="wrap" hasHover>
    <TableHeader><TableRow isHeaderRow><TableHeaderCell scope="col">文稿</TableHeaderCell><TableHeaderCell scope="col">状态</TableHeaderCell><TableHeaderCell scope="col">处理时间</TableHeaderCell></TableRow></TableHeader>
    <TableBody>{items.map(task=><TableRow key={task.record_id} onClick={()=>open(task)}>
     <TableCell><AutoResizer><AutoTransition transitionKey={task.name+task.revision+task.indexed_revision+task.record_status}>
      <div className="index-task-name"><Button variant="ghost" className="index-task-title" label={task.name}/><span className="muted small">{task.indexed_revision?'R'+task.indexed_revision:'未索引'} → R{task.revision}{task.record_status==='archived'?' · 已归档':''}</span></div>
     </AutoTransition></AutoResizer></TableCell>
     <TableCell><AutoResizer><AutoTransition transitionKey={task.state+task.stage+task.completed_chunks+task.total_chunks}>
      <div className="index-task-status"><Badge variant={task.state==='failed'?'error':task.state==='running'?'info':'neutral'} label={stateLabels[task.state]}/>{task.state==='running'&&<span className="muted small">{stageLabels[task.stage]??task.stage}{task.total_chunks?' · '+task.completed_chunks+'/'+task.total_chunks+' 块':''}</span>}</div>
     </AutoTransition></AutoResizer></TableCell>
     <TableCell><AutoTransition transitionKey={task.state+task.next_retry_at+task.finished_at+task.updated_at}><span className="muted small">{task.state==='retry'?'重试于 ':''}{fmt((task.state==='retry'?task.next_retry_at:task.finished_at??task.updated_at??task.created_at)??undefined)}</span></AutoTransition></TableCell>
    </TableRow>)}</TableBody>
   </Table>}</AutoTransition></AutoResizer>
   <div ref={more}>{tasks.hasNextPage&&<Button variant="ghost" label="加载更多" isLoading={tasks.isFetchingNextPage} onClick={()=>void tasks.fetchNextPage()}/>}</div>
  </Card>

  {panels.map(panel=><IndexTaskPanel key={panel.task.record_id} task={items.find(t=>t.record_id===panel.task.record_id)??panel.task} open={panel.open} activation={panel.activation} onOpenChange={open=>setPanels(p=>p.map(v=>v.task.record_id===panel.task.record_id?{...v,open}:v))} onAfterClose={()=>setPanels(p=>p.filter(v=>v.task.record_id!==panel.task.record_id||v.open))} onRetry={task=>void retry(task)} busy={busy===panel.task.record_id}/>)}
 </div>;
}
