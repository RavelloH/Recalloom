import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {WorkspacePanel} from './workspace-panels';
import {api} from './api';
import {AutoTransition,AutoResizer} from './motion-primitives';
import {ErrorText,Loading,Empty,fmt} from './pages/shared';
import {stateLabels,stageLabels,type IndexTask,type Run} from './index-status-data';

export function IndexTaskPanel({task:initialTask,open,activation,onOpenChange,onAfterClose,onRetry,busy}:{task:IndexTask;open:boolean;activation:number;onOpenChange:(v:boolean)=>void;onAfterClose:()=>void;onRetry:(task:IndexTask)=>void;busy:boolean}){
 const history=useQuery({queryKey:['index-runs',initialTask.record_id],queryFn:()=>api<{task:IndexTask;runs:Run[]}>('/index/tasks/'+initialTask.record_id),enabled:open,refetchInterval:open?5000:false});
 const task=history.data?.task??initialTask;
 return <WorkspacePanel id={'index-'+task.record_id} label={'索引详情：'+task.name} title="索引详情" description={task.name} reserveSpace={false} open={open} activationKey={activation} onOpenChange={onOpenChange} onAfterClose={onAfterClose}>
  <div className="index-task-detail"><div className="index-toolbar"><Link to="/records/$recordId" params={{recordId:task.record_id}}>打开文稿</Link><Button size="sm" variant="secondary" label={task.state==='done'?'重新索引':'重试任务'} isDisabled={task.state==='running'} isLoading={busy} onClick={()=>onRetry(task)}/></div>
   <AutoResizer><AutoTransition transitionKey={task.state+task.stage+task.completed_chunks}><div><Badge label={stateLabels[task.state]}/><p>{stageLabels[task.stage]??task.stage}{task.total_chunks>0?' · '+task.completed_chunks+'/'+task.total_chunks+' 块':''}</p></div></AutoTransition></AutoResizer>
   {task.state==='running'&&task.total_chunks>0&&<ProgressBar label="文本块处理进度" value={task.completed_chunks} max={task.total_chunks} hasValueLabel formatValueLabel={(value,max)=>value+'/'+max+' 块'}/>}
   <dl className="index-properties"><dt>已索引版本</dt><dd>{task.indexed_revision?'R'+task.indexed_revision:'尚未完成'}</dd><dt>目标 / 正文版本</dt><dd>R{task.revision} / R{task.current_revision}</dd><dt>尝试次数</dt><dd>{task.attempts} / 5</dd><dt>开始时间</dt><dd>{fmt(task.started_at??undefined)}</dd><dt>完成时间</dt><dd>{fmt(task.finished_at??undefined)}</dd><dt>下次重试</dt><dd>{fmt(task.next_retry_at??undefined)}</dd><dt>租约到期</dt><dd>{fmt(task.lease_expires_at??undefined)}</dd></dl>
   {task.last_error&&<ErrorText error={new Error(task.last_error)}/>}
   <p className="muted small">“已提交索引”表示当前版本已提交至向量服务，不代表已经验证语义查询可见。</p>
   <h3>最近执行记录</h3><AutoResizer><AutoTransition transitionKey={history.isPending?'loading':history.isError?'error':history.data?.runs.map(r=>r.id).join(',')??'empty'}>{history.isPending?<Loading/>:history.isError?<ErrorText error={history.error}/>:!history.data?.runs.length?<Empty title="暂无执行记录"/>:history.data.runs.map(run=><div className="index-run" key={run.id}><strong>R{run.revision} · {run.outcome==='done'?'已提交':run.outcome==='superseded'?'已被新版本取代':'失败'}</strong><p className="muted small">{fmt(run.created_at)} · {(run.duration_ms/1000).toFixed(1)} 秒 · {run.chunks} 块</p>{run.error&&<p className="index-error">{run.error}</p>}</div>)}</AutoTransition></AutoResizer>
  </div>
 </WorkspacePanel>;
}
