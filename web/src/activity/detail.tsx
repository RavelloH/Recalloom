import {lazy,Suspense,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {Spinner} from '@astryxdesign/core/Spinner';
import {WorkspacePanel} from '../workspace-panels';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {ErrorText} from '../pages/shared';
import {Icon} from '../icon';
import {activityDetailQuery,eventDescription,type ActivityEvent} from './data';
import type {RevisionComparison} from '../revision-diff-drawer';

const RevisionDiffDrawer=lazy(()=>import('../revision-diff-drawer').then(module=>({default:module.RevisionDiffDrawer})));
export type ActivitySession={event:ActivityEvent;open:boolean;activation:number};
const statuses:Record<string,string>={todo:'待开始',in_progress:'进行中',blocked:'阻塞',done:'已完成',cancelled:'取消'};
const fields:Record<string,string>={title:'标题',details:'详情',status:'状态',priority:'历史优先级'};
export function ActivityDetail({session,onClose,onRemove}:{session:ActivitySession;onClose:()=>void;onRemove:()=>void}){
 const query=useQuery({...activityDetailQuery(session.event.seq),enabled:session.open}),item=query.data?.item??session.event;
 const [comparison,setComparison]=useState<RevisionComparison|null>(null);
 const tasks=item.details?.taskActivity,canCompare=item.resourceExists&&item.entityType==='record'&&item.recordKind==='document'&&item.operation==='update'&&Number(item.revision)>1;
 return <WorkspacePanel id={'activity-detail-'+item.seq} label="活动详情" title="活动详情" description={item.resourceName} reserveSpace={false} open={session.open} activationKey={session.activation} onOpenChange={open=>{if(!open)onClose();}} onAfterClose={onRemove}>
  <div className="activity-detail-content">
   <div className="activity-detail-intro"><span className={'activity-kind-dot activity-series-'+(item.actorKind??'unknown')}/><strong>{item.actorName}</strong><span className="muted">{eventDescription(item)}</span></div>
   <dl className="activity-detail-properties"><dt>操作时间</dt><dd>{new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'medium'}).format(new Date(item.createdAt))}</dd>
    <dt>操作来源</dt><dd>{item.clientName||(item.actorKind==='user'?'Web':item.actorKind==='system'?'系统':'历史记录')}</dd>
    <dt>所属位置</dt><dd><AutoTransition transitionKey={query.isPending?'pending':query.isError?'error':'ready'}>{query.isPending?<Spinner size="sm" label="正在读取位置…"/>:query.isError?<span className="muted">暂时无法读取</span>:query.data?.path??(item.resourceExists?'文件夹':'资源已移除')}</AutoTransition></dd>
    {item.revision!=null&&<><dt>内容版本</dt><dd>R{item.revision}</dd></>}
   </dl>
   {item.resourceExists&&item.entityId&&<div className="activity-detail-actions">{item.entityType==='tag'?<Link to="/tags/$tagId" params={{tagId:item.entityId}}>打开标签 <Icon name="arrowUpRight" size="sm"/></Link>:item.entityType==='folder'?<Link to="/library/$folderId" params={{folderId:item.entityId}}>打开文件夹 <Icon name="arrowUpRight" size="sm"/></Link>:<Link to="/records/$recordId" params={{recordId:item.entityId}}>打开{item.recordKind==='task_list'?'任务列表':'文档'} <Icon name="arrowUpRight" size="sm"/></Link>}
    {canCompare&&<Button label="比较修改" variant="secondary" size="sm" icon={<Icon name="arrowsDiff" size="sm"/>} onClick={()=>setComparison({recordId:item.entityId!,name:item.resourceName??'',from:Number(item.revision)-1,to:Number(item.revision)})}/>}</div>}
   <AutoResizer><AutoTransition transitionKey={query.isError?'error':'ready'}>{query.isError?<div className="activity-detail-error"><ErrorText error={query.error}/><Button label="重新加载详情" variant="ghost" size="sm" onClick={()=>void query.refetch()}/></div>:null}</AutoTransition></AutoResizer>
   {tasks&&<section className="activity-task-changes"><h3>任务变化</h3>{tasks.changes.length?tasks.changes.map((change,index)=><div className="activity-task-change" key={change.id+':'+index}>
    <strong>{change.title}</strong><div className="muted">{change.action==='created'?'新增任务':change.action==='removed'?'移除任务':change.action==='transferred'?'迁移任务':change.from!==change.to?(statuses[change.from??'']??change.from)+' → '+(statuses[change.to??'']??change.to):'修改'+(change.fields??[]).map(field=>fields[field]??field).join('、')}</div>
   </div>):<p className="muted">没有任务字段变化。</p>}{tasks.totalChanges>tasks.changes.length&&<p className="muted tiny">另有 {tasks.totalChanges-tasks.changes.length} 项变化，可在任务列表历史版本中查看。</p>}</section>}
   {!tasks&&item.category==='task'&&item.operation==='update'&&<p className="muted activity-detail-note">{eventDescription(item)==='调整任务顺序'?'这次操作只调整排列顺序，未生成新的内容版本。':'这是一条历史任务记录，未记录逐项任务变化。'}</p>}
   {item.details?.tag!=null&&<div className="activity-detail-note">标签：{String(item.details.tag)}</div>}
  </div>
  {comparison&&<Suspense fallback={null}><RevisionDiffDrawer comparison={comparison} isOpen onOpenChange={open=>{if(!open)setComparison(null);}}/></Suspense>}
 </WorkspacePanel>;
}
