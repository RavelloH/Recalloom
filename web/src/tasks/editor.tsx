import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link,useBlocker} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {Banner} from '@astryxdesign/core/Banner';
import {Spinner} from '@astryxdesign/core/Spinner';
import {api,ApiError,mutate,queryString} from '../api';
import {Icon} from '../icon';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {WorkspacePanel} from '../workspace-panels';
import {useConfirmDialog} from '../confirm-dialog';
import {isLogoutNavigationApproved,setActiveEditorDirty} from '../session-drafts';
import {sharedTitleAttributes} from '../shared-view-transition';
import {ErrorText,ago} from '../pages/shared';
import {findTaskItemInCache,taskItemQuery,statusLabels,taskStatuses,type TaskItem,type TaskItemsPage,type TaskList,type TaskListsPage,type TaskStatus} from './data';
import type {TaskActions} from './actions';
import {TaskStatusIcon} from './items';
import {hydrateTaskEditor,taskEditorChanges,taskEditorDirty,taskEditorDraft,taskItemFromMutation,type TaskEditorDraft} from './editor-state';

export type TaskSelection={id:string;recordId?:string;seed?:TaskItem;token?:number}|{id:null;list?:TaskList;status:TaskStatus;token?:number};
type EditorState={dirty:boolean;busy:boolean};
type EditorSession={key:string;selection:TaskSelection;open:boolean;activation:number};
type Guard=()=>Promise<boolean>;
let managerSequence=0;

export function taskEditorKey(selection:TaskSelection){
 return selection.id===null?'new-'+(selection.token??'draft'):selection.id;
}

/** Resolve a neighbouring anchor lazily: opening a drawer never fetches a whole task list. */
async function orderAnchor(item:TaskItem,direction:'up'|'down'){
 let cursor:string|null=null,previous:string|null=null,found=false,following=0;
 do{
  const page=await api<TaskItemsPage>('/tasks/view?'+queryString({recordId:item.recordId,statuses:item.status,order:'board',limit:200,cursor}));
  for(const task of page.items){
   if(task.id===item.id){if(direction==='up')return previous===null?undefined:previous;found=true;continue;}
   if(found&&++following===2)return task.id;
   if(!found)previous=task.id;
  }
  cursor=page.page.nextCursor as string|null;
 }while(cursor);
 if(!found)throw new Error('任务状态已改变，请重新载入后排序。');
 return following===0?undefined:null;
}

function TaskEditorForm({item,selection,lists,fixedRecordId,actions,detailsPending,detailsError,onRetryDetails,onStateChange,registerGuard,onSaved,onRemoved}:{
 item?:TaskItem;selection:TaskSelection;lists:TaskList[];fixedRecordId?:string;actions:TaskActions;
 detailsPending:boolean;detailsError:unknown;onRetryDetails:()=>void;onStateChange:(state:EditorState|null)=>void;
 registerGuard:(guard:Guard|null)=>void;onSaved:(item:TaskItem)=>void;onRemoved:()=>void;
}){
 const [base,setBase]=useState(item),[draft,setDraft]=useState<TaskEditorDraft>(()=>taskEditorDraft(item,selection.id===null?selection.status:'todo'));
 const [listId,setListId]=useState(item?.recordId??(selection.id===null?selection.list?.id:undefined)??fixedRecordId??lists[0]?.id??'__new__');
 const [listName,setListName]=useState(''),[createdList,setCreatedList]=useState<TaskList|null>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const createdId=useRef<string|null>(null),detailsTouched=useRef(false);
 const {confirm,confirmation}=useConfirmDialog();
 const detailsAvailable=selection.id===null||base?.details!==undefined;
 const dirty=taskEditorDirty(base,draft,detailsAvailable,selection.id===null?selection.status:'todo',listName);
 const live=useRef({dirty,busy});live.current={dirty,busy};
 useEffect(()=>{onStateChange({dirty,busy});return()=>onStateChange(null);},[dirty,busy,onStateChange]);
 useEffect(()=>{
  const allow=async()=>!live.current.busy&&(!live.current.dirty||await confirm({title:'放弃未保存的更改？',description:'任务的更改还没有保存。',actionLabel:'放弃更改'}));
  registerGuard(allow);return()=>registerGuard(null);
 },[registerGuard,confirm]);
 useEffect(()=>{
  if(!item)return;
  const hydrated=hydrateTaskEditor(base,draft,item,{dirty,busy,detailsTouched:detailsTouched.current});
  if(hydrated.base!==base)setBase(hydrated.base);
  if(hydrated.draft!==draft)setDraft(hydrated.draft);
  if(hydrated.replace)detailsTouched.current=false;
 },[item,base,draft,dirty,busy]);
 const reload=async()=>{
  if(busy)return;
  if(!base){
   setBusy(true);
   try{const latest=await api<TaskListsPage>('/task-lists?'+queryString({recordId:listId}));setCreatedList(latest.items[0]);setError(null);actions.clearError();setNotice('已刷新列表，任务输入已保留');}
   catch(error){setError(error);}finally{setBusy(false);}
   return;
  }
  if(dirty&&!await confirm({title:'放弃未保存的更改？',description:'重新载入会用最新任务替换当前未保存的内容。',actionLabel:'重新载入'}))return;
  setBusy(true);
  try{const latest=await api<{item:TaskItem}>('/tasks/'+base.id);setBase(latest.item);setDraft(taskEditorDraft(latest.item));detailsTouched.current=false;setError(null);actions.clearError();setNotice('已载入最新内容');}
  catch(error){setError(error);}finally{setBusy(false);}
 };
 const save=async()=>{
  if(busy||!draft.title.trim())return;setBusy(true);setError(null);setNotice('');
  try{
   if(base){
    const changes=taskEditorChanges(base,draft,detailsAvailable);
    if(!Object.keys(changes).length)return;
    const result=await actions.write({action:'update',taskId:base.id,recordId:base.recordId,expectedRevision:base.list.revision,changes});
    const updated=result.tasks.find(task=>task.id===base.id);
    if(!updated)throw new Error('任务已保存，但响应中没有更新后的任务。');
    const saved=taskItemFromMutation(updated,result.tasks,base.list,result.revision,undefined,result.boardOrder,base);
    setBase(saved);setDraft(taskEditorDraft(saved));detailsTouched.current=false;setNotice('已保存');onSaved(saved);
   }else{
    let list=(createdList?.id===listId?createdList:undefined)??lists.find(list=>list.id===listId)??(selection.id===null&&selection.list?.id===listId?selection.list:undefined);
    if(listId==='__new__'){
     if(!listName.trim())return;
     if(!createdId.current){const record=await mutate<{id:string}>('/records',{kind:'task_list',name:listName.trim(),folderId:null});createdId.current=record.id;}
     const result=await api<TaskListsPage>('/task-lists?'+queryString({recordId:createdId.current}));list=result.items[0];setCreatedList(list);setListId(list.id);
    }
    if(!list)throw new Error('请选择所属任务列表。');
    const result=await actions.write({action:'add',recordId:list.id,expectedRevision:list.revision,changes:{...draft,title:draft.title.trim()}});
    const created=result.tasks.at(-1);
    if(!created)throw new Error('任务已保存，但响应中没有新任务。');
    onSaved(taskItemFromMutation(created,result.tasks,list,result.revision,undefined,result.boardOrder));
   }
  }catch(error){setError(error);}finally{setBusy(false);}
 };
 const remove=async()=>{
  if(!base||busy||!await confirm({title:'删除这个任务？',description:'任务会从列表中移除，仍可通过列表的版本历史恢复。',actionLabel:'删除任务',destructive:true}))return;
  setBusy(true);setError(null);
  try{await actions.write({action:'remove',taskId:base.id,recordId:base.recordId,expectedRevision:base.list.revision});onRemoved();}
  catch(error){setError(error);}finally{setBusy(false);}
 };
 const reorder=async(direction:'up'|'down')=>{
  if(!base||busy||dirty)return;setBusy(true);setError(null);setNotice('');
  try{
   const anchor=await orderAnchor(base,direction);
   if(anchor===undefined){setNotice(direction==='up'?'已在同状态任务的最前面':'已在同状态任务的最后面');return;}
   await actions.move(base,anchor);
   const latest=await api<{item:TaskItem}>('/tasks/'+base.id);setBase(latest.item);setDraft(taskEditorDraft(latest.item));detailsTouched.current=false;setNotice('顺序已保存');
  }catch(error){setError(error);}finally{setBusy(false);}
 };
 const list=base?.list??lists.find(list=>list.id===listId)??(selection.id===null?selection.list:undefined);
 const conflict=error instanceof ApiError&&error.status===409;
 const disabled=busy||actions.pending.includes(base?.recordId??listId);
 const detailsState=detailsPending?'loading':detailsError?'error':'ready';
 return <div className="tasks-editor" data-task-editor>{confirmation}
  <form className="tasks-editor-form" onSubmit={event=>{event.preventDefault();void save();}}>
   {base&&<AutoResizer><AutoTransition transitionKey={base.title} duration={.14}><h3 className="tasks-editor-heading"><span className="rk-shared-text" {...sharedTitleAttributes('task',base.id)}>{base.title}</span></h3></AutoTransition></AutoResizer>}
   <AutoResizer className="tasks-editor-feedback-slot"><AutoTransition className="tasks-editor-feedback-transition" transitionKey={error?(conflict?'conflict':'error'):'none'} duration={.14}>{Boolean(error)&&(conflict?<Banner status="warning" title="任务列表已被修改" description="你的输入已保留。重新载入最新内容后再修改，避免覆盖其他客户端的更改。"/>:<ErrorText error={error}/>)}</AutoTransition></AutoResizer>
   {conflict&&<Button label="重新载入最新内容" variant="secondary" isDisabled={busy} onClick={()=>void reload()}/>}
   <div className="tasks-editor-fields">
    <TextInput label="任务标题" value={draft.title} onChange={title=>{setDraft(v=>({...v,title:title.slice(0,500)}));setNotice('');}} width="100%" isDisabled={disabled} hasAutoFocus={!base}/>
    <Selector label="任务状态" value={draft.status} onChange={status=>setDraft(v=>({...v,status:status as TaskStatus}))} width="100%" isDisabled={disabled} presentation="adaptive" options={taskStatuses.map(status=>({value:status,label:statusLabels[status],icon:<TaskStatusIcon status={status}/>}))}/>
    {!base&&!fixedRecordId&&<Selector label="所属任务列表" value={listId} onChange={setListId} width="100%" isDisabled={disabled} presentation="adaptive" hasSearch options={[...lists.map(list=>({value:list.id,label:list.name,description:list.path})),{value:'__new__',label:'新建任务列表',icon:<Icon name="plus" size="sm"/>}]}/>}
    {!base&&listId==='__new__'&&<TextInput label="任务列表名称" value={listName} onChange={value=>setListName(value.slice(0,200))} width="100%" isDisabled={disabled||Boolean(createdId.current)}/>}
    <AutoResizer className="tasks-editor-details-state"><AutoTransition className="tasks-editor-details-transition" transitionKey={detailsState} duration={.14}>
     {detailsPending?<div className="tasks-loading"><Spinner size="sm" label="正在加载任务详情…"/></div>:detailsError?<div className="tasks-error"><ErrorText error={detailsError}/><Button label="重试加载详情" variant="ghost" size="sm" onClick={onRetryDetails}/></div>:null}
    </AutoTransition></AutoResizer>
    <TextArea label="任务详情" value={draft.details} onChange={details=>{detailsTouched.current=true;setDraft(v=>({...v,details}));setNotice('');}} placeholder="补充目标、背景或验收要求…" width="100%" rows={8} maxLength={50000} isDisabled={disabled||!detailsAvailable}/>
   </div>
   {list&&<div className="tasks-editor-meta"><Link data-task-source to="/records/$recordId" params={{recordId:list.id}}><Icon name="taskList" size="sm"/> {list.name}</Link><span>{list.path}</span>{base&&<span>更新于{ago(base.updatedAt)} · R{base.list.revision}</span>}</div>}
   {base&&<div className="tasks-editor-order"><span>{dirty?'保存更改后可调整顺序':'在同状态的任务中排序'}</span><IconButton label="上移任务" variant="secondary" size="sm" icon={<Icon name="arrowUp" size="sm"/>} isDisabled={disabled||dirty} onClick={()=>void reorder('up')}/><IconButton label="下移任务" variant="secondary" size="sm" icon={<Icon name="arrowDown" size="sm"/>} isDisabled={disabled||dirty} onClick={()=>void reorder('down')}/></div>}
   <div className="tasks-editor-actions">{base?<Button label="删除任务" variant="ghost" size="sm" icon={<Icon name="trash" size="sm"/>} isDisabled={disabled} onClick={()=>void remove()}/>:<span className="muted small">任务创建后可继续编辑详情</span>}
    <Button type="submit" label={base?'保存更改':'创建任务'} variant="primary" size="sm" isLoading={busy} isDisabled={disabled||!draft.title.trim()||Boolean(!base&&listId==='__new__'&&!listName.trim())||(Boolean(base)&&!dirty)}/></div>
   <AutoResizer><AutoTransition as="span" transitionKey={notice||'none'} duration={.14}><span className="tasks-editor-notice muted small" role="status">{notice}</span></AutoTransition></AutoResizer>
  </form>
 </div>;
}

function TaskEditorPanel({session,lists,fixedRecordId,actions,close,remove,replaceSelection,updateState,updateGuard}:{
 session:EditorSession;lists:TaskList[];fixedRecordId?:string;actions:TaskActions;close:(key:string,force?:boolean)=>void;remove:(key:string)=>void;
 replaceSelection:(key:string,selection:TaskSelection)=>void;updateState:(key:string,state:EditorState|null)=>void;updateGuard:(key:string,guard:Guard|null)=>void;
}){
 const queryClient=useQueryClient(),selection=session.selection;
 const onStateChange=useCallback((state:EditorState|null)=>updateState(session.key,session.open?state:null),[session.key,session.open,updateState]);
 const registerGuard=useCallback((guard:Guard|null)=>updateGuard(session.key,session.open?guard:null),[session.key,session.open,updateGuard]);
 const onOpenChange=useCallback((open:boolean)=>{if(!open)close(session.key);},[close,session.key]);
 const forceClose=useCallback(()=>close(session.key,true),[close,session.key]);
 const onAfterClose=useCallback(()=>remove(session.key),[remove,session.key]);
 const onSelectionChange=useCallback((next:TaskSelection)=>replaceSelection(session.key,next),[replaceSelection,session.key]);
 const seed=useMemo(()=>selection.id===null?undefined:selection.seed??findTaskItemInCache(queryClient,selection.id),[selection,queryClient]);
 const q=useQuery({...taskItemQuery(selection.id??''),enabled:selection.id!==null});
 const fetched=q.data?.item;
 const item=useMemo(()=>selection.id===null?undefined:fetched&&seed
  ?fetched.list.revision>=seed.list.revision?fetched:{...seed,details:seed.details??fetched.details}
  :fetched??seed,[selection.id,fetched,seed]);
 const expectedRecordId=fixedRecordId??(selection.id===null?undefined:selection.recordId);
 const wrongList=Boolean(item&&expectedRecordId&&item.recordId!==expectedRecordId);
 const detailsPending=Boolean(selection.id!==null&&item&&item.details===undefined&&q.isFetching);
 const detailsError=selection.id!==null&&item?.details===undefined&&q.isError?q.error:null;
 return <WorkspacePanel id={'task-editor-'+session.key} label="任务详情" title={selection.id===null?'新建任务':'任务详情'} reserveSpace={false} open={session.open} activationKey={session.activation} onOpenChange={onOpenChange} onAfterClose={onAfterClose}>
  {selection.id===null?<TaskEditorForm key={'new:'+session.key} selection={selection} lists={lists} fixedRecordId={fixedRecordId} actions={actions} detailsPending={false} detailsError={null} onRetryDetails={()=>undefined} onStateChange={onStateChange} registerGuard={registerGuard} onSaved={item=>onSelectionChange({id:item.id,recordId:item.recordId,seed:item,token:selection.token})} onRemoved={forceClose}/>:
   !item&&q.isPending?<div className="tasks-loading"><Spinner size="sm" label="正在加载任务详情…"/></div>:
   wrongList?<div className="tasks-error"><Banner status="warning" title="任务不属于当前列表" description="请从对应的任务列表打开这个任务。"/></div>:
   !item&&q.isError?<div className="tasks-error"><ErrorText error={q.error}/><Button label="重试" variant="ghost" onClick={()=>void q.refetch()}/></div>:
   item?<TaskEditorForm key={item.id} item={item} selection={selection} lists={lists} actions={actions} detailsPending={detailsPending} detailsError={detailsError} onRetryDetails={()=>void q.refetch()} onStateChange={onStateChange} registerGuard={registerGuard} onSaved={saved=>onSelectionChange({id:saved.id,recordId:saved.recordId,seed:saved,token:selection.token})} onRemoved={forceClose}/>:null}
 </WorkspacePanel>;
}

/** Owns independent task panels. The selection prop is an open request and is consumed with onChange(null). */
export function TaskEditors({selection,lists,fixedRecordId,actions,onChange}:{selection:TaskSelection|null;lists:TaskList[];fixedRecordId?:string;actions:TaskActions;onChange:(next:TaskSelection|null)=>void}){
 const [sessions,setSessions]=useState<EditorSession[]>([]),[states,setStates]=useState<Record<string,EditorState>>({});
 const guards=useRef(new Map<string,Guard>()),handled=useRef('');
 const [dirtySource]=useState(()=>'task-editors-'+(++managerSequence));
 const {confirm,confirmation}=useConfirmDialog();
 const requestKey=selection?taskEditorKey(selection)+':'+(selection.token??''):'';
 useEffect(()=>{
  if(!selection){handled.current='';return;}
  if(handled.current===requestKey)return;
  handled.current=requestKey;
  const key=taskEditorKey(selection);
  setSessions(current=>{
   const existing=current.find(session=>session.key===key);
   return existing?current.map(session=>session.key===key?{...session,selection:{...session.selection,...selection},open:true,activation:session.activation+1}:session):[...current,{key,selection,open:true,activation:1}];
  });
  onChange(null);
 },[selection,requestKey,onChange]);
 const status=useMemo(()=>Object.values(states),[states]);
 const blocked=status.some(state=>state.dirty||state.busy),saving=status.some(state=>state.busy);
 useEffect(()=>{setActiveEditorDirty(blocked,dirtySource);return()=>setActiveEditorDirty(false,dirtySource);},[blocked,dirtySource]);
 const blocker=useBlocker({
  shouldBlockFn:({current,next})=>!isLogoutNavigationApproved()&&blocked&&(current.pathname!==next.pathname||JSON.stringify(current.search)!==JSON.stringify(next.search)),
  enableBeforeUnload:()=>!isLogoutNavigationApproved()&&blocked,disabled:!blocked,withResolver:true
 });
 useEffect(()=>{
  if(blocker.status!=='blocked')return;
  let cancelled=false;
  void (async()=>{
   const leave=!saving&&await confirm({title:'放弃未保存的任务更改？',description:'离开页面会丢弃所有任务面板中尚未保存的更改。',actionLabel:'放弃更改'});
   if(!cancelled){if(leave)blocker.proceed();else blocker.reset();}
  })();
  return()=>{cancelled=true;};
 },[blocker.status,saving,confirm]);
 const updateState=useCallback((key:string,state:EditorState|null)=>setStates(current=>{
  if(!state){if(!(key in current))return current;const next={...current};delete next[key];return next;}
  const old=current[key];return old?.dirty===state.dirty&&old.busy===state.busy?current:{...current,[key]:state};
 }),[]);
 const registerGuard=useCallback((key:string,guard:Guard|null)=>{if(guard)guards.current.set(key,guard);else guards.current.delete(key);},[]);
 const close=useCallback(async(key:string,force=false)=>{
  const guard=guards.current.get(key);
  if(!force&&guard&&!await guard())return;
  setSessions(current=>current.map(session=>session.key===key?{...session,open:false}:session));
 },[]);
 const remove=useCallback((key:string)=>{setSessions(current=>current.filter(candidate=>candidate.key!==key));updateState(key,null);guards.current.delete(key);},[updateState]);
 const replaceSelection=useCallback((key:string,next:TaskSelection)=>setSessions(current=>{
  if(next.id===null)return current.map(candidate=>candidate.key===key?{...candidate,selection:next}:candidate);
  const alreadyOpen=current.find(candidate=>candidate.key===next.id&&candidate.key!==key);
  if(alreadyOpen)return current.filter(candidate=>candidate.key!==key).map(candidate=>candidate.key===next.id?{...candidate,selection:next,open:true}:candidate);
  return current.map(candidate=>candidate.key===key?{...candidate,key:next.id,selection:next}:candidate);
 }),[]);
 return <>{confirmation}{sessions.map(session=><TaskEditorPanel key={session.key} session={session} lists={lists} fixedRecordId={fixedRecordId} actions={actions}
  close={(key,force)=>void close(key,force)} remove={remove} replaceSelection={replaceSelection} updateState={updateState} updateGuard={registerGuard}/>)}</>;
}
