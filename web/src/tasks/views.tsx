import {useMemo,useState,type CSSProperties} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {Spinner} from '@astryxdesign/core/Spinner';
import {OverlayScroll} from '../scrollbars';
import {Icon} from '../icon';
import {ErrorText} from '../pages/shared';
import {taskPages,statusLabels,type TaskCounts,type TaskItem,type TaskList,type TaskScope,type TaskStatus} from './data';
import {TaskEntry,TaskStatusIcon,type TaskItemProps} from './items';
import {TaskLoadMore,useTaskIntersection,useTaskViewHeight} from './scroll';
import {TaskDragProvider} from './drag';
import {AutoResizer,AutoTransition} from '../motion-primitives';

export type TaskInteractions=Pick<TaskItemProps,'onEdit'|'onStatus'|'onDrag'|'onDrop'|'canDrop'>&{
 pending:string[];onCreate:(list?:TaskList,status?:TaskStatus)=>void;onColumnDrop:(status:TaskStatus)=>Promise<void>;canColumnDrop:()=>boolean;
};
type BoardProps={scope:TaskScope;statuses:TaskStatus[];counts:TaskCounts;lists:TaskList[];interactions:TaskInteractions};
function BoardColumn({scope,status,count,list,interactions}:{scope:TaskScope;status:TaskStatus;count:number;list?:TaskList;interactions:TaskInteractions}){
 const q=useInfiniteQuery(taskPages(scope,[status])),[root,setRoot]=useState<HTMLDivElement|null>(null);
 const tasks=useMemo(()=>q.data?.pages.flatMap(page=>page.items)??[],[q.data]);
 const state=q.isPending?'loading':q.isError&&!tasks.length?'error':!tasks.length?'empty':'ready';
 const stateKey=state==='error'?'error:'+String(q.error):state;
 const stateClass=state==='ready'?'tasks-inline-state':'tasks-'+state;
 return <section className="tasks-column" data-task-column={status} aria-label={statusLabels[status]}>
  <header className="tasks-column-header"><div className="tasks-column-label"><TaskStatusIcon status={status}/><h2>{statusLabels[status]}</h2><span className="tasks-column-count">
   <AutoTransition as="span" mode="sync" className="tasks-column-count-transition" transitionKey={count} duration={.14}>{count}</AutoTransition>
  </span></div>
   <IconButton data-task-create label={'新建'+statusLabels[status]+'任务'} icon={<Icon name="plus" size="sm"/>} variant="ghost" size="sm" onClick={()=>interactions.onCreate(list,status)}/></header>
  <OverlayScroll axis="y" edges className="tasks-column-scroll" viewportClassName="tasks-column-viewport" data-task-scroll-fade="vertical" viewportRef={setRoot} viewportProps={{'data-task-column-scroll':'',role:'region','aria-label':statusLabels[status]+'任务列表',tabIndex:0}}>
   <div className="tasks-cards" data-task-drop-container data-task-drop-layout="card" data-task-drop-key={'board:'+status} data-task-drop-status={status} data-task-drop-label={statusLabels[status]}>
    {tasks.map(item=><TaskEntry key={item.id} item={item} {...interactions} pending={interactions.pending.includes(item.recordId)} layout="card"/>)}
    <AutoTransition transitionKey={stateKey} className={stateClass} duration={.15}>
     {state==='loading'?<Spinner size="sm" label="正在加载任务…"/>:state==='error'?<><ErrorText error={q.error}/><Button label="重试" variant="ghost" size="sm" onClick={()=>q.refetch()}/></>:state==='empty'?'暂无任务':null}
    </AutoTransition>
    <TaskLoadMore root={root} hasMore={q.hasNextPage} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onLoad={()=>void q.fetchNextPage()}/>
   </div>
  </OverlayScroll>
 </section>;
}
export function TaskBoard({scope,statuses,counts,lists,interactions}:BoardProps){
 const {ref,height}=useTaskViewHeight();
 return <TaskDragProvider actions={interactions}><div className="tasks-view" ref={ref} style={height?{'--tasks-view-height':height+'px'} as CSSProperties:undefined}>
  <OverlayScroll axis="x" edges className="tasks-board-scroll" viewportClassName="tasks-board-viewport" data-task-scroll-fade="horizontal" viewportProps={{role:'region','aria-label':'任务看板',tabIndex:0}}>
   <div className="tasks-board">{statuses.map(status=><BoardColumn key={status} scope={scope} status={status} count={counts[status]} list={scope.recordId?lists.find(list=>list.id===scope.recordId):undefined} interactions={interactions}/>)}</div>
  </OverlayScroll>
 </div></TaskDragProvider>;
}

function TaskGroup({list,scope,statuses,root,interactions}:{list:TaskList;scope:TaskScope;statuses:TaskStatus[];root:HTMLElement|null;interactions:TaskInteractions}){
 const [expanded,setExpanded]=useState(true),[visible,setVisible]=useState(false);
 const ref=useTaskIntersection(root,!visible,()=>setVisible(true));
 const count=statuses.reduce((sum,status)=>sum+list.counts[status],0);
 const progress=list.total?Math.round(list.counts.done/list.total*100):0;
 const q=useInfiniteQuery({...taskPages({recordId:list.id,query:scope.query},statuses),enabled:visible&&expanded&&count>0});
 const tasks=useMemo(()=>q.data?.pages.flatMap(page=>page.items)??[],[q.data]);
 const emptyMessage=list.total?'所选状态下没有任务':'这个任务列表还是空的';
 const state=count===0?'empty':!visible||q.isPending?'loading':q.isError&&!tasks.length?'error':'ready';
 const stateKey=state==='empty'?'empty:'+emptyMessage:state==='error'?'error:'+String(q.error):state;
 const stateClass=state==='ready'?'tasks-inline-state':'tasks-'+state;
 return <section className="tasks-group" data-task-list-id={list.id} ref={ref}>
  <header className="tasks-group-header">
   <IconButton variant="ghost" size="sm" label={(expanded?'折叠':'展开')+list.name} aria-expanded={expanded}
    icon={<span className={'tasks-group-collapse-icon'+(expanded?' is-expanded':'')}><Icon name="chevronRight" size="sm" aria-hidden="true"/></span>}
    onClick={()=>setExpanded(v=>!v)}/>
   <div className="tasks-group-name"><h2>{list.name}</h2><span className="tasks-group-path" title={list.path}>{list.path}</span></div>
   <div className="tasks-group-progress" title={'已完成 '+list.counts.done+' / '+list.total}
    style={{'--tasks-progress':progress+'%'} as CSSProperties}>
    <span className="tasks-group-progress-track" role="progressbar" aria-label={list.name+'完成进度'} aria-valuemin={0} aria-valuemax={Math.max(1,list.total)} aria-valuenow={list.counts.done} aria-valuetext={list.counts.done+' / '+list.total}><span className="tasks-group-progress-fill"/></span>
    <AutoResizer animateWidth animateHeight={false} duration={.18}><span className="tasks-group-progress-stack"><AutoTransition as="span" mode="sync" className="tasks-group-progress-label" transitionKey={list.counts.done+':'+list.total} duration={.14}>{list.counts.done}/{list.total}</AutoTransition></span></AutoResizer>
   </div>
   <IconButton data-task-create variant="ghost" size="sm" label={'在'+list.name+'中新建任务'} icon={<Icon name="plus" size="sm"/>} onClick={()=>interactions.onCreate(list)}/>
  </header>
  <AutoResizer className="tasks-group-collapse" duration={.22}>
   <AutoTransition transitionKey={expanded?'open':'closed'} type="slideUp" duration={.16} mode="popLayout">
    {expanded?<div className="tasks-group-body" data-task-drop-container data-task-drop-layout="row" data-task-drop-key={'list:'+list.id} data-task-drop-record-id={list.id} data-task-drop-label={list.name}>
     {state==='ready'&&tasks.map(item=><TaskEntry key={item.id} item={item} {...interactions} layout="row" pending={interactions.pending.includes(item.recordId)}/>)}
     <AutoTransition transitionKey={stateKey} className={stateClass} duration={.15}>
      {state==='empty'?emptyMessage:state==='loading'?<Spinner size="sm" label="正在加载任务…"/>:state==='error'?<><ErrorText error={q.error}/><Button label="重试" variant="ghost" size="sm" onClick={()=>q.refetch()}/></>:null}
     </AutoTransition>
     {visible&&count>0&&<TaskLoadMore root={root} hasMore={q.hasNextPage} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onLoad={()=>void q.fetchNextPage()}/>}
    </div>:null}
   </AutoTransition>
  </AutoResizer>
 </section>;
}
type ListProps=BoardProps&{hasMore:boolean;loadingMore:boolean;loadError:boolean;onLoad:()=>void};
export function TaskListView({scope,statuses,lists,interactions,hasMore,loadingMore,loadError,onLoad}:ListProps){
 const {ref,height}=useTaskViewHeight(),[root,setRoot]=useState<HTMLDivElement|null>(null);
 return <TaskDragProvider actions={interactions}><div className="tasks-view" ref={ref} style={height?{'--tasks-view-height':height+'px'} as CSSProperties:undefined}>
  <OverlayScroll axis="y" edges className="tasks-list-scroll" viewportClassName="tasks-list-viewport" data-task-scroll-fade="vertical" viewportRef={setRoot} viewportProps={{'data-task-list-scroll':'',role:'region','aria-label':'所有任务列表',tabIndex:0}}>
   <div className="tasks-groups">{lists.map(list=><TaskGroup key={list.id} list={list} scope={scope} statuses={statuses} root={root} interactions={interactions}/>)}
    <TaskLoadMore root={root} hasMore={hasMore} loading={loadingMore} error={loadError} onLoad={onLoad}/>
   </div>
  </OverlayScroll>
 </div></TaskDragProvider>;
}
