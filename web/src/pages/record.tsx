import '../styles/features/records.css';
import {Icon} from '../icon';
import React,{useEffect,useRef,useState} from 'react';
import {useNavigate,useParams} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {IconButton} from '@astryxdesign/core/IconButton';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {ApiError,api,mutate,queryString} from '../api';
import {ContextPanel} from '../context-panel';
import {RecordRelations} from '../record-relations';
import {useConfirmDialog} from '../confirm-dialog';
import {TopbarPortal} from '../topbar-slot';
import {Breadcrumbs,InlineTitle,PageActions,Properties,Property,TagEditor} from '../page-chrome';
import {rememberPage,forgetPage} from '../recent-pages';
import {revealFolder} from '../page-tree';
import {consumeTitleFocus} from '../create-page';
import {AutoResizer} from '../motion-primitives';
import {RecordEditorChunk} from '../editor-chunks';
import {setFullWidth,useFullWidth} from '../preferences';
import {recordQuery} from '../queries';
import {ErrorText,Swap,ago,statusNames} from './shared';
import {TasksPage} from './tasks';

export function RecordPage(){const {recordId}=useParams({strict:false}) as {recordId:string};const nav=useNavigate();const qc=useQueryClient();const q=useQuery(recordQuery(recordId));const [metaOpen,setMetaOpen]=useState(false),[outlineTarget,setOutlineTarget]=useState<{line:number;token:number}|null>(null),[error,setError]=useState<unknown>(null);
 const [focusTitle]=useState(()=>consumeTitleFocus(recordId));
 const fullWidth=useFullWidth();
 useEffect(()=>{setMetaOpen(false);setOutlineTarget(null);setError(null);},[recordId]);const [archiving,setArchiving]=useState(false);
 const {confirm:askConfirm,confirmation}=useConfirmDialog();
 const outline=useQuery({queryKey:['outline',recordId,q.data?.revision],queryFn:()=>api<{headings:Array<{title:string;level:number;lineStart:number;lineEnd:number}>;totalHeadings:number}>('/records/'+recordId+'/outline?limit=200'),enabled:Boolean(metaOpen&&q.data&&q.data.kind==='document')});
 const item=q.data;
 const lastReveal=useRef<string|null>(null);
 useEffect(()=>{if(!item)return;if(item.status==='archived'){forgetPage(item.id);return;}rememberPage({id:item.id,name:item.name,kind:item.kind,path:item.path});},[item?.id,item?.name,item?.kind,item?.path,item?.status]);
 useEffect(()=>{
  if(!item||item.status==='archived')return;
  // Auto-reveal only on entering a new record/location, not whenever record
  // metadata or a background query refreshes. Respect manual tree collapse.
  const key=item.id+':'+(item.folderId??'');
  if(lastReveal.current===key)return;
  lastReveal.current=key;
  revealFolder(item.folderId);
 },[item?.id,item?.folderId,item?.status]);
 useEffect(()=>{if(q.error instanceof ApiError&&q.error.status===404)forgetPage(recordId);},[q.error,recordId]);
 const refresh=()=>Promise.all([qc.invalidateQueries({queryKey:['record',recordId]}),qc.invalidateQueries({queryKey:['browse']}),qc.invalidateQueries({queryKey:['browse-pages']}),qc.invalidateQueries({queryKey:['archived-records']})]);
 const saveMeta=async(fields:Record<string,unknown>)=>{if(!q.data)return;await mutate('/records/'+recordId+'/meta',{...fields,expectedMetadataRevision:q.data.metadataRevision},'PATCH');await refresh();};
 const updateMeta=async(fields:Record<string,unknown>)=>{setError(null);try{await saveMeta(fields);setMetaOpen(false);}catch(e){setError(e);}};
 const changeTag=async(tag:string,action:'add'|'remove')=>{await mutate('/records/'+recordId+'/tags',{tag,action});await refresh();};
 const archive=async()=>{if(!(await askConfirm({title:'归档此记录？',description:'归档后记录将不再显示在活动文件夹中，但内容和历史版本仍会保留。',actionLabel:'归档记录',destructive:true})))return;setArchiving(true);try{await updateMeta({status:'archived'});}finally{setArchiving(false);}};
 const deleteArchived=async()=>{
  if(!item||item.status!=='archived'||archiving)return;
  setArchiving(true);setError(null);
  try{
   const preview=await api<{revisions:number;incomingWikiReferences:number}>('/records/'+item.id+'/deletion-preview?'+queryString({
    expectedMetadataRevision:item.metadataRevision,expectedRevision:item.revision
   }));
   if(!(await askConfirm({title:'永久删除已归档记录？',
    description:'将永久清除「'+item.name+'」以及全部 '+preview.revisions+
      ' 个正文版本。'+preview.incomingWikiReferences+' 个引用将失去目标，此操作不可撤销。',
    actionLabel:'永久删除',destructive:true})))return;
   await mutate('/records/'+item.id,{expectedMetadataRevision:item.metadataRevision,expectedRevision:item.revision},'DELETE');
   forgetPage(item.id);
   qc.invalidateQueries({queryKey:['archived-records']});
   await nav({to:'/archive'});
  }catch(e){setError(e);}finally{setArchiving(false);}
 };
 if(q.isPending)return <div className="page record-page"><div className="doc-header"><Skeleton width={56} height={56} radius={3}/><div className="doc-skeleton-title"><Skeleton width="55%" height={40} radius={2}/></div><Skeleton width="38%" height={14} radius={1}/></div></div>;
 if(q.isError||!item)return <div className="page"><ErrorText error={q.error}/></div>;
 const pageActions=<>
  <IconButton variant="ghost" size="sm" label="详情与关联" icon={<Icon name="layoutSidebarRightExpand" size="sm"/>} onClick={()=>setMetaOpen(v=>!v)}/>
  <MoreMenu size="sm" variant="ghost" label="更多操作" items={[
   {label:'复制页面链接',icon:<Icon name="copy" size="sm"/>,onClick:()=>void navigator.clipboard?.writeText(location.origin+'/records/'+item.id)},
   {label:fullWidth?'恢复标准宽度':'全宽显示',icon:<Icon name="arrowsHorizontal" size="sm"/>,onClick:()=>setFullWidth(!fullWidth)},
   {label:'查看关系网',icon:<Icon name="relationGraph" size="sm"/>,onClick:()=>void nav({to:'/graph',search:{focus:item.id}})},
   {type:'divider'},
   {label:'归档记录',icon:<Icon name="archive" size="sm"/>,variant:'destructive',isDisabled:archiving||item.status==='archived',onClick:()=>void archive()},
   ...(item.status==='archived'?[{label:'永久删除归档记录',icon:<Icon name="trash" size="sm"/>,variant:'destructive' as const,isDisabled:archiving,onClick:()=>void deleteArchived()}]:[])
  ]}/>
 </>;
 return <div className="page record-page">{confirmation}
 <TopbarPortal slot="start"><Breadcrumbs folderId={item.folderId} current={item.name}/></TopbarPortal>
 <AutoResizer>{item.status==='archived'&&<div className="doc-notice"><Banner status="warning" container="section" title="此记录已归档" description="归档的记录不会显示在侧边栏中，内容和历史版本仍完整保留。" endContent={<Button label="恢复为正常" size="sm" variant="secondary" onClick={()=>void updateMeta({status:'active'})}/>}/></div>}</AutoResizer>
 <header className="doc-header">
  <div className="page-icon" aria-hidden="true">{item.kind==='task_list'?<Icon name="taskList" inline/>:<Icon name="document" inline/>}</div>
  <InlineTitle value={item.name} onRename={next=>saveMeta({name:next})} autoFocus={focusTitle}/>
  <Properties>
   <Property label="类型">{item.kind==='task_list'?'任务列表':'Markdown 文档'}</Property>
   <Property label="标签"><TagEditor tags={item.tags??[]} onChange={changeTag}/></Property>
   <Property label="更新时间"><span title={item.updatedAt}>{ago(item.updatedAt)||'—'}</span></Property>
   {item.status!=='active'&&<Property label="状态">{statusNames[item.status??'']??item.status}</Property>}
  </Properties>
 </header>
 <AutoResizer>{Boolean(error)&&<div className="doc-notice"><ErrorText error={error}/></div>}</AutoResizer>
 <div className="record-layout"><div className="record-main">{item.kind==='task_list'?<><PageActions>{pageActions}</PageActions><TasksPage recordId={recordId}/></>:<React.Suspense fallback={<div className="editor-pending" aria-busy="true"/>}><RecordEditorChunk key={recordId+'@'+item.revision} item={item} jumpToLine={outlineTarget} pageActions={pageActions} onSaved={()=>void refresh()}/></React.Suspense>}</div>
 <ContextPanel open={metaOpen} onOpenChange={setMetaOpen} label="记录信息"><div className="record-inspector"><div className="panel-heading"><h2>记录信息</h2><IconButton variant="ghost" label="关闭" icon={<span aria-hidden="true">×</span>} onClick={()=>setMetaOpen(false)}/></div>
  <dl><dt>记录类型</dt><dd>{item.kind==='document'?'Markdown 文档':item.kind==='task_list'?'任务列表':item.kind}</dd><dt>内容版本</dt><dd>Revision {item.revision}</dd><dt>状态</dt><dd>{statusNames[item.status??'']??item.status}</dd><dt>路径</dt><dd className="break-word">{item.path}</dd><dt>行数</dt><dd>{item.totalLines}</dd></dl>
  {item.kind==='document'&&<div className="outline-panel"><h3>文档大纲</h3><Swap state={outline.isPending?'loading':outline.isError?'error':'ready'}>{outline.isPending?<p className="muted small">加载大纲…</p>:outline.isError?<p className="muted small">大纲暂不可用</p>:outline.data?.headings.length?<div className="outline-items">{outline.data.headings.map((h,i)=><div className="outline-indent" key={i} style={{paddingInlineStart:(h.level-1)*12}}><Button className="outline-item" variant="ghost" size="sm" width="100%" label={h.title} tooltip={'第 '+h.lineStart+' 行至第 '+h.lineEnd+' 行'} endContent={<small>L{h.lineStart}</small>} onClick={()=>{setOutlineTarget(prev=>({line:h.lineStart,token:(prev?.token??0)+1}));setMetaOpen(false);}}/></div>)}{outline.data.totalHeadings>outline.data.headings.length&&<p className="muted small">仅显示前 200 个标题</p>}</div>:<p className="muted small">暂无 Markdown 标题</p>}</Swap></div>}
  {metaOpen&&<RecordRelations recordId={recordId} onNavigate={()=>setMetaOpen(false)}/>}
 </div></ContextPanel></div></div>;
}
