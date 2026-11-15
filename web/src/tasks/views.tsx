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

export type TaskInteractions=Pick<TaskItemProps,'onEdit'|'onStatus'|'onDrag'|'onDrop'|'canDrop'>&{
 pending:string[];onCreate:(list?:TaskList,status?:TaskStatus)=>void;onColumnDrop:(status:TaskStatus)=>void;canColumnDrop:()=>boolean;
};
type BoardProps={scope:TaskScope;statuses:TaskStatus[];counts:TaskCounts;lists:TaskList[];interactions:TaskInteractions};
function BoardColumn({scope,status,count,list,interactions}:{scope:TaskScope;status:TaskStatus;count:number;list?:TaskList;interactions:TaskInteractions}){
 const q=useInfiniteQuery(taskPages(scope,[status])),[root,setRoot]=useState<HTMLDivElement|null>(null);
 const tasks=useMemo(()=>q.data?.pages.flatMap(page=>page.items)??[],[q.data]);
 return <section className="tasks-column" data-task-column={status} aria-label={statusLabels[status]}
  onDragOver={event=>{if(interactions.canColumnDrop()){event.preventDefault();event.dataTransfer.dropEffect='move';}}}
  onDrop={event=>{if(interactions.canColumnDrop()){event.preventDefault();interactions.onColumnDrop(status);}}}>
  <header className="tasks-column-header"><div className="tasks-column-label"><TaskStatusIcon status={status}/><h2>{statusLabels[status]}</h2><span className="tasks-column-count">{count}</span></div>
   <IconButton data-task-create label={'新建'+statusLabels[status]+'任务'} icon={<Icon name="plus" size="sm"/>} variant="ghost" size="sm" onClick={()=>interactions.onCreate(list,status)}/></header>
  <OverlayScroll axis="y" edges className="tasks-column-scroll" viewportClassName="tasks-column-viewport" data-task-scroll-fade="vertical" viewportRef={setRoot} viewportProps={{'data-task-column-scroll':'',role:'region','aria-label':statusLabels[status]+'任务列表',tabIndex:0}}>
   <div className="tasks-cards">
    {q.isPending?<div className="tasks-loading"><Spinner size="sm" label="正在加载任务…"/></div>:q.isError&&!tasks.length?<div className="tasks-error"><ErrorText error={q.error}/><Button label="重试" variant="ghost" size="sm" onClick={()=>q.refetch()}/></div>:null}
    {tasks.map(item=><TaskEntry key={item.id} item={item} {...interactions} pending={interactions.pending.includes(item.recordId)} layout="card"/>)}
    {!q.isPending&&!q.isError&&!tasks.length&&<p className="tasks-empty">暂无任务</p>}
    <TaskLoadMore root={root} hasMore={q.hasNextPage} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onLoad={()=>void q.fetchNextPage()}/>
   </div>
  </OverlayScroll>
 </section>;
}
export function TaskBoard({scope,statuses,counts,lists,interactions}:BoardProps){
 const {ref,height}=useTaskViewHeight();
 return <div className="tasks-view" ref={ref} style={height?{'--tasks-view-height':height+'px'} as CSSProperties:undefined}>
  <OverlayScroll axis="x" edges className="tasks-board-scroll" viewportClassName="tasks-board-viewport" data-task-scroll-fade="horizontal" viewportProps={{role:'region','aria-label':'任务看板',tabIndex:0}}>
   <div className="tasks-board">{statuses.map(status=><BoardColumn key={status} scope={scope} status={status} count={counts[status]} list={scope.recordId?lists.find(list=>list.id===scope.recordId):undefined} interactions={interactions}/>)}</div>
  </OverlayScroll>
 </div>;
}

function TaskGroup({list,scope,statuses,root,interactions}:{list:TaskList;scope:TaskScope;statuses:TaskStatus[];root:HTMLElement|null;interactions:TaskInteractions}){
 const [expanded,setExpanded]=useState(true),[visible,setVisible]=useState(false);
 const ref=useTaskIntersection(root,!visible,()=>setVisible(true));
 const count=statuses.reduce((sum,status)=>sum+list.counts[status],0);
 const q=useInfiniteQuery({...taskPages({recordId:list.id,query:scope.query},statuses),enabled:visible&&expanded&&count>0});
 const tasks=useMemo(()=>q.data?.pages.flatMap(page=>page.items)??[],[q.data]);
 return <section className="tasks-group" data-task-list-id={list.id} ref={ref}>
  <header className="tasks-group-header">
   <IconButton variant="ghost" size="sm" label={(expanded?'折叠':'展开')+list.name} aria-expanded={expanded} icon={<Icon name={expanded?'chevronDown':'chevronRight'} size="sm"/>} onClick={()=>setExpanded(v=>!v)}/>
   <div className="tasks-group-name"><h2>{list.name}</h2><span className="tasks-group-path" title={list.path}>{list.path}</span></div>
   <span className="tasks-group-progress" title={'已完成 '+list.counts.done+' / '+list.total}>{count} 项<span> · {list.counts.done}/{list.total} 完成</span></span>
   <IconButton data-task-create variant="ghost" size="sm" label={'在'+list.name+'中新建任务'} icon={<Icon name="plus" size="sm"/>} onClick={()=>interactions.onCreate(list)}/>
  </header>
  {expanded&&<div className="tasks-group-body">
   {count===0?<p className="tasks-empty">{list.total?'所选状态下没有任务':'这个任务列表还是空的'}</p>:!visible||q.isPending?<div className="tasks-loading"><Spinner size="sm" label="正在加载任务…"/></div>:q.isError&&!tasks.length?<div className="tasks-error"><ErrorText error={q.error}/><Button label="重试" variant="ghost" size="sm" onClick={()=>q.refetch()}/></div>:tasks.map(item=><TaskEntry key={item.id} item={item} {...interactions} layout="row" pending={interactions.pending.includes(item.recordId)}/>)}
   {visible&&count>0&&<TaskLoadMore root={root} hasMore={q.hasNextPage} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onLoad={()=>void q.fetchNextPage()}/>}
  </div>}
 </section>;
}
type ListProps=BoardProps&{hasMore:boolean;loadingMore:boolean;loadError:boolean;onLoad:()=>void};
export function TaskListView({scope,statuses,lists,interactions,hasMore,loadingMore,loadError,onLoad}:ListProps){
 const {ref,height}=useTaskViewHeight(),[root,setRoot]=useState<HTMLDivElement|null>(null);
 return <div className="tasks-view" ref={ref} style={height?{'--tasks-view-height':height+'px'} as CSSProperties:undefined}>
  <OverlayScroll axis="y" edges className="tasks-list-scroll" viewportClassName="tasks-list-viewport" data-task-scroll-fade="vertical" viewportRef={setRoot} viewportProps={{'data-task-list-scroll':'',role:'region','aria-label':'所有任务列表',tabIndex:0}}>
   <div className="tasks-groups">{lists.map(list=><TaskGroup key={list.id} list={list} scope={scope} statuses={statuses} root={root} interactions={interactions}/>)}
    <TaskLoadMore root={root} hasMore={hasMore} loading={loadingMore} error={loadError} onLoad={onLoad}/>
   </div>
  </OverlayScroll>
 </div>;
}
