import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {Selector} from '@astryxdesign/core/Selector';
import {WorkspaceToolbar,WorkspaceSearch} from '../workspace-toolbar';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Icon} from '../icon';
import {taskListPages,emptyCounts,taskStatuses,statusLabels,readTaskPreferences,writeTaskPreferences,type TaskItem,type TaskList,type TaskStatus} from '../tasks/data';
import {useTaskActions} from '../tasks/actions';
import {TaskBoard,TaskListView,type TaskInteractions} from '../tasks/views';
import {TaskStatusIcon} from '../tasks/items';
import {TaskEditors,type TaskSelection} from '../tasks/editor';
import {TasksContentTransition,TasksResultCount,TasksStateTransition,TasksViewSwitcher} from '../tasks/toolbar';
import {PageTitle,ErrorText,Empty} from './shared';

export function TasksPage({recordId,focusTaskId,recordActions}:{recordId?:string;focusTaskId?:string;recordActions?:ReactNode}){
 const [preferences]=useState(readTaskPreferences),[view,setView]=useState(preferences.view),[statuses,setStatuses]=useState(preferences.statuses);
 const [source,setSource]=useState('all'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[catalogNeeded,setCatalogNeeded]=useState(false);
 const [selection,setSelection]=useState<TaskSelection|null>(()=>focusTaskId?{id:focusTaskId,recordId}:null);
 const dragged=useRef<TaskItem|null>(null),requestSequence=useRef(0),actions=useTaskActions();
 const lastFocus=useRef(focusTaskId);
 const scope=useMemo(()=>({recordId:recordId??(source==='all'?undefined:source),query:query||undefined}),[recordId,source,query]);
 const listsQuery=useInfiniteQuery(taskListPages(scope));
 const catalog=useInfiniteQuery({...taskListPages(recordId?{recordId}:{}),enabled:!recordId||catalogNeeded});
 const lists=useMemo(()=>listsQuery.data?.pages.flatMap(page=>page.items)??[],[listsQuery.data]);
 const catalogLists=useMemo(()=>catalog.data?.pages.flatMap(page=>page.items)??[],[catalog.data]);
 const counts=listsQuery.data?.pages[0]?.counts??emptyCounts;
 const total=statuses.reduce((sum,status)=>sum+counts[status],0);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),220);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>writeTaskPreferences(view,statuses),[view,statuses]);
 useEffect(()=>{if(lastFocus.current!==focusTaskId){lastFocus.current=focusTaskId;setSelection(focusTaskId?{id:focusTaskId,recordId}:null);}},[focusTaskId,recordId]);
 // Load only lightweight metadata for the source picker; task pages stay lazy.
 useEffect(()=>{if((catalogNeeded||selection?.id===null)&&catalog.hasNextPage&&!catalog.isFetchingNextPage&&!catalog.isFetchNextPageError)void catalog.fetchNextPage();},[catalogNeeded,selection?.id,catalog.hasNextPage,catalog.isFetchingNextPage,catalog.isFetchNextPageError,catalog.fetchNextPage]);
 const choose=useCallback((next:TaskSelection)=>{
  actions.clearError();setSelection(next);
 },[actions.clearError]);
 const onEdit=useCallback((item:TaskItem)=>choose({id:item.id,recordId:item.recordId,seed:item,token:++requestSequence.current}),[choose]);
 const onCreate=useCallback((list?:TaskList,status:TaskStatus='todo')=>{
  const selected=list??lists.find(list=>list.id===scope.recordId);
  choose({id:null,list:selected,status,token:++requestSequence.current});setCatalogNeeded(true);
 },[choose,lists,scope.recordId]);
 const onStatus=useCallback((item:TaskItem,status:TaskStatus)=>{if(item.status!==status)void actions.update(item,{status}).catch(()=>undefined);},[actions.update]);
 const onDrag=useCallback((item:TaskItem|null)=>{dragged.current=item;},[]);
 const canDrop=useCallback((item:TaskItem)=>Boolean(dragged.current&&dragged.current.id!==item.id&&dragged.current.recordId===item.recordId),[]);
 const onDrop=useCallback(async(target:TaskItem)=>{
  const item=dragged.current;dragged.current=null;
  if(item&&item.id!==target.id&&item.recordId===target.recordId)await actions.move(item,target.id,view==='board'?target.status:item.status);
 },[actions.move,view]);
 const onColumnDrop=useCallback(async(status:TaskStatus)=>{const item=dragged.current;dragged.current=null;if(item)await actions.move(item,null,status);},[actions.move]);
 const onBoardDrop=useCallback(async(beforeTaskId:string|null,status:TaskStatus)=>{const item=dragged.current;dragged.current=null;if(item)await actions.moveBoard(item,beforeTaskId,status);},[actions.moveBoard]);
 const canColumnDrop=useCallback(()=>Boolean(dragged.current),[]);
 const interactions=useMemo<TaskInteractions>(()=>({pending:actions.pending,onEdit,onCreate,onStatus,onDrag,onDrop,canDrop,onColumnDrop,canColumnDrop,onBoardDrop}),[actions.pending,onEdit,onCreate,onStatus,onDrag,onDrop,canDrop,onColumnDrop,canColumnDrop,onBoardDrop]);
 const createButton=<Button data-task-create label="新建任务" icon={<Icon name="plus" size="sm"/>} variant="primary" size="sm" onClick={()=>onCreate()}/>;
 const statusFilter=<div className="tasks-filter-status" data-task-status-filter><MultiSelector label="显示的状态" isLabelHidden size="sm" variant="secondary" width="100%" value={statuses} options={taskStatuses.map(status=>({value:status,label:statusLabels[status],description:String(counts[status])+' 项',icon:<TaskStatusIcon status={status}/>}))} onChange={value=>setStatuses(taskStatuses.filter(s=>value.includes(s)))} presentation="adaptive" hasSelectAll hasClear selectAllLabel="全部状态" placeholder="未选择状态" formatValue={items=>items.length===5?'全部状态':items.length===1?items[0].label:items.length+' 种状态'}/></div>;
 const sourceFilter=!recordId&&<div className="tasks-filter-source"><Selector label="所属任务列表" isLabelHidden size="sm" variant="secondary" width="100%" value={source} onChange={setSource} onFocus={()=>setCatalogNeeded(true)} onClick={()=>setCatalogNeeded(true)} hasSearch presentation="adaptive" options={[{value:'all',label:'所有任务列表'},...catalogLists.map(list=>({value:list.id,label:list.name,description:list.path}))]}/></div>;
 const searchField=<div className={recordId?'tasks-filter-search':undefined} data-task-search><WorkspaceSearch label="搜索任务" value={search} onChange={value=>setSearch(value.slice(0,200))} placeholder="搜索任务…"/></div>;
 const contentState=listsQuery.isError&&!lists.length?'error':!statuses.length?'no-status':view==='board'?'board':listsQuery.isPending?'list-loading':lists.length?'list-ready':'list-empty';
 return <div className={recordId?'tasks-workspace embedded-tasks':'page workspace-page workspace-full-page tasks-page tasks-workspace'} data-task-workspace>
  {!recordId&&<PageTitle title="任务" description="按状态推进任务，按列表保留上下文。" actions={createButton}/>}
  {recordId?<div className="tasks-toolbar">
   <TasksViewSwitcher view={view} onChange={setView}/>
   <div className="tasks-filters">
    {statusFilter}{sourceFilter}{searchField}
   </div>
   <TasksResultCount pending={listsQuery.isPending} total={total}/>{recordId&&<div className="tasks-toolbar-actions">{recordActions}{createButton}</div>}
  </div>:<WorkspaceToolbar filters={<><TasksViewSwitcher view={view} onChange={setView}/>{statusFilter}{sourceFilter}</>} search={searchField} meta={<TasksResultCount pending={listsQuery.isPending} total={total}/>}/>}
  <TasksStateTransition stateKey={actions.error?String(actions.error):'none'}>{Boolean(actions.error)&&<ErrorText error={actions.error}/>}</TasksStateTransition>
  <TasksStateTransition stateKey={catalog.isFetchNextPageError&&catalogNeeded?'error':'none'}>{catalog.isFetchNextPageError&&catalogNeeded&&<div className="tasks-error"><ErrorText error={catalog.error}/><Button label="重新加载任务列表" variant="ghost" size="sm" onClick={()=>void catalog.fetchNextPage()}/></div>}</TasksStateTransition>
  <TasksContentTransition transitionKey={contentState}>
  {listsQuery.isError&&!lists.length?<div className="tasks-error"><ErrorText error={listsQuery.error}/><Button label="重试" variant="ghost" onClick={()=>listsQuery.refetch()}/></div>:
   statuses.length===0?<div className="tasks-empty"><Empty title="选择要显示的状态" description="可以同时选择多个状态，也可以显示全部状态。"/><Button label="显示全部状态" variant="secondary" size="sm" onClick={()=>setStatuses([...taskStatuses])}/></div>:
   view==='board'?<TaskBoard scope={scope} statuses={statuses} counts={counts} lists={lists} interactions={interactions}/>:
   listsQuery.isPending?<div className="tasks-loading"><Spinner size="sm" label="正在加载任务列表…"/></div>:lists.length?<TaskListView scope={scope} statuses={statuses} counts={counts} lists={lists} interactions={interactions} hasMore={listsQuery.hasNextPage} loadingMore={listsQuery.isFetchingNextPage} loadError={listsQuery.isFetchNextPageError} onLoad={()=>void listsQuery.fetchNextPage()}/>:<Empty title={query?'没有匹配的任务':'还没有任务列表'} description={query?'试试其他关键词，或切换任务列表。':'点击右上方加号创建任务及其所属列表。'}/>}
  </TasksContentTransition>
  <TaskEditors selection={selection} lists={catalogLists.length?catalogLists:lists} fixedRecordId={recordId} actions={actions} onChange={setSelection}/>
 </div>;
}
