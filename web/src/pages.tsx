import React,{useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useParams,useLocation,useSearch} from '@tanstack/react-router';
import {useQuery,useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Banner} from '@astryxdesign/core/Banner';
import {Heading} from '@astryxdesign/core/Heading';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {IconButton} from '@astryxdesign/core/IconButton';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {Selector} from '@astryxdesign/core/Selector';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {FileText,Folder,FolderPlus,Plus,Search,RefreshCw,Archive,Clock,Shield,Settings,Database,Tag,ListTodo,FolderOpen,Lock,Library,PanelRight,Copy,Shapes,CircleDot,MoveHorizontal,Command,Network} from 'lucide-react';
import {ApiError,api,mutate,sessions,queryString} from './api';
import type {Task} from './types';
import {useAppearance} from './theme';
import {ActivityEntry} from './activity-entry';
import {ContextPanel} from './context-panel';
import {RecordRelations} from './record-relations';
import {SearchHighlight} from './search-highlight';
import {useConfirmDialog} from './confirm-dialog';
import {TopbarPortal} from './topbar-slot';
import {Breadcrumbs,InlineTitle,PageActions,Properties,Property,TagEditor} from './page-chrome';
import {rememberPage,forgetPage,useRecentPages} from './recent-pages';
import {revealFolder} from './page-tree';
import {createUntitled,consumeTitleFocus} from './create-page';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {RecordEditorChunk} from './editor-chunks';
import {setFullWidth,useFullWidth} from './preferences';
import {activityPagesQuery,activityQuery,folderPagesQuery,folderQuery,recordQuery,archivedRecordsQuery,searchModes,searchQuery,tasksQuery,type SearchMode} from './queries';

export function PageTitle({title,description,actions}:{title:string;description?:string;actions?:React.ReactNode}){return <header className="page-header"><div className="page-title-copy"><Heading level={1}>{title}</Heading>{description&&<p className="muted">{description}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</header>;}
const ErrorText=({error}:{error:unknown})=><Banner status="error" container="section" title="操作失败" description={error instanceof ApiError?error.code==='FOLDER_NOT_EMPTY'?'文件夹中仍有文档、归档记录或子文件夹，请先处理这些内容。':error.status===409?'内容已被其他客户端修改，请刷新后重试。':error.message:error instanceof Error?error.message:'操作失败'}/>;
const Loading=()=> <div className="content-loading" role="status"><Spinner size="md" shade="subtle" label="正在加载…"/></div>;
type SkeletonKind='files'|'tasks'|'activity'|'compact';
const LoadingRows=({count=4,kind='files'}:{count?:number;kind?:SkeletonKind})=><div className={'loading-rows skeleton-'+kind} role="status" aria-label="正在加载内容">
 {Array.from({length:count},(_,i)=>kind==='files'?
  <div className="file-row" key={i}><span className="skeleton-name"><Skeleton width={18} height={18} radius={1}/><Skeleton width={i%2?'49%':'72%'} height={14} radius={1}/></span><span><Skeleton width={40} height={12} radius={1}/></span><span><Skeleton width={76} height={12} radius={1}/></span></div>:
  kind==='tasks'?
  <div className="task-item" key={i}><div className="task-heading"><Skeleton width={22} height={22} radius={1}/><Skeleton width={i%2?'68%':'82%'} height={15} radius={1}/><Skeleton width={22} height={12} radius={1}/></div><div className="task-details"><Skeleton width="92%" height={12} radius={1}/><Skeleton width="65%" height={12} radius={1}/></div><div className="task-footer"><Skeleton width={80} height={12} radius={1}/><Skeleton width={118} height={34} radius={2}/></div></div>:
  kind==='activity'?
  <div className="recent-entry" key={i}><Skeleton width={15} height={15} radius={1}/><div className="loading-lines"><Skeleton width={i%2?'65%':'85%'} height={14} radius={1}/><Skeleton width="30%" height={11} radius={1}/></div><Skeleton width={58} height={11} radius={1}/></div>:
  <div className="compact-row" key={i}><Skeleton width={8} height={8} radius={2}/><Skeleton width={i%2?'62%':'80%'} height={14} radius={1}/><Skeleton width={24} height={11} radius={1}/></div>)}</div>;
const Empty=({title,description}:{title:string;description?:string})=><EmptyState className="knowledge-empty" title={title} description={description} icon={<FileText size={24}/>} isCompact/>;
const fmt=(v?:string|number)=>{if(v===undefined||v===null)return '—';const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(n):String(v)};
/** Swaps between loading / error / empty / ready without a jump: content cross-fades while the box eases to its new height. */
function Swap({state,children,className}:{state:string;children:React.ReactNode;className?:string}){
 return <AutoResizer className={className}><AutoTransition transitionKey={state}>{children}</AutoTransition></AutoResizer>;
}
const stateOf=(q:{isPending:boolean;isError:boolean},empty:boolean)=>q.isPending?'loading':q.isError?'error':empty?'empty':'ready';
export function LoginPage(){const [secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(0);const navigate=useNavigate(),qc=useQueryClient();
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!secret)return;setBusy(true);setError('');setProgress(0);try{
  const {default:Cap}=await import('cap-widget');
  const widget=new Cap({apiEndpoint:'/api/auth/cap/'});widget.addEventListener('progress',e=>setProgress(Math.round(e.detail.progress)));
  const proof=await widget.solve();if(!proof.success||!proof.token)throw new Error('无法完成人机验证，请重试。');
  await mutate('/auth/login',{secret,capToken:proof.token});setSecret('');await qc.invalidateQueries({queryKey:['auth-session']});navigate({to:'/'});
 }catch(e){setError(e instanceof Error?e.message:'登录失败');}finally{setBusy(false);}};
 return <div className="login-page"><Card className="login-panel" padding={6}><div className="login-logo">R</div><h1>登录 Recalloom</h1><p className="muted">使用现有 OAuth 授权密钥访问管理控制台。</p><form onSubmit={submit} className="login-form"><TextInput label="授权密钥" type="password" value={secret} onChange={setSecret} isRequired autoComplete="off" placeholder="输入 MCP_AUTH_SECRET"/>{error&&<Banner status="error" container="section" title="登录失败" description={error}/>}<Button label={busy?'验证中…':'登录'} variant="primary" type="submit" width="100%" isDisabled={!secret||busy} isLoading={busy}/>{busy&&<p className="muted small">人机验证 {progress?progress+'%':'进行中'}，请勿关闭页面。</p>}</form><p className="login-foot"><Shield size={14}/>密钥仅用于登录，不会保存在浏览器中。登录后通过安全会话访问 API。</p></Card></div>;
}

const ago=(value?:number|string)=>{
 const time=typeof value==='number'?value:value?Date.parse(value):NaN;
 if(!Number.isFinite(time))return '';
 const minutes=Math.round((time-Date.now())/60000);
 const format=new Intl.RelativeTimeFormat('zh-CN',{numeric:'auto'});
 if(Math.abs(minutes)<1)return '刚刚';
 if(Math.abs(minutes)<60)return format.format(minutes,'minute');
 if(Math.abs(minutes)<60*24)return format.format(Math.round(minutes/60),'hour');
 if(Math.abs(minutes)<60*24*7)return format.format(Math.round(minutes/1440),'day');
 return fmt(time);
};
const greeting=()=>{const hour=new Date().getHours();return hour<5?'夜深了':hour<11?'早上好':hour<13?'中午好':hour<18?'下午好':'晚上好';};
const statusNames:Record<string,string>={draft:'草稿',active:'正常',completed:'已完成',superseded:'已取代',archived:'已归档'};

export function HomePage(){const {data:todo,isPending,isError}=useQuery(tasksQuery());const events=useQuery(activityQuery());const recent=useRecentPages();const active=todo?.items.filter(t=>!['done','cancelled'].includes(t.status))??[];
 const shortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ K':'Ctrl K';
 return <div className="page home-page"><PageTitle title="概览" description={greeting()+'。从最近的页面继续，或查看待办与近期变化。'}/>
 <section className="home-section" aria-labelledby="home-recent"><h2 id="home-recent" className="section-heading"><Clock size={14}/>最近访问</h2>
  {recent.length?<div className="recent-pages">{recent.slice(0,8).map(page=><Link key={page.id} to="/records/$recordId" params={{recordId:page.id}} className="recent-page"><span className="recent-page-cover" aria-hidden="true"/><span className="recent-page-icon" aria-hidden="true">{page.kind==='task_list'?<ListTodo size={20}/>:<FileText size={20}/>}</span><strong className="recent-page-name">{page.name}</strong><small className="recent-page-meta truncate">{ago(page.visitedAt)}</small></Link>)}</div>
  :<div className="recent-empty"><p className="muted small">最近打开的页面会显示在这里。按 <kbd>{shortcut}</kbd> 可随时搜索。</p><Link to="/library" className="small text-link">浏览知识库</Link></div>}
 </section>
 <div className="dashboard-grid">
  <section className="home-card"><div className="panel-heading"><h2>未完成事项</h2><Link to="/tasks">查看全部</Link></div>
   <Swap state={stateOf({isPending,isError},!active.length)}>{isPending?<LoadingRows kind="compact" count={5}/>:active.length?active.slice(0,5).map(t=><div className="compact-row" key={t.id}><span className={'status-dot '+t.status}/><Link to="/records/$recordId" params={{recordId:t.recordId}}>{t.title}</Link><span className="muted tiny">P{t.priority}</span></div>):<Empty title="暂无待办" description="在任务列表中创建后会显示在这里。"/>}</Swap></section>
  <section className="home-card"><div className="panel-heading"><h2>最近活动</h2><Link to="/activity">查看全部</Link></div>
   <Swap state={stateOf(events,!events.data?.items?.length)}>{events.isPending?<LoadingRows kind="activity" count={5}/>:events.data?.items?.length?events.data.items.slice(0,5).map(e=><ActivityEntry key={e.seq} item={e} compact/>):<Empty title="暂无活动"/>}</Swap></section>
 </div></div>;
}

export function LibraryPage(){const params=useParams({strict:false});const folderId=(params as {folderId?:string}).folderId||null;const qc=useQueryClient(),nav=useNavigate();const [creating,setCreating]=useState<'folder'|'document'|'checkpoint_template'|'task_list'|null>(null),[name,setName]=useState(''),[tagInput,setTagInput]=useState(''),[error,setError]=useState<unknown>(null),[quickBusy,setQuickBusy]=useState(false),[deletingFolder,setDeletingFolder]=useState(false);
 const {confirm:askConfirm,confirmation}=useConfirmDialog();
 const [focusTitle]=useState(()=>folderId?consumeTitleFocus(folderId):false);
 useEffect(()=>{setCreating(null);},[folderId]);
 const q=useInfiniteQuery(folderPagesQuery(folderId));
 const entries=q.data?.pages.flatMap(page=>page.items)??[];
 const currentFolder=useQuery({...folderQuery(folderId??''),enabled:Boolean(folderId)});
 useEffect(()=>{revealFolder(currentFolder.data?.parentId);},[currentFolder.data?.parentId]);
 const renameFolder=async(next:string)=>{const folder=currentFolder.data;if(!folder)return;await mutate('/folders/'+folder.id,{name:next,expectedMetadataRevision:folder.metadataRevision},'PATCH');await Promise.all([qc.invalidateQueries({queryKey:['folder',folder.id]}),qc.invalidateQueries({queryKey:['folder-trail']}),qc.invalidateQueries({queryKey:['browse']})]);};
 const create=async()=>{if(!name.trim()||!creating)return;try{
  const isTemplate=creating==='checkpoint_template';
  const tags=[...new Set([...tagInput.split(/[,，]/).map(t=>t.trim().toLowerCase()).filter(Boolean),...(isTemplate?['checkpoint']:[])])];
  const data=creating==='folder'
    ?await mutate<{id:string}>('/folders',{name:name.trim(),parentId:folderId})
    :await mutate<{id:string}>('/records',{name:name.trim(),kind:creating==='task_list'?'task_list':'document',folderId,tags,
      ...(isTemplate?{content:'# '+name.trim()+'\n\n## 概述\n\n## 已完成\n\n## 待跟进\n\n## 验证与参考\n'}:{})});
  setName('');setTagInput('');setCreating(null);qc.invalidateQueries({queryKey:['browse']});qc.invalidateQueries({queryKey:['browse-pages']});if(creating!=='folder')nav({to:'/records/$recordId',params:{recordId:data.id}});
 }catch(e){setError(e);}};
 const quickCreate=async()=>{if(quickBusy)return;setQuickBusy(true);setError(null);try{const id=await createUntitled(qc,'document',folderId);revealFolder(folderId);await nav({to:'/records/$recordId',params:{recordId:id}});}catch(e){setError(e);}finally{setQuickBusy(false);}};
 const deleteFolder=async()=>{
  const current=currentFolder.data;
  if(!folderId||!current||deletingFolder)return;
  if(!(await askConfirm({title:'永久删除空文件夹？',description:'将删除「'+current.name+'」这个目录，但不会删除任何文档或子文件夹。只要仍有子项（包括归档记录），服务器就会拒绝删除。',actionLabel:'删除空文件夹',destructive:true})))return;
  setDeletingFolder(true);setError(null);
  try{
   await mutate('/folders/'+folderId,{expectedMetadataRevision:current.metadataRevision,expectedName:current.name},'DELETE');
   await Promise.all([qc.invalidateQueries({queryKey:['browse']}),qc.invalidateQueries({queryKey:['browse-pages']}),qc.invalidateQueries({queryKey:['folder-trail']})]);
   if(current.parentId)await nav({to:'/library/$folderId',params:{folderId:current.parentId}});
   else await nav({to:'/library'});
  }catch(e){setError(e);}finally{setDeletingFolder(false);}
 };
 const title=folderId?currentFolder.data?.name??'':'知识库';
 const subtitle=folderId?currentFolder.data?.description:'文件夹、Markdown 文档和结构化任务';
 return <div className="page folder-page">{confirmation}
 <TopbarPortal slot="start"><Breadcrumbs folderId={currentFolder.data?.parentId} current={folderId?title||'…':undefined}/></TopbarPortal>
 <header className="doc-header">
  <div className="page-icon" aria-hidden="true">{folderId?<FolderOpen size={34} strokeWidth={1.6}/>:<Library size={34} strokeWidth={1.6}/>}</div>
  {folderId&&currentFolder.isPending?<Skeleton width="45%" height={40} radius={2}/>:currentFolder.isError?<ErrorText error={currentFolder.error}/>:<InlineTitle value={title} onRename={folderId?renameFolder:undefined} autoFocus={focusTitle}/>}
  {subtitle&&<p className="page-subtitle">{subtitle}</p>}
  <div className="doc-header-actions"><Button label="新建文件夹" icon={<FolderPlus size={15}/>} variant="ghost" size="sm" onClick={()=>setCreating('folder')}/><Button label="新建记录" icon={<Plus size={15}/>} variant="secondary" size="sm" onClick={()=>setCreating('document')}/>{folderId&&<Button label="删除空文件夹" variant="ghost" size="sm" isDisabled={deletingFolder||currentFolder.isPending} isLoading={deletingFolder} onClick={()=>void deleteFolder()}/>}</div>
 </header>
 <AutoResizer><AutoTransition transitionKey={creating?'form':'none'} type="slideUp">{creating&&<Card className="inline-form create-surface" padding={4}><form className="create-form" onSubmit={e=>{e.preventDefault();void create();}}><div className="create-fields"><div className="inline-selector"><Selector label="类型" size="md" width="100%" value={creating} options={[{value:'folder',label:'文件夹'},{value:'document',label:'文档'},{value:'checkpoint_template',label:'阶段总结（文档模板）'},{value:'task_list',label:'任务列表'}]} onChange={value=>setCreating(value as typeof creating)}/></div><div className="inline-field"><TextInput label="名称" hasAutoFocus width="100%" placeholder="名称" value={name} onChange={setName} onEnter={create} onKeyDown={e=>{if(e.key==='Escape')setCreating(null);}}/></div>{creating!=='folder'&&<div className="inline-field"><TextInput label="标签" width="100%" placeholder="标签（逗号分隔，可选）" value={tagInput} onChange={setTagInput}/></div>}</div><div className="create-actions"><Button type="submit" label="创建" variant="primary" isDisabled={!name.trim()}/><Button label="取消" onClick={()=>setCreating(null)}/></div></form></Card>}</AutoTransition></AutoResizer>
 <AutoResizer>{Boolean(error)&&<div className="doc-notice"><ErrorText error={error}/></div>}</AutoResizer>
 {!folderId&&<div className="library-archive-link"><Link to="/archive" className="text-link"><Archive size={15}/>查看归档内容</Link></div>}
 <div className="file-table"><div className="file-table-head"><span>名称</span><span>类型</span><span>最近修改</span></div>
  <Swap state={stateOf(q,!entries.length)}>{q.isPending?<LoadingRows kind="files" count={5}/>:q.isError?<ErrorText error={q.error}/>:entries.length?entries.map(item=>item.entityType==='folder'?<Link to="/library/$folderId" params={{folderId:item.id}} className="file-row" key={item.id}><span><Folder size={17}/><span className="truncate">{item.name}</span></span><span>文件夹</span><span>{fmt(item.updatedAt)}</span></Link>:<Link to="/records/$recordId" params={{recordId:item.id}} className={'file-row'+(item.status==='archived'?' is-archived':'')} key={item.id}><span>{item.kind==='task_list'?<ListTodo size={17}/>:<FileText size={17}/>}<span className="truncate">{item.name}</span></span><span>{item.status==='archived'?'已归档':item.kind==='task_list'?'任务':'文档'}</span><span>{fmt(item.updatedAt)}</span></Link>):<Empty title="此目录没有内容" description="创建一个文件夹或记录以开始。"/>}</Swap>
  {!q.isPending&&!q.isError&&<button type="button" className="file-new" disabled={quickBusy} onClick={()=>void quickCreate()}><Plus size={16}/>{quickBusy?'正在创建…':'新建页面'}</button>}</div>
 {q.hasNextPage&&<div className="load-more"><Button label="加载更多" onClick={()=>q.fetchNextPage()} size="sm" variant="ghost" isLoading={q.isFetchingNextPage}/></div>}</div>;
}

/** Archived records retain their version history and remain recoverable.
 * Archived items are intentionally absent from the active page tree. */
export function ArchivePage(){
 const qc=useQueryClient();
 const q=useInfiniteQuery(archivedRecordsQuery());
 const [restoring,setRestoring]=useState<string|null>(null);
 const [error,setError]=useState<unknown>(null);
 const items=q.data?.pages.flatMap(page=>page.items)??[];
 const restore=async(item:typeof items[number])=>{
  if(restoring)return;
  setRestoring(item.id);setError(null);
  try{
   await mutate('/records/'+item.id+'/meta',{status:'active',expectedMetadataRevision:item.metadataRevision},'PATCH');
   await Promise.all([
    qc.invalidateQueries({queryKey:['archived-records']}),
    qc.invalidateQueries({queryKey:['browse']}),
    qc.invalidateQueries({queryKey:['browse-pages']}),
    qc.invalidateQueries({queryKey:['record',item.id]})
   ]);
  }catch(e){setError(e);}finally{setRestoring(null);}
 };
 return <div className="page archive-page">
  <PageTitle title="归档" description="这里保存不再参与日常工作的页面。所有内容和历史版本都会保留，可以随时恢复。"
   actions={<Link to="/library" className="small text-link">返回知识库</Link>}/>
  {Boolean(error)&&<div className="doc-notice"><ErrorText error={error}/></div>}
  {q.isPending?<LoadingRows kind="files" count={5}/>:q.isError?<ErrorText error={q.error}/>:
   items.length?<div className="archive-list">{items.map(item=><div className="archive-item" key={item.id}>
    <Link to="/records/$recordId" params={{recordId:item.id}} className="archive-item-link">
     {item.kind==='task_list'?<ListTodo size={18}/>:<FileText size={18}/>}
     <span className="archive-item-text"><strong className="truncate">{item.name}</strong>
      <small className="muted truncate">{item.folderName?'来自「'+item.folderName+'」 · ':''}{fmt(item.updatedAt)} · R{item.revision??'—'}</small>
     </span>
    </Link>
    <Button label="恢复" variant="secondary" size="sm" isLoading={restoring===item.id} isDisabled={Boolean(restoring)}
      onClick={()=>void restore(item)}/>
   </div>)}</div>:<Empty title="暂无归档内容" description="在记录页面使用“归档记录”后，它会出现在这里；归档不会删除数据。"/>}
  {q.hasNextPage&&<div className="load-more"><Button label="加载更多" variant="ghost" size="sm" isLoading={q.isFetchingNextPage}
   onClick={()=>void q.fetchNextPage()}/></div>}
 </div>;
}

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
 const archive=async()=>{if(!(await askConfirm({title:'归档此记录？',description:'归档后记录将不再显示在常用列表中，但内容和历史版本仍会保留。',actionLabel:'归档记录',destructive:true})))return;setArchiving(true);await updateMeta({status:'archived'});setArchiving(false);};
 if(q.isPending)return <div className="page record-page"><div className="doc-header"><Skeleton width={56} height={56} radius={3}/><div className="doc-skeleton-title"><Skeleton width="55%" height={40} radius={2}/></div><Skeleton width="38%" height={14} radius={1}/></div></div>;
 if(q.isError||!item)return <div className="page"><ErrorText error={q.error}/></div>;
 const pageActions=<>
  <IconButton variant="ghost" size="sm" label="详情与关联" icon={<PanelRight size={16}/>} onClick={()=>setMetaOpen(v=>!v)}/>
  <MoreMenu size="sm" variant="ghost" label="更多操作" items={[
   {label:'复制页面链接',icon:<Copy size={15}/>,onClick:()=>void navigator.clipboard?.writeText(location.origin+'/records/'+item.id)},
   {label:fullWidth?'恢复标准宽度':'全宽显示',icon:<MoveHorizontal size={15}/>,onClick:()=>setFullWidth(!fullWidth)},
   {label:'查看关系网',icon:<Network size={15}/>,onClick:()=>void nav({to:'/graph',search:{focus:item.id}})},
   {type:'divider'},
   {label:'归档记录',icon:<Archive size={15}/>,variant:'destructive',isDisabled:archiving||item.status==='archived',onClick:()=>void archive()}
  ]}/>
 </>;
 return <div className="page record-page">{confirmation}
 <TopbarPortal slot="start"><Breadcrumbs folderId={item.folderId} current={item.name}/></TopbarPortal>
 <AutoResizer>{item.status==='archived'&&<div className="doc-notice"><Banner status="warning" container="section" title="此记录已归档" description="归档的记录不会显示在侧边栏中，内容和历史版本仍完整保留。" endContent={<Button label="恢复为正常" size="sm" variant="secondary" onClick={()=>void updateMeta({status:'active'})}/>}/></div>}</AutoResizer>
 <header className="doc-header">
  <div className="page-icon" aria-hidden="true">{item.kind==='task_list'?<ListTodo size={34} strokeWidth={1.6}/>:<FileText size={34} strokeWidth={1.6}/>}</div>
  <InlineTitle value={item.name} onRename={next=>saveMeta({name:next})} autoFocus={focusTitle}/>
  <Properties>
   <Property icon={<Shapes size={14}/>} label="类型">{item.kind==='task_list'?'任务列表':'Markdown 文档'}</Property>
   <Property icon={<Tag size={14}/>} label="标签"><TagEditor tags={item.tags??[]} onChange={changeTag}/></Property>
   <Property icon={<Clock size={14}/>} label="更新时间"><span title={item.updatedAt}>{ago(item.updatedAt)||'—'}</span></Property>
   {item.status!=='active'&&<Property icon={<CircleDot size={14}/>} label="状态">{statusNames[item.status??'']??item.status}</Property>}
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

const taskFilters=[{value:"open",label:"未完成"},{value:"all",label:"全部"},{value:"todo",label:"待开始"},{value:"in_progress",label:"进行中"},{value:"blocked",label:"阻塞"},{value:"done",label:"已完成"}];
export function TasksPage({recordId}:{recordId?:string}){const qc=useQueryClient();const q=useQuery(tasksQuery(recordId));const [filter,setFilter]=useState('open'),[newTitle,setNewTitle]=useState(''),[error,setError]=useState<unknown>(null),[pending,setPending]=useState(false);
 const change=async(task:Task,changes:Record<string,unknown>,action:'update'|'remove'='update')=>{try{setError(null);const current=await api<{revision:number}>('/records/'+task.recordId+'?metadataOnly=true');await mutate('/tasks/mutate',{recordId:task.recordId,action,taskId:task.id,expectedRevision:current.revision,changes});qc.invalidateQueries({queryKey:['tasks']});qc.invalidateQueries({queryKey:['record',task.recordId]});}catch(e){setError(e);}};
 const create=async()=>{if(!recordId||!newTitle.trim())return;setPending(true);try{const current=await api<{revision:number}>('/records/'+recordId+'?metadataOnly=true');await mutate('/tasks/mutate',{action:'add',recordId,expectedRevision:current.revision,changes:{title:newTitle.trim(),status:'todo',priority:0}});setNewTitle('');qc.invalidateQueries({queryKey:['tasks']});qc.invalidateQueries({queryKey:['record',recordId]});}catch(e){setError(e);}finally{setPending(false);}};
 const items=(q.data?.items??[]).filter(t=>filter==='all'||(filter==='open'?!['done','cancelled'].includes(t.status):t.status===filter)).sort((a,b)=>b.priority-a.priority);
 return <div className={recordId?'embedded-tasks':'page'}>{!recordId&&<PageTitle title="任务" description="所有任务列表的待办与进度"/>}<AutoResizer>{Boolean(error)&&<ErrorText error={error}/>}</AutoResizer><div className="toolbar"><Selector label="筛选" isLabelHidden size="md" value={filter} options={taskFilters} onChange={setFilter}/><span className="muted small">{q.isPending?'—':items.length} 项</span></div>{recordId&&<div className="inline-form row gap"><div className="inline-field"><TextInput label="新任务标题" isLabelHidden width="100%" placeholder="添加任务…" value={newTitle} onChange={setNewTitle} onEnter={create}/></div><Button label="添加" variant="primary" size="sm" isLoading={pending} isDisabled={!newTitle.trim()||pending} onClick={create}/></div>}
 <Swap state={stateOf(q,!items.length)+':'+filter}>{q.isPending?<Card className="task-list" padding={0}><LoadingRows kind="tasks" count={3}/></Card>:q.isError?<ErrorText error={q.error}/>:items.length?<Card className="task-list" padding={0}>{items.map(t=><div className="task-item" key={t.id}><div className="task-heading"><div className="task-check"><CheckboxInput label={'完成 '+t.title} isLabelHidden size="sm" value={t.status==='done'} onChange={checked=>change(t,{status:checked?'done':'todo'})}/></div><div className={'task-title'+(t.status==='done'?' task-done':'')}>{t.title}</div><span className="priority">P{t.priority}</span></div>{t.details&&<p className="task-details muted">{t.details}</p>}<div className="task-footer">{!recordId?<Link className="small" to="/records/$recordId" params={{recordId:t.recordId}}>查看任务列表</Link>:<span/>}<div className="task-status"><Selector label={'任务状态 '+t.title} isLabelHidden size="md" width="100%" value={t.status} options={[{value:"todo",label:"待开始"},{value:"in_progress",label:"进行中"},{value:"blocked",label:"阻塞"},{value:"done",label:"已完成"},{value:"cancelled",label:"取消"}]} onChange={status=>change(t,{status})}/></div></div></div>)}</Card>:<Empty title="没有匹配的任务" description={recordId?'可以在上方添加任务。':'打开任务列表记录后可创建和修改任务。'}/>}</Swap></div>;
}

/** The full view of the same search the Ctrl/⌘ K switcher runs; query and mode live in the URL. */
export function SearchPage(){
 const params=useSearch({strict:false}) as {q?:string;mode?:SearchMode};
 const submitted=params.q??'',mode=params.mode??'auto';
 const navigate=useNavigate();
 const [term,setTerm]=useState(submitted);
 useEffect(()=>{setTerm(submitted);},[submitted]);
 const q=useQuery(searchQuery(submitted,mode));
 const go=(next:{q?:string;mode?:SearchMode})=>{const nq=(next.q??submitted).trim(),nm=next.mode??mode;void navigate({to:'/search',search:{...(nq?{q:nq}:{}),...(nm!=='auto'?{mode:nm}:{})},replace:true});};
 const shortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ K':'Ctrl K';
 const items=q.data?.items??[];
 const state=!submitted?'idle':q.isPending?'loading':q.isError?'error':items.length?'ready':'empty';
 return <div className="page search-page"><PageTitle title="搜索" description={'搜索标题与正文。在任意页面按 '+shortcut+' 可直接调出同样的搜索。'}/>
 <div className="search-surface"><form className="search-form" onSubmit={e=>{e.preventDefault();go({q:term});}}><div className="search-query-field"><TextInput label="搜索关键字" isLabelHidden width="100%" hasAutoFocus startIcon={<Search size={18}/>} placeholder="输入关键词或自然语言问题…" value={term} onChange={setTerm}/></div><Button label="搜索" variant="primary" type="submit" isDisabled={!term.trim()}/></form>
  <div className="search-modes" role="group" aria-label="搜索方式"><ButtonGroup label="搜索方式" size="sm">{searchModes.map(m=><Button key={m.value} label={m.label} tooltip={m.hint} variant={mode===m.value?'secondary':'ghost'} onClick={()=>go({mode:m.value})}/>)}</ButtonGroup><span className="muted small">{searchModes.find(m=>m.value===mode)?.hint}</span></div>
 </div>
 <Swap state={state+':'+submitted+':'+mode}>{state==='loading'?<Loading/>:state==='error'?<ErrorText error={q.error}/>:state==='ready'?<><div className="muted small search-note">共 {items.length} 条结果。精确匹配以高亮标记；语义相关结果只展示关联片段。{q.data?.degraded?' 语义搜索暂不可用，当前显示关键词结果。':q.data?.indexMayLag?' 新内容的语义索引可能略有延迟。':''}</div><div className="search-results">{items.map((r,i)=>{const exact=r.source!=='semantic';return <Link key={r.id+'-'+i} to="/records/$recordId" params={{recordId:r.id}} className="search-result"><div className="search-result-heading">{r.kind==='task_list'?<ListTodo size={17}/>:<FileText size={17}/>}<strong><SearchHighlight text={r.name} query={submitted} enabled={exact}/></strong><span className="muted small">{r.kind==='task_list'?'任务列表':'文档'}</span>{r.source==='semantic'&&<span className="semantic-label">语义相关</span>}{r.source==='hybrid'&&<span className="semantic-label">关键词＋语义</span>}</div>{r.path&&<p className="muted tiny">{r.path}</p>}{r.description&&<p className="small"><SearchHighlight text={r.description} query={submitted} enabled={exact}/></p>}{r.snippet&&<p className="small search-snippet"><SearchHighlight text={r.snippet} query={submitted} enabled={exact}/></p>}</Link>})}</div></>:state==='empty'?<Empty title="未找到结果" description="尝试其他关键词，或切换到“语义”按含义查找。"/>:<div className="search-initial-hint"><Command size={16}/><p>输入关键词查找文档和任务。“智能”同时使用关键词与语义；需要逐字匹配时选择“关键词”。</p></div>}</Swap></div>;
}

export function ActivityPage(){const q=useInfiniteQuery(activityPagesQuery());const items=q.data?.pages.flatMap(p=>p.items)??[];return <div className="page"><PageTitle title="活动" description="用户与 Agent 对知识库的修改记录" actions={<Button label="刷新" size="sm" icon={<RefreshCw size={15}/>} onClick={()=>q.refetch()}/>}/><Swap state={stateOf(q,!items.length)}>{q.isPending?<Loading/>:q.isError?<ErrorText error={q.error}/>:items.length?<Card className="activity-list" padding={4}>{items.map(event=><ActivityEntry key={event.seq} item={event}/>)}</Card>:<Empty title="暂无活动记录"/>}</Swap>{q.hasNextPage&&<div className="load-more"><Button label="加载更多" size="sm" variant="ghost" onClick={()=>q.fetchNextPage()} isLoading={q.isFetchingNextPage}/></div>}</div>}
export function SettingsPage(){const {confirm:askConfirm,confirmation}=useConfirmDialog();const {density,setDensity}=useAppearance();const pathname=useLocation({select:state=>state.pathname});const qc=useQueryClient(),navigate=useNavigate();const [error,setError]=useState<unknown>(null);const ss=useQuery({queryKey:['sessions'],queryFn:sessions,enabled:pathname==='/settings/sessions'});
 const oauth=pathname.endsWith('/oauth');
 const grants=useInfiniteQuery({queryKey:['oauth-grants'],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>api<{items:Array<{id:string;clientId:string;clientName:string;scope:string[];createdAt:number;expiresAt:number|null;redirectHost:string|null}>;cursor:string|null}>('/auth/oauth-grants'+(pageParam?'?'+queryString({cursor:pageParam}):'')),getNextPageParam:last=>last.cursor??undefined,enabled:oauth});const index=useQuery({queryKey:['index'],queryFn:()=>api<{counts:Array<{state:string;count:number}>;recentFailures:Array<{id:string;lastError:string}>}>('/index'),enabled:pathname==='/settings/indexing'});
 const revoke=async(id:string)=>{if(!(await askConfirm({title:'撤销登录会话？',description:'撤销后对应浏览器需要重新登录，当前会话也可能随即退出。',actionLabel:'撤销会话',destructive:true})))return;try{await api('/auth/sessions/'+id,{method:'DELETE'});if(id===ss.data?.currentSessionId){qc.clear();navigate({to:'/login'});}else qc.invalidateQueries({queryKey:['sessions']});}catch(e){setError(e);}};
 const ses=pathname.endsWith('sessions'),idx=pathname.endsWith('indexing'),backup=pathname.endsWith('backup');const grantItems=grants.data?.pages.flatMap(page=>page.items)??[];
 const revokeGrant=async(id:string)=>{if(!(await askConfirm({title:'撤销 Agent 授权？',description:'此操作将使该 Agent 的访问和刷新令牌失效，重新使用时必须再次完成 OAuth 授权。',actionLabel:'撤销授权',destructive:true})))return;try{await api('/auth/oauth-grants/'+encodeURIComponent(id),{method:'DELETE'});await qc.invalidateQueries({queryKey:['oauth-grants']});}catch(e){setError(e);}};
 return <div className="page">{confirmation}<PageTitle title={oauth?'Agent 授权':ses?'登录会话':idx?'索引状态':backup?'备份':'设置'} description="管理个人使用体验和本实例状态"/><nav className="settings-nav">{[{to:'/settings',name:'偏好',icon:Settings},{to:'/settings/oauth',name:'Agent 授权',icon:Shield},{to:'/settings/sessions',name:'登录会话',icon:Lock},{to:'/settings/indexing',name:'索引状态',icon:Database},{to:'/settings/backup',name:'备份',icon:Archive}].map(({to,name,icon:Icon})=><Link key={to} to={to} className="settings-tab"><Icon size={16}/>{name}</Link>)}</nav>{Boolean(error)&&<ErrorText error={error}/>}
 {pathname==='/settings'?<Card className="settings-panel" padding={5}><h2>显示偏好</h2><p className="muted small">主题可在侧边栏底部切换：跟随系统、浅色、深色。</p><div className="settings-field"><Selector label="界面密度" width="100%" value={density} onChange={v=>setDensity(v as typeof density)} options={[{value:"comfortable",label:"标准"},{value:"compact",label:"紧凑"}]}/></div></Card>:null}
 {oauth&&<Card className="settings-panel oauth-panel" padding={5}><h2>已授权的 Agent</h2><p className="muted small">在此撤销 OAuth 授权。撤销后相关令牌失效；重新连接时需要再次授权。</p>{grants.isPending?<Loading/>:grants.isError?<ErrorText error={grants.error}/>:grantItems.length?grantItems.map(g=><div className="grant-row" key={g.id}><div className="grant-details"><strong>{g.clientName}</strong><p className="muted small">{g.redirectHost||'OAuth 客户端'} · 授权于 {fmt(g.createdAt*1000)}</p><p className="grant-scopes">{g.scope.length?g.scope.join(' · '):'未声明权限范围'}</p></div><Button label="撤销授权" variant="secondary" size="sm" onClick={()=>revokeGrant(g.id)}/></div>):<Empty title="暂无已授权 Agent" description="Agent 通过 OAuth 连接后会显示在这里。"/>}{grants.hasNextPage&&<Button label="加载更多授权" size="sm" variant="secondary" isLoading={grants.isFetchingNextPage} onClick={()=>grants.fetchNextPage()}/>} </Card>}
 {ses&&<Card className="settings-panel" padding={5}><h2>已登录的会话</h2><p className="muted small">撤销后，对应浏览器需要重新输入 OAuth 授权密钥。</p>{ss.isPending?<Loading/>:ss.isError?<ErrorText error={ss.error}/>:ss.data?.items.map(s=><div className="session-row" key={s.id}><div><strong>{s.id===ss.data?.currentSessionId?'当前会话':'其他会话'}</strong><p className="muted small">{s.userAgent||'未知浏览器'} · {fmt(s.createdAt)}</p></div><Button label="撤销" variant="secondary" size="sm" onClick={()=>revoke(s.id)}/></div>)}</Card>}
 {idx&&<Card className="settings-panel" padding={5}><h2>向量索引状态</h2>{index.isPending?<Loading/>:index.isError?<ErrorText error={index.error}/>:<><div className="dashboard-stats">{index.data?.counts.map(x=><div className="stat" key={x.state}><Database size={18}/><strong>{x.count}</strong><span>{x.state}</span></div>)}</div>{index.data?.recentFailures?.length>0&&<><h3>最近失败</h3>{index.data.recentFailures.map(x=><Banner key={x.id} status="error" container="section" title="索引失败" description={x.lastError}/>)}</>}</>}</Card>}
 {backup&&<Card className="settings-panel" padding={5}><h2>备份</h2><p className="muted">网页备份管理尚未开放。当前可通过 MCP 快照工具或 Cloudflare D1 官方备份完成备份。为了安全，网页不会提供尚未验证的恢复按钮。</p></Card>}
 </div>;
}
