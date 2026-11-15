import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {useQuery} from '@tanstack/react-query';
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
import {WorkspacePanel} from '../workspace-panels';
import {useConfirmDialog} from '../confirm-dialog';
import {isLogoutNavigationApproved,setActiveEditorDirty} from '../session-drafts';
import {sharedTitleAttributes} from '../shared-view-transition';
import {ErrorText,ago} from '../pages/shared';
import {taskItemQuery,statusLabels,taskStatuses,type TaskItem,type TaskList,type TaskListsPage,type TaskStatus} from './data';
import type {Paged} from '../types';
import type {TaskActions} from './actions';
import {TaskStatusIcon} from './items';

export type TaskSelection={id:string;recordId?:string;token?:number}|{id:null;list?:TaskList;status:TaskStatus;token?:number};
export type TaskChangeGuard=MutableRefObject<(()=>Promise<boolean>)|null>;
type Draft={title:string;details:string;status:TaskStatus};
const fields=(item?:TaskItem,status:TaskStatus='todo'):Draft=>({title:item?.title??'',details:item?.details??'',status:item?.status??status});

/** Resolve a neighbouring anchor lazily: opening a drawer never fetches a whole task list. */
async function orderAnchor(item:TaskItem,direction:'up'|'down'){
 let cursor:string|null=null,previous:string|null=null,found=false,following=0;
 do{
  const page=await api<Paged<TaskItem>>('/tasks/view?'+queryString({recordId:item.recordId,statuses:item.status,limit:200,cursor}));
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

function TaskEditorForm({item,selection,lists,fixedRecordId,actions,guard,active,onSaved,onRemoved}:{item?:TaskItem;selection:TaskSelection;lists:TaskList[];fixedRecordId?:string;actions:TaskActions;guard:TaskChangeGuard;active:boolean;onSaved:(id:string)=>void;onRemoved:()=>void}){
 const [base,setBase]=useState(item),[draft,setDraft]=useState(()=>fields(item,selection.id===null?selection.status:'todo'));
 const [listId,setListId]=useState(item?.recordId??(selection.id===null?selection.list?.id:undefined)??fixedRecordId??lists[0]?.id??'__new__');
 const [listName,setListName]=useState(''),[createdList,setCreatedList]=useState<TaskList|null>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const createdId=useRef<string|null>(null);
 const {confirm,confirmation}=useConfirmDialog();
 const initial=fields(base,selection.id===null?selection.status:'todo');
 const dirty=draft.title!==initial.title||draft.details!==initial.details||draft.status!==initial.status||(!base&&Boolean(listName.trim()));
 const live=useRef({dirty,busy});live.current={dirty,busy};
 useEffect(()=>{setActiveEditorDirty(active&&(dirty||busy));return()=>setActiveEditorDirty(false);},[active,dirty,busy]);
 const blocker=useBlocker({
  shouldBlockFn:({current,next})=>!isLogoutNavigationApproved()&&active&&(dirty||busy)&&(current.pathname!==next.pathname||JSON.stringify(current.search)!==JSON.stringify(next.search)),
  enableBeforeUnload:()=>!isLogoutNavigationApproved()&&active&&(dirty||busy),disabled:!active||(!dirty&&!busy),withResolver:true
 });
 useEffect(()=>{
  if(blocker.status!=='blocked')return;
  let cancelled=false;
  void (async()=>{
   const leave=!live.current.busy&&await confirm({title:'放弃未保存的更改？',description:'离开页面会丢弃当前任务尚未保存的更改。',actionLabel:'放弃更改'});
   if(!cancelled){if(leave)blocker.proceed();else blocker.reset();}
  })();
  return()=>{cancelled=true;};
 },[blocker.status,confirm]);
 useEffect(()=>{
  const allow=async()=>!live.current.busy&&(!live.current.dirty||await confirm({title:'放弃未保存的更改？',description:'任务的更改还没有保存。',actionLabel:'放弃更改'}));
  guard.current=allow;return()=>{if(guard.current===allow)guard.current=null;};
 },[guard,confirm]);
 useEffect(()=>{
  if(!dirty&&!busy&&item&&item.list.revision!==base?.list.revision){setBase(item);setDraft(fields(item));}
 },[item,dirty,busy,base?.list.revision]);
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
  try{const latest=await api<{item:TaskItem}>('/tasks/'+base.id);setBase(latest.item);setDraft(fields(latest.item));setError(null);actions.clearError();setNotice('已载入最新内容');}
  catch(error){setError(error);}finally{setBusy(false);}
 };
 const save=async()=>{
  if(busy||!draft.title.trim())return;setBusy(true);setError(null);setNotice('');
  try{
   if(base){
    await actions.write({action:'update',taskId:base.id,recordId:base.recordId,expectedRevision:base.list.revision,changes:{...draft,title:draft.title.trim()}});
    const latest=await api<{item:TaskItem}>('/tasks/'+base.id);setBase(latest.item);setDraft(fields(latest.item));setNotice('已保存');
   }else{
    let list=(createdList?.id===listId?createdList:undefined)??lists.find(list=>list.id===listId)??(selection.id===null&&selection.list?.id===listId?selection.list:undefined);
    if(listId==='__new__'){
     if(!listName.trim())return;
     if(!createdId.current){const record=await mutate<{id:string}>('/records',{kind:'task_list',name:listName.trim(),folderId:null});createdId.current=record.id;}
     const result=await api<TaskListsPage>('/task-lists?'+queryString({recordId:createdId.current}));list=result.items[0];setCreatedList(list);setListId(list.id);
    }
    if(!list)throw new Error('请选择所属任务列表。');
    const result=await actions.write({action:'add',recordId:list.id,expectedRevision:list.revision,changes:{...draft,title:draft.title.trim()}});
    const created=result.tasks.at(-1);if(created)onSaved(created.id);
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
   const latest=await api<{item:TaskItem}>('/tasks/'+base.id);setBase(latest.item);setDraft(fields(latest.item));setNotice('顺序已保存');
  }catch(error){setError(error);}finally{setBusy(false);}
 };
 const list=base?.list??lists.find(list=>list.id===listId)??(selection.id===null?selection.list:undefined);
 const conflict=error instanceof ApiError&&error.status===409;
 const disabled=busy||actions.pending.includes(base?.recordId??listId);
 return <div className="tasks-editor" data-task-editor>{confirmation}
  <form className="tasks-editor-form" onSubmit={event=>{event.preventDefault();void save();}}>
   {base&&<h3 className="tasks-editor-heading"><span className="rk-shared-text" {...sharedTitleAttributes('task',base.id)}>{base.title}</span></h3>}
   {Boolean(error)&&(conflict?<Banner status="warning" title="任务列表已被修改" description="你的输入已保留。重新载入最新内容后再修改，避免覆盖其他客户端的更改。"/>:<ErrorText error={error}/>)}
   {conflict&&<Button label="重新载入最新内容" variant="secondary" isDisabled={busy} onClick={()=>void reload()}/>}
   <div className="tasks-editor-fields">
    <TextInput label="任务标题" value={draft.title} onChange={title=>{setDraft(v=>({...v,title:title.slice(0,500)}));setNotice('');}} width="100%" isDisabled={disabled} hasAutoFocus={!base}/>
    <Selector label="任务状态" value={draft.status} onChange={status=>setDraft(v=>({...v,status:status as TaskStatus}))} width="100%" isDisabled={disabled} presentation="adaptive" options={taskStatuses.map(status=>({value:status,label:statusLabels[status],icon:<TaskStatusIcon status={status}/>}))}/>
    {!base&&!fixedRecordId&&<Selector label="所属任务列表" value={listId} onChange={setListId} width="100%" isDisabled={disabled} presentation="adaptive" hasSearch options={[...lists.map(list=>({value:list.id,label:list.name,description:list.path})),{value:'__new__',label:'新建任务列表',icon:<Icon name="plus" size="sm"/>}]}/>}
    {!base&&listId==='__new__'&&<TextInput label="任务列表名称" value={listName} onChange={value=>setListName(value.slice(0,200))} width="100%" isDisabled={disabled||Boolean(createdId.current)}/>}
    <TextArea label="任务详情" value={draft.details} onChange={details=>{setDraft(v=>({...v,details}));setNotice('');}} placeholder="补充目标、背景或验收要求…" width="100%" rows={8} maxLength={50000} isDisabled={disabled}/>
   </div>
   {list&&<div className="tasks-editor-meta"><Link data-task-source to="/records/$recordId" params={{recordId:list.id}}><Icon name="taskList" size="sm"/> {list.name}</Link><span>{list.path}</span>{base&&<span>更新于{ago(base.updatedAt)} · R{base.list.revision}</span>}</div>}
   {base&&<div className="tasks-editor-order"><span>{dirty?'保存更改后可调整顺序':'在同状态的任务中排序'}</span><IconButton label="上移任务" variant="secondary" size="sm" icon={<Icon name="arrowUp" size="sm"/>} isDisabled={disabled||dirty} onClick={()=>void reorder('up')}/><IconButton label="下移任务" variant="secondary" size="sm" icon={<Icon name="arrowDown" size="sm"/>} isDisabled={disabled||dirty} onClick={()=>void reorder('down')}/></div>}
   <div className="tasks-editor-actions">{base?<Button label="删除任务" variant="ghost" size="sm" icon={<Icon name="trash" size="sm"/>} isDisabled={disabled} onClick={()=>void remove()}/>:<span className="muted small">任务创建后可继续编辑详情</span>}
    <Button type="submit" label={base?'保存更改':'创建任务'} variant="primary" size="sm" isLoading={busy} isDisabled={disabled||!draft.title.trim()||Boolean(!base&&listId==='__new__'&&!listName.trim())||(Boolean(base)&&!dirty)}/></div>
   <div className="tasks-editor-notice muted small" role="status">{notice}</div>
  </form>
 </div>;
}
export function TaskEditor({selection,lists,fixedRecordId,actions,guard,onChange}:{selection:TaskSelection|null;lists:TaskList[];fixedRecordId?:string;actions:TaskActions;guard:TaskChangeGuard;onChange:(next:TaskSelection|null)=>void}){
 const retained=useRef(selection);if(selection)retained.current=selection;
 const current=selection??retained.current;
 const q=useQuery({...taskItemQuery(current?.id??''),enabled:Boolean(selection?.id)});
 const expectedRecordId=fixedRecordId??(current?.id?current.recordId:undefined);
 const wrongList=Boolean(q.data&&expectedRecordId&&q.data.item.recordId!==expectedRecordId);
 const requestClose=async()=>{if(!guard.current||await guard.current())onChange(null);};
 return <WorkspacePanel id="task-editor" label="任务详情" title={current?.id===null?'新建任务':'任务详情'} reserveSpace={false} open={Boolean(selection)} onOpenChange={open=>{if(!open)void requestClose();}}>
  {q.isError&&q.data&&<div className="tasks-error"><ErrorText error={q.error}/></div>}
  {current&&(current.id===null?<TaskEditorForm key={'new:'+current.token} active={Boolean(selection)} selection={current} lists={lists} fixedRecordId={fixedRecordId} actions={actions} guard={guard} onSaved={id=>onChange({id})} onRemoved={()=>onChange(null)}/>:q.isPending?<div className="tasks-loading"><Spinner size="sm" label="正在加载任务详情…"/></div>:wrongList?<div className="tasks-error"><Banner status="warning" title="任务不属于当前列表" description="请从对应的任务列表打开这个任务。"/></div>:q.isError&&!q.data?<div className="tasks-error"><ErrorText error={q.error}/><Button label="重试" variant="ghost" onClick={()=>q.refetch()}/></div>:q.data?<TaskEditorForm key={q.data.item.id+':'+current.token} active={Boolean(selection)} item={q.data.item} selection={current} lists={lists} actions={actions} guard={guard} onSaved={id=>onChange({id})} onRemoved={()=>onChange(null)}/>:null)}
 </WorkspacePanel>;
}
