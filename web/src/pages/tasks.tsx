import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Icon} from '../icon';
import {taskListPages,emptyCounts,taskStatuses,statusLabels,readTaskPreferences,writeTaskPreferences,type TaskItem,type TaskList,type TaskStatus} from '../tasks/data';
import {useTaskActions} from '../tasks/actions';
import {TaskBoard,TaskListView,type TaskInteractions} from '../tasks/views';
import {TaskStatusIcon} from '../tasks/items';
import {TaskEditor,type TaskSelection,type TaskChangeGuard} from '../tasks/editor';
import {PageTitle,ErrorText,Empty} from './shared';

export function TasksPage({recordId,focusTaskId}:{recordId?:string;focusTaskId?:string}){
 const [preferences]=useState(readTaskPreferences),[view,setView]=useState(preferences.view),[statuses,setStatuses]=useState(preferences.statuses);
 const [source,setSource]=useState('all'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[catalogNeeded,setCatalogNeeded]=useState(false);
 const [selection,setSelection]=useState<TaskSelection|null>(()=>focusTaskId?{id:focusTaskId,recordId}:null);
 const guard:TaskChangeGuard=useRef(null),dragged=useRef<TaskItem|null>(null),actions=useTaskActions();
 const activeSelection=useRef(selection);activeSelection.current=selection;
 const lastFocus=useRef(focusTaskId);
 const scope=useMemo(()=>({recordId:recordId??(source==='all'?undefined:source),query:query||undefined}),[recordId,source,query]);
 const listsQuery=useInfiniteQuery(taskListPages(scope));
 const catalog=useInfiniteQuery({...taskListPages(recordId?{recordId}:{}),enabled:!recordId||Boolean(selection&&selection.id===null)});
 const lists=useMemo(()=>listsQuery.data?.pages.flatMap(page=>page.items)??[],[listsQuery.data]);
 const catalogLists=useMemo(()=>catalog.data?.pages.flatMap(page=>page.items)??[],[catalog.data]);
 const counts=listsQuery.data?.pages[0]?.counts??emptyCounts;
 const total=statuses.reduce((sum,status)=>sum+counts[status],0);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),220);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>writeTaskPreferences(view,statuses),[view,statuses]);
 useEffect(()=>{if(lastFocus.current!==focusTaskId){lastFocus.current=focusTaskId;setSelection(focusTaskId?{id:focusTaskId,recordId}:null);}},[focusTaskId,recordId]);
 // Load only lightweight metadata for the source picker; task pages stay lazy.
 useEffect(()=>{if((catalogNeeded||selection?.id===null)&&catalog.hasNextPage&&!catalog.isFetchingNextPage&&!catalog.isFetchNextPageError)void catalog.fetchNextPage();},[catalogNeeded,selection?.id,catalog.hasNextPage,catalog.isFetchingNextPage,catalog.isFetchNextPageError,catalog.fetchNextPage]);
 const choose=useCallback(async(next:TaskSelection)=>{
  if(activeSelection.current&&guard.current&&!await guard.current())return;
  actions.clearError();setSelection(next);
 },[actions.clearError]);
 const onEdit=useCallback((item:TaskItem)=>{if(activeSelection.current?.id!==item.id)void choose({id:item.id,recordId:item.recordId,token:Date.now()});},[choose]);
 const onCreate=useCallback((list?:TaskList,status:TaskStatus='todo')=>{
  const selected=list??lists.find(list=>list.id===scope.recordId);
  void choose({id:null,list:selected,status,token:Date.now()});setCatalogNeeded(true);
 },[choose,lists,scope.recordId]);
 const onStatus=useCallback((item:TaskItem,status:TaskStatus)=>{if(item.status!==status)void actions.update(item,{status}).catch(()=>undefined);},[actions.update]);
 const onDrag=useCallback((item:TaskItem|null)=>{dragged.current=item;},[]);
 const canDrop=useCallback((item:TaskItem)=>Boolean(dragged.current&&dragged.current.id!==item.id&&dragged.current.recordId===item.recordId),[]);
 const onDrop=useCallback((target:TaskItem)=>{
  const item=dragged.current;dragged.current=null;
  if(item&&item.id!==target.id&&item.recordId===target.recordId)void actions.move(item,target.id,view==='board'?target.status:item.status).catch(()=>undefined);
 },[actions.move,view]);
 const onColumnDrop=useCallback((status:TaskStatus)=>{const item=dragged.current;dragged.current=null;if(item)void actions.move(item,null,status).catch(()=>undefined);},[actions.move]);
 const canColumnDrop=useCallback(()=>Boolean(dragged.current),[]);
 const interactions=useMemo<TaskInteractions>(()=>({pending:actions.pending,onEdit,onCreate,onStatus,onDrag,onDrop,canDrop,onColumnDrop,canColumnDrop}),[actions.pending,onEdit,onCreate,onStatus,onDrag,onDrop,canDrop,onColumnDrop,canColumnDrop]);
 const createButton=<Button data-task-create label="新建任务" icon={<Icon name="plus" size="sm"/>} variant="primary" size="sm" onClick={()=>onCreate()}/>;
 return <div className={recordId?'tasks-workspace embedded-tasks':'page tasks-page tasks-workspace'} data-task-workspace>
  {!recordId&&<PageTitle title="任务" description="按状态推进任务，按列表保留上下文。" actions={createButton}/>}
  <div className="tasks-toolbar">
   <ButtonGroup className="tasks-view-switch" label="任务视图" size="sm"><Button label="看板" variant={view==='board'?'secondary':'ghost'} aria-pressed={view==='board'} icon={<Icon name="taskBoard" size="sm"/>} onClick={()=>setView('board')}/><Button label="列表" variant={view==='list'?'secondary':'ghost'} aria-pressed={view==='list'} icon={<Icon name="list" size="sm"/>} onClick={()=>setView('list')}/></ButtonGroup>
   <div className="tasks-filters">
    <div className="tasks-filter-status" data-task-status-filter><MultiSelector label="显示的状态" isLabelHidden size="sm" variant="secondary" width="100%" value={statuses} options={taskStatuses.map(status=>({value:status,label:statusLabels[status],description:String(counts[status])+' 项',icon:<TaskStatusIcon status={status}/>}))} onChange={value=>setStatuses(taskStatuses.filter(s=>value.includes(s)))} presentation="adaptive" hasSelectAll hasClear selectAllLabel="全部状态" placeholder="未选择状态" formatValue={items=>items.length===5?'全部状态':items.length===1?items[0].label:items.length+' 种状态'}/></div>
    {!recordId&&<div className="tasks-filter-source"><Selector label="所属任务列表" isLabelHidden size="sm" variant="secondary" width="100%" value={source} onChange={setSource} onFocus={()=>setCatalogNeeded(true)} onClick={()=>setCatalogNeeded(true)} hasSearch presentation="adaptive" options={[{value:'all',label:'所有任务列表'},...catalogLists.map(list=>({value:list.id,label:list.name,description:list.path}))]}/></div>}
    <div className="tasks-filter-search" data-task-search><TextInput label="搜索任务" isLabelHidden size="sm" value={search} onChange={value=>setSearch(value.slice(0,200))} placeholder="搜索任务…" startIcon={<Icon name="search" size="sm"/>} width="100%"/></div>
   </div>
   <span className="tasks-result-count" role="status">{listsQuery.isPending?'…':total+' 项'}</span>{recordId&&createButton}
  </div>
  {Boolean(actions.error)&&<ErrorText error={actions.error}/>}
  {catalog.isFetchNextPageError&&catalogNeeded&&<div className="tasks-error"><ErrorText error={catalog.error}/><Button label="重新加载任务列表" variant="ghost" size="sm" onClick={()=>void catalog.fetchNextPage()}/></div>}
  {listsQuery.isError&&!lists.length?<div className="tasks-error"><ErrorText error={listsQuery.error}/><Button label="重试" variant="ghost" onClick={()=>listsQuery.refetch()}/></div>:
   statuses.length===0?<div className="tasks-empty"><Empty title="选择要显示的状态" description="可以同时选择多个状态，也可以显示全部状态。"/><Button label="显示全部状态" variant="secondary" size="sm" onClick={()=>setStatuses([...taskStatuses])}/></div>:
   view==='board'?<TaskBoard scope={scope} statuses={statuses} counts={counts} lists={lists} interactions={interactions}/>:
   listsQuery.isPending?<div className="tasks-loading"><Spinner size="sm" label="正在加载任务列表…"/></div>:lists.length?<TaskListView scope={scope} statuses={statuses} counts={counts} lists={lists} interactions={interactions} hasMore={listsQuery.hasNextPage} loadingMore={listsQuery.isFetchingNextPage} loadError={listsQuery.isFetchNextPageError} onLoad={()=>void listsQuery.fetchNextPage()}/>:<Empty title={query?'没有匹配的任务':'还没有任务列表'} description={query?'试试其他关键词，或切换任务列表。':'点击右上方加号创建任务及其所属列表。'}/>}
  <TaskEditor selection={selection} lists={catalogLists.length?catalogLists:lists} fixedRecordId={recordId} actions={actions} guard={guard} onChange={setSelection}/>
 </div>;
}
