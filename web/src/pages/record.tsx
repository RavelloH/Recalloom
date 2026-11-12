import '../styles/features/records.css';
import {Icon} from '../icon';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate,useParams} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {IconButton} from '@astryxdesign/core/IconButton';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {ApiError,api,mutate,queryString} from '../api';
import {ContextPanel} from '../context-panel';
import {DocumentWorkbenchHeader,DocumentWorkbenchInspector,type DocumentInspectorTab,type DocumentPresentation} from '../record-workbench';
import {markdownCharacterCount} from '../document-heading';
import {filenameFromDocumentTitle} from '../document-filename';
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
import {sharedViewTransitionName} from '../shared-view-transition';
import {ErrorText,ago,statusNames} from './shared';
import {TasksPage} from './tasks';

export function RecordPage(){const {recordId}=useParams({strict:false}) as {recordId:string};const nav=useNavigate();const qc=useQueryClient();const q=useQuery(recordQuery(recordId));const [metaOpen,setMetaOpen]=useState(false),[inspectorTab,setInspectorTab]=useState<DocumentInspectorTab|null>(null),[historyTarget,setHistoryTarget]=useState<HTMLDivElement|null>(null),[outlineTarget,setOutlineTarget]=useState<{line:number;token:number}|null>(null),[error,setError]=useState<unknown>(null);
 const sharedRecordName=sharedViewTransitionName('record',recordId);
 const [documentPresentation,setDocumentPresentation]=useState<DocumentPresentation|null>(null);
 const updatePresentation=useCallback((next:DocumentPresentation)=>setDocumentPresentation(prev=>
  prev&&prev.id===next.id&&prev.revision===next.revision&&prev.characters===next.characters?prev:next),[]);
 const lastInspectorTab=useRef<DocumentInspectorTab>('details');
 const openInspector=(tab:DocumentInspectorTab)=>{lastInspectorTab.current=tab;setInspectorTab(tab);};
 const [focusTitle]=useState(()=>consumeTitleFocus(recordId));
 const fullWidth=useFullWidth();
 useEffect(()=>{setMetaOpen(false);lastInspectorTab.current='details';setInspectorTab(null);setOutlineTarget(null);setError(null);},[recordId]);const [archiving,setArchiving]=useState(false);
 const {confirm:askConfirm,confirmation}=useConfirmDialog();
 const outline=useQuery({queryKey:['outline',recordId,q.data?.revision],queryFn:()=>api<{headings:Array<{title:string;level:number;lineStart:number;lineEnd:number}>;totalHeadings:number}>('/records/'+recordId+'/outline?limit=200'),enabled:Boolean(inspectorTab==='outline'&&q.data&&q.data.kind==='document')});
 const item=q.data;
 const originalPresentation=useMemo(()=>item?.kind==='document'?{
  id:item.id,revision:item.revision,characters:markdownCharacterCount(item.content)
 }:null,[item?.id,item?.kind,item?.revision,item?.content]);
 const currentPresentation=item?.kind==='document'&&documentPresentation?.id===item.id&&documentPresentation.revision===item.revision
  ?documentPresentation:originalPresentation;
 const editorsQuery=useQuery({queryKey:['record-editors',recordId,item?.revision],
  queryFn:()=>api<{items:string[]}>('/records/'+recordId+'/editors'),enabled:item?.kind==='document'});
 const editorNames=editorsQuery.data?.items??[];
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
  <IconButton variant="ghost" size="sm" label="详情与关联" icon={<Icon name="layoutSidebarRightExpand" size="sm"/>} onClick={()=>item.kind==='document'?openInspector('details'):setMetaOpen(v=>!v)}/>
  <MoreMenu size="sm" variant="ghost" label="更多操作" items={[
   {label:'复制页面链接',icon:<Icon name="copy" size="sm"/>,onClick:()=>void navigator.clipboard?.writeText(location.origin+'/records/'+item.id)},
   {label:fullWidth?'恢复标准宽度':'全宽显示',icon:<Icon name="arrowsHorizontal" size="sm"/>,onClick:()=>setFullWidth(!fullWidth)},
   {label:'查看关系网',icon:<Icon name="relationGraph" size="sm"/>,onClick:()=>void nav({to:'/graph',search:{focus:item.id}})},
   {type:'divider'},
   {label:'归档记录',icon:<Icon name="archive" size="sm"/>,variant:'destructive',isDisabled:archiving||item.status==='archived',onClick:()=>void archive()},
   ...(item.status==='archived'?[{label:'永久删除归档记录',icon:<Icon name="trash" size="sm"/>,variant:'destructive' as const,isDisabled:archiving,onClick:()=>void deleteArchived()}]:[])
  ]}/>
 </>;
 return <div className={'page record-page'+(item.kind==='document'?' workbench-document':'')}>{confirmation}
 <TopbarPortal slot="start"><Breadcrumbs folderId={item.folderId} current={item.name}/></TopbarPortal>
 <AutoResizer>{item.status==='archived'&&<div className="doc-notice"><Banner status="warning" container="section" title="此记录已归档" description="归档的记录不会显示在侧边栏中，内容和历史版本仍完整保留。" endContent={<Button label="恢复为正常" size="sm" variant="secondary" onClick={()=>void updateMeta({status:'active'})}/>}/></div>}</AutoResizer>
 {item.kind==='document'
  ?<DocumentWorkbenchHeader item={item} focusTitle={focusTitle}
    characters={currentPresentation?.characters??0} editors={editorsQuery.isSuccess?editorNames:null}
    onRename={next=>saveMeta({name:filenameFromDocumentTitle(item.name,next)})}
    onDetails={()=>openInspector('details')}/>
  :<header className="doc-header">
    <div className="page-icon" aria-hidden="true"><Icon name="taskList" inline/></div>
    <InlineTitle value={item.name} onRename={next=>saveMeta({name:next})} autoFocus={focusTitle} transitionName={sharedRecordName}/>
    <Properties>
     <Property label="类型">任务列表</Property>
     <Property label="标签"><TagEditor tags={item.tags??[]} onChange={changeTag}/></Property>
     <Property label="更新时间"><span title={item.updatedAt}>{ago(item.updatedAt)||'—'}</span></Property>
     {item.status!=='active'&&<Property label="状态">{statusNames[item.status??'']??item.status}</Property>}
    </Properties>
   </header>}
 <AutoResizer>{Boolean(error)&&<div className="doc-notice"><ErrorText error={error}/></div>}</AutoResizer>
 <div className="record-layout"><div className="record-main">{item.kind==='task_list'?<><PageActions>{pageActions}</PageActions><TasksPage recordId={recordId}/></>:<React.Suspense fallback={<div className="editor-pending" aria-busy="true"/>}><RecordEditorChunk key={recordId+'@'+item.revision} item={item} jumpToLine={outlineTarget}
  pageActions={pageActions} onSaved={()=>{void refresh();}} onOpenHistory={()=>openInspector('history')} historyTarget={historyTarget}
  onDocumentPresentation={updatePresentation}/></React.Suspense>}</div>
 {item.kind==='task_list'&&<ContextPanel open={metaOpen} onOpenChange={setMetaOpen} label="记录信息"><div className="record-inspector"><div className="panel-heading"><h2>记录信息</h2><IconButton variant="ghost" label="关闭" icon={<span aria-hidden="true">×</span>} onClick={()=>setMetaOpen(false)}/></div>
  <dl><dt>记录类型</dt><dd>任务列表</dd><dt>内容版本</dt><dd>Revision {item.revision}</dd><dt>状态</dt><dd>{statusNames[item.status??'']??item.status}</dd><dt>路径</dt><dd className="break-word">{item.path}</dd><dt>行数</dt><dd>{item.totalLines}</dd></dl>
 </div></ContextPanel>}
 {item.kind==='document'&&<DocumentWorkbenchInspector open={inspectorTab!==null} tab={inspectorTab??lastInspectorTab.current}
  onChangeTab={openInspector} onClose={()=>setInspectorTab(null)} item={item} outline={outline}
  onJump={line=>{setOutlineTarget(prev=>({line,token:(prev?.token??0)+1}));setInspectorTab(null);}}
  onChangeTag={changeTag}
  characters={currentPresentation?.characters??0} editors={editorNames}
  onHistoryTarget={setHistoryTarget}/>}
 </div></div>;
}
