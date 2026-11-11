import {useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {TextInput} from '@astryxdesign/core/TextInput';
import {api,mutate} from '../api';
import type {Task} from '../types';
import {AutoResizer} from '../motion-primitives';
import {tasksQuery} from '../queries';
import {PageTitle,ErrorText,LoadingRows,Empty,Swap,stateOf} from './shared';

const taskFilters=[{value:"open",label:"未完成"},{value:"all",label:"全部"},{value:"todo",label:"待开始"},{value:"in_progress",label:"进行中"},{value:"blocked",label:"阻塞"},{value:"done",label:"已完成"}];

export function TasksPage({recordId}:{recordId?:string}){const qc=useQueryClient();const q=useQuery(tasksQuery(recordId));const [filter,setFilter]=useState('open'),[newTitle,setNewTitle]=useState(''),[error,setError]=useState<unknown>(null),[pending,setPending]=useState(false);
 const change=async(task:Task,changes:Record<string,unknown>,action:'update'|'remove'='update')=>{try{setError(null);const current=await api<{revision:number}>('/records/'+task.recordId+'?metadataOnly=true');await mutate('/tasks/mutate',{recordId:task.recordId,action,taskId:task.id,expectedRevision:current.revision,changes});qc.invalidateQueries({queryKey:['tasks']});qc.invalidateQueries({queryKey:['record',task.recordId]});}catch(e){setError(e);}};
 const create=async()=>{if(!recordId||!newTitle.trim())return;setPending(true);try{const current=await api<{revision:number}>('/records/'+recordId+'?metadataOnly=true');await mutate('/tasks/mutate',{action:'add',recordId,expectedRevision:current.revision,changes:{title:newTitle.trim(),status:'todo',priority:0}});setNewTitle('');qc.invalidateQueries({queryKey:['tasks']});qc.invalidateQueries({queryKey:['record',recordId]});}catch(e){setError(e);}finally{setPending(false);}};
 const items=(q.data?.items??[]).filter(t=>filter==='all'||(filter==='open'?!['done','cancelled'].includes(t.status):t.status===filter)).sort((a,b)=>b.priority-a.priority);
 return <div className={recordId?'embedded-tasks':'page'}>{!recordId&&<PageTitle title="任务" description="所有任务列表的待办与进度"/>}<AutoResizer>{Boolean(error)&&<ErrorText error={error}/>}</AutoResizer><div className="toolbar"><Selector label="筛选" isLabelHidden size="md" value={filter} options={taskFilters} onChange={setFilter}/><span className="muted small">{q.isPending?'—':items.length} 项</span></div>{recordId&&<div className="inline-form row gap"><div className="inline-field"><TextInput label="新任务标题" isLabelHidden width="100%" placeholder="添加任务…" value={newTitle} onChange={setNewTitle} onEnter={create}/></div><Button label="添加" variant="primary" size="sm" isLoading={pending} isDisabled={!newTitle.trim()||pending} onClick={create}/></div>}
 <Swap state={stateOf(q,!items.length)+':'+filter}>{q.isPending?<Card className="task-list" padding={0}><LoadingRows kind="tasks" count={3}/></Card>:q.isError?<ErrorText error={q.error}/>:items.length?<Card className="task-list" padding={0}>{items.map(t=><div className="task-item" key={t.id}><div className="task-heading"><div className="task-check"><CheckboxInput label={'完成 '+t.title} isLabelHidden size="sm" value={t.status==='done'} onChange={checked=>change(t,{status:checked?'done':'todo'})}/></div><div className={'task-title'+(t.status==='done'?' task-done':'')}>{t.title}</div><span className="priority">P{t.priority}</span></div>{t.details&&<p className="task-details muted">{t.details}</p>}<div className="task-footer">{!recordId?<Link className="small" to="/records/$recordId" params={{recordId:t.recordId}}>查看任务列表</Link>:<span/>}<div className="task-status"><Selector label={'任务状态 '+t.title} isLabelHidden size="md" width="100%" value={t.status} options={[{value:"todo",label:"待开始"},{value:"in_progress",label:"进行中"},{value:"blocked",label:"阻塞"},{value:"done",label:"已完成"},{value:"cancelled",label:"取消"}]} onChange={status=>change(t,{status})}/></div></div></div>)}</Card>:<Empty title="没有匹配的任务" description={recordId?'可以在上方添加任务。':'打开任务列表记录后可创建和修改任务。'}/>}</Swap></div>;
}
