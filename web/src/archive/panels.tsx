import {lazy,Suspense,useEffect,useState} from 'react';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {WorkspacePanel} from '../workspace-panels';
import {SettingsPropertyTable} from '../settings-property-table';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {ApiError,api,queryString} from '../api';
import type {ArchivedRecord} from '../queries';
import type {Paged,RecordDetail,Task} from '../types';
import {statusLabels} from '../tasks/data';
import {ErrorText,Loading,fmt} from '../pages/shared';
import type {ArchiveResult,RestoreTarget} from './actions';

const MarkdownPreview=lazy(()=>import('../markdown-preview'));
// Large archived records use the same ranged read contract as other clients.
// Pin subsequent ranges to the first response's revision to keep one snapshot.
async function readPreview(id:string,revision:number,signal:AbortSignal):Promise<RecordDetail>{
 const path='/records/'+id;
 try{return await api<RecordDetail>(path+'?'+queryString({revision}),{signal});}
 catch(error){if(!(error instanceof ApiError)||error.code!=='READ_REQUIRES_RANGE')throw error;}
 type Range=RecordDetail&{returnedLines:number;truncated:boolean};
 const first=await api<Range>(path+'?'+queryString({revision,lineStart:1,maxLines:2000}),{signal});
 const parts=[first.content];
 let next=first.returnedLines+1,more=first.truncated;
 while(more){
  const page=await api<Range>(path+'?'+queryString({revision:first.revision,lineStart:next,maxLines:2000}),{signal});
  parts.push(page.content);next+=page.returnedLines;more=page.truncated;
 }
 return {...first,content:parts.join('\n')};
}
export type ArchivePanelSession={item:ArchivedRecord;open:boolean;activation:number};
export function originalFolder(item:ArchivedRecord){
 const path=item.archivedFromPath;
 return path?path.slice(0,path.lastIndexOf('/'))||'/':'原位置未知';
}
function TaskSummary({content}:{content:string}){
 let tasks:Task[];
 try{tasks=(JSON.parse(content) as {tasks:Task[]}).tasks;if(!Array.isArray(tasks))throw Error();}
 catch{return <p className="muted">无法读取任务内容，请打开完整页面查看。</p>;}
 return <section className="archive-task-summary"><h3>{tasks.length} 项任务 · {tasks.filter(task=>task.status==='done').length} 项已完成</h3>
  {tasks.map(task=><div key={task.id}><span className="muted small">{statusLabels[task.status]??task.status}</span><strong>{task.title}</strong>{task.details&&<p className="muted small">{task.details}</p>}</div>)}
 </section>;
}
export function ArchivePreview({session,onClose,onRemove,onRestore,busy}:{session:ArchivePanelSession;onClose:()=>void;onRemove:()=>void;onRestore:(item:ArchivedRecord)=>void;busy:boolean}){
 const {item}=session;
 const query=useQuery({queryKey:['archive-preview',item.id,item.revision],queryFn:({signal})=>readPreview(item.id,item.revision,signal),enabled:session.open});
 return <WorkspacePanel id={'archive-preview-'+item.id} title="归档预览" label={'归档预览：'+item.name} description={item.name} reserveSpace={false} open={session.open} activationKey={session.activation} onOpenChange={open=>{if(!open)onClose();}} onAfterClose={onRemove}>
  <div className="archive-panel-body"><div className="archive-panel-actions"><Link to="/records/$recordId" params={{recordId:item.id}}>打开完整页面</Link><Button size="sm" variant="secondary" label="恢复到…" isDisabled={busy} onClick={()=>onRestore(item)}/></div>
   <SettingsPropertyTable label="归档信息" rows={[{label:'原位置',value:originalFolder(item),transitionKey:originalFolder(item)},{label:'归档时间',value:fmt(item.archivedAt??undefined),transitionKey:item.archivedAt??''},{label:'内容版本',value:'R'+item.revision,transitionKey:String(item.revision)}]}/>
   <AutoResizer><AutoTransition transitionKey={query.isPending?'loading':query.isError?'error':String(query.data?.revision)}>
    {query.isPending?<Loading/>:query.isError?<div><ErrorText error={query.error}/><Button label="重新加载预览" variant="ghost" onClick={()=>void query.refetch()}/></div>:query.data?<Suspense fallback={<Loading/>}>{item.kind==='task_list'?<TaskSummary content={query.data.content}/>:<MarkdownPreview content={query.data.content} sourceId={item.id} idScope={'archive-'+item.id+'-'}/>}</Suspense>:null}
   </AutoTransition></AutoResizer>
  </div>
 </WorkspacePanel>;
}

export function ArchiveRestore({items,open,onClose,onRemove,onRestore,busy,results}:{items:ArchivedRecord[];open:boolean;onClose:()=>void;onRemove:()=>void;onRestore:(target:RestoreTarget)=>Promise<boolean>;busy:boolean;results:ArchiveResult[]}){
 const [folder,setFolder]=useState('original'),[name,setName]=useState(items[0]?.name??'');
 const apply=()=>onRestore({
  ...(folder==='original'?{}:{folderId:folder==='root'?null:folder}),
  ...(items.length===1?{name:name.trim()}:{})
 });
 const folders=useInfiniteQuery({queryKey:['activity-folders'],enabled:open,initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>api<Paged<{id:string;path:string}>>('/activity/folders?'+queryString({cursor:pageParam}),{signal}),getNextPageParam:page=>page.page.hasMore?String(page.page.nextCursor):undefined,staleTime:60_000});
 useEffect(()=>{if(open&&folders.hasNextPage&&!folders.isFetchingNextPage&&!folders.isFetchNextPageError)void folders.fetchNextPage();},[open,folders.hasNextPage,folders.isFetchingNextPage,folders.isFetchNextPageError,folders.fetchNextPage]);
 return <WorkspacePanel id="archive-restore" title="恢复归档" label="恢复归档" description={items.length===1?items[0].name:'已选 '+items.length+' 项'} open={open} reserveSpace={false} onOpenChange={value=>{if(!value&&!busy)onClose();}} onAfterClose={onRemove}>
  <div className="archive-panel-body"><p className="muted small">选择目标位置。原位置失效或存在同名内容时，可以更换文件夹{items.length===1?'或修改名称':''}。</p>
   <Selector label="恢复位置" value={folder} onChange={setFolder} width="100%" hasSearch isDisabled={busy} presentation="adaptive" options={[
    {value:'original',label:items.length===1?'原位置':'各自的原位置'},{value:'root',label:'知识库根目录'},...(folders.data?.pages.flatMap(page=>page.items)??[]).map(item=>({value:item.id,label:item.path}))
   ]}/>
   {folders.isError&&<div><ErrorText error={folders.error}/><Button label="重新加载文件夹" size="sm" variant="ghost" onClick={()=>void folders.refetch()}/></div>}
   {folders.isFetchNextPageError&&<Button label="继续加载文件夹" size="sm" variant="ghost" onClick={()=>void folders.fetchNextPage()}/>}
   {items.length===1&&<TextInput label="名称" value={name} onChange={setName} width="100%" isDisabled={busy}/>}
   <AutoResizer><AutoTransition transitionKey={results.map(item=>item.id+item.error).join('|')}><div role="status">{results.filter(item=>item.error).map(item=><p key={item.id} className="archive-result-error">{item.name} · {item.error}</p>)}</div></AutoTransition></AutoResizer>
   <Button label={'恢复'+(items.length>1?' '+items.length+' 项':'')} variant="primary" isLoading={busy} isDisabled={items.length===1&&!name.trim()} onClick={()=>void apply()}/>
  </div>
 </WorkspacePanel>;
}
