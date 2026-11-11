import {Icon} from '../icon';
import {useEffect,useState} from 'react';
import {Link,useNavigate,useParams} from '@tanstack/react-router';
import {useQuery,useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {api,mutate,queryString} from '../api';
import {useConfirmDialog} from '../confirm-dialog';
import {TopbarPortal} from '../topbar-slot';
import {Breadcrumbs,InlineTitle} from '../page-chrome';
import {revealFolder} from '../page-tree';
import {createUntitled,consumeTitleFocus} from '../create-page';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {folderPagesQuery,folderQuery} from '../queries';
import {ErrorText,LoadingRows,Empty,fmt,Swap,stateOf} from './shared';

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
  setDeletingFolder(true);setError(null);
  try{
   const preview=await api<{previewToken:string;foldersToDelete:number;recordsToArchive:number;alreadyArchived:number}>(
    '/folders/'+folderId+'/delete-preview?'+queryString({expectedMetadataRevision:current.metadataRevision}));
   if(!(await askConfirm({title:'删除文件夹并归档内容？',
    description:'即将删除 '+preview.foldersToDelete+' 个文件夹，归档 '+preview.recordsToArchive+
     ' 份记录。所有文件正文与历史版本将保留在归档区，永久删除记录数为 0。',
    actionLabel:'删除文件夹',destructive:true})))return;
   await mutate('/folders/'+folderId,{expectedMetadataRevision:current.metadataRevision,previewToken:preview.previewToken},'DELETE');
   await Promise.all([qc.invalidateQueries({queryKey:['browse']}),qc.invalidateQueries({queryKey:['browse-pages']}),
     qc.invalidateQueries({queryKey:['folder-trail']}),qc.invalidateQueries({queryKey:['archived-records']}),
     qc.invalidateQueries({queryKey:['tasks']}),qc.invalidateQueries({queryKey:['knowledge-graph']})]);
   if(current.parentId)await nav({to:'/library/$folderId',params:{folderId:current.parentId}});
   else await nav({to:'/library'});
  }catch(e){setError(e);}finally{setDeletingFolder(false);}
 };
 const title=folderId?currentFolder.data?.name??'':'知识库';
 const subtitle=folderId?currentFolder.data?.description:'文件夹、Markdown 文档和结构化任务';
 return <div className="page folder-page">{confirmation}
 <TopbarPortal slot="start"><Breadcrumbs folderId={currentFolder.data?.parentId} current={folderId?title||'…':undefined}/></TopbarPortal>
 <header className="doc-header">
  <div className="page-icon" aria-hidden="true">{folderId?<Icon name="folderOpen" inline/>:<Icon name="library" inline/>}</div>
  {folderId&&currentFolder.isPending?<Skeleton width="45%" height={40} radius={2}/>:currentFolder.isError?<ErrorText error={currentFolder.error}/>:<InlineTitle value={title} onRename={folderId?renameFolder:undefined} autoFocus={focusTitle}/>}
  {subtitle&&<p className="page-subtitle">{subtitle}</p>}
  <div className="doc-header-actions"><Button label="新建文件夹" icon={<Icon name="folderPlus" size="sm"/>} variant="ghost" size="sm" onClick={()=>setCreating('folder')}/><Button label="新建记录" icon={<Icon name="plus" size="sm"/>} variant="secondary" size="sm" onClick={()=>setCreating('document')}/>{folderId&&<Button label="删除文件夹" variant="ghost" size="sm" isDisabled={deletingFolder||currentFolder.isPending} isLoading={deletingFolder} onClick={()=>void deleteFolder()}/>}</div>
 </header>
 <AutoResizer><AutoTransition transitionKey={creating?'form':'none'} type="slideUp">{creating&&<Card className="inline-form create-surface" padding={4}><form className="create-form" onSubmit={e=>{e.preventDefault();void create();}}><div className="create-fields"><div className="inline-selector"><Selector label="类型" size="md" width="100%" value={creating} options={[{value:'folder',label:'文件夹'},{value:'document',label:'文档'},{value:'checkpoint_template',label:'阶段总结（文档模板）'},{value:'task_list',label:'任务列表'}]} onChange={value=>setCreating(value as typeof creating)}/></div><div className="inline-field"><TextInput label="名称" hasAutoFocus width="100%" placeholder="名称" value={name} onChange={setName} onEnter={create} onKeyDown={e=>{if(e.key==='Escape')setCreating(null);}}/></div>{creating!=='folder'&&<div className="inline-field"><TextInput label="标签" width="100%" placeholder="标签（逗号分隔，可选）" value={tagInput} onChange={setTagInput}/></div>}</div><div className="create-actions"><Button type="submit" label="创建" variant="primary" isDisabled={!name.trim()}/><Button label="取消" onClick={()=>setCreating(null)}/></div></form></Card>}</AutoTransition></AutoResizer>
 <AutoResizer>{Boolean(error)&&<div className="doc-notice"><ErrorText error={error}/></div>}</AutoResizer>
 {!folderId&&<div className="library-archive-link"><Link to="/archive" className="text-link"><Icon name="archive" size="sm"/>查看归档内容</Link></div>}
 <div className="file-table"><div className="file-table-head"><span>名称</span><span>类型</span><span>最近修改</span></div>
  <Swap state={stateOf(q,!entries.length)}>{q.isPending?<LoadingRows kind="files" count={5}/>:q.isError?<ErrorText error={q.error}/>:entries.length?entries.map(item=>item.entityType==='folder'?<Link to="/library/$folderId" params={{folderId:item.id}} className="file-row" key={item.id}><span><Icon name="folder" size="md"/><span className="truncate">{item.name}</span></span><span>文件夹</span><span>{fmt(item.updatedAt)}</span></Link>:<Link to="/records/$recordId" params={{recordId:item.id}} className={'file-row'+(item.status==='archived'?' is-archived':'')} key={item.id}><span>{item.kind==='task_list'?<Icon name="taskList" size="md"/>:<Icon name="document" size="md"/>}<span className="truncate">{item.name}</span></span><span>{item.status==='archived'?'已归档':item.kind==='task_list'?'任务':'文档'}</span><span>{fmt(item.updatedAt)}</span></Link>):<Empty title="此目录没有内容" description="创建一个文件夹或记录以开始。"/>}</Swap>
  {!q.isPending&&!q.isError&&<button type="button" className="file-new" disabled={quickBusy} onClick={()=>void quickCreate()}><Icon name="plus" size="sm"/>{quickBusy?'正在创建…':'新建页面'}</button>}</div>
 {q.hasNextPage&&<div className="load-more"><Button label="加载更多" onClick={()=>q.fetchNextPage()} size="sm" variant="ghost" isLoading={q.isFetchingNextPage}/></div>}</div>;
}
