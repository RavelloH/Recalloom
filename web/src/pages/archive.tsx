import {Icon} from '../icon';
import {useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ApiError,api,mutate,queryString} from '../api';
import {useConfirmDialog} from '../confirm-dialog';
import {archivedRecordsQuery} from '../queries';
import {PageTitle,ErrorText,LoadingRows,Empty,fmt} from './shared';

export function ArchivePage(){
 const qc=useQueryClient();
 const [filter,setFilter]=useState('');
 const q=useInfiniteQuery(archivedRecordsQuery(filter));
 const [restoring,setRestoring]=useState<string|null>(null);
 const [deleting,setDeleting]=useState<string|null>(null);
 const {confirm:askConfirm,confirmation}=useConfirmDialog();
 const [error,setError]=useState<unknown>(null);
 const items=q.data?.pages.flatMap(page=>page.items)??[];
 const restore=async(item:typeof items[number])=>{
  if(restoring||deleting)return;
  setRestoring(item.id);setError(null);
  const doRestore=async(folderId?:string|null)=>{
   await mutate('/records/'+item.id+'/meta',{
    status:'active',expectedMetadataRevision:item.metadataRevision,
    ...(folderId===undefined?{}:{folderId})
   },'PATCH');
   await Promise.all([qc.invalidateQueries({queryKey:['archived-records']}),
    qc.invalidateQueries({queryKey:['browse']}),qc.invalidateQueries({queryKey:['browse-pages']}),
    qc.invalidateQueries({queryKey:['record',item.id]})]);
  };
  try{await doRestore();}
  catch(e){
   if(e instanceof ApiError&&['RESTORE_DESTINATION_REQUIRED','PATH_CONFLICT'].includes(e.code)){
    const yes=await askConfirm({title:'恢复到知识库根目录？',
     description:'原文件夹已不存在，或原路径有同名记录。可以改为恢复至根目录；若名称仍冲突，请先打开归档记录重命名。',
     actionLabel:'恢复到根目录'});
    if(yes)try{await doRestore(null);}catch(error){setError(error);}
   }else setError(e);
  }finally{setRestoring(null);}
 };
 const remove=async(item:typeof items[number])=>{
  if(deleting||restoring)return;
  setDeleting(item.id);setError(null);
  try{
   const preview=await api<{revisions:number;tasks:number;incomingWikiReferences:number;manualRelations:number}>(
    '/records/'+item.id+'/deletion-preview?'+queryString({
     expectedMetadataRevision:item.metadataRevision,expectedRevision:item.revision
    }));
   if(!(await askConfirm({title:'永久删除已归档记录？',
    description:'「'+item.name+'」及其 '+preview.revisions+' 个正文版本和 '+preview.tasks+
     ' 条任务将被永久清除。涉及 '+preview.incomingWikiReferences+
     ' 个 Wiki 引用、'+preview.manualRelations+' 个手动关联；此操作不可撤销。',
    actionLabel:'永久删除',destructive:true})))return;
   await mutate('/records/'+item.id,{
    expectedMetadataRevision:item.metadataRevision,expectedRevision:item.revision
   },'DELETE');
   await Promise.all([qc.invalidateQueries({queryKey:['archived-records']}),
    qc.invalidateQueries({queryKey:['record',item.id]}),qc.invalidateQueries({queryKey:['knowledge-graph']})]);
  }catch(e){setError(e);}finally{setDeleting(null);}
 };
 return <div className="page archive-page">{confirmation}
  <PageTitle title="归档" description="这里保存不再参与日常工作的页面。所有内容和历史版本都会保留，可以随时恢复。"
   actions={<Link to="/library" className="small text-link">返回知识库</Link>}/>
  {Boolean(error)&&<div className="doc-notice"><ErrorText error={error}/></div>}
  <div className="archive-filter"><TextInput label="搜索归档" placeholder="搜索归档名称或原路径" width="100%" value={filter} onChange={setFilter}/></div>
  {q.isPending?<LoadingRows kind="files" count={5}/>:q.isError?<ErrorText error={q.error}/>:
   items.length?<div className="archive-list">{items.map(item=><div className="archive-item" key={item.id}>
    <Link to="/records/$recordId" params={{recordId:item.id}} className="archive-item-link">
     {item.kind==='task_list'?<Icon name="taskList" size="md"/>:<Icon name="document" size="md"/>}
     <span className="archive-item-text"><strong className="truncate">{item.name}</strong>
      <small className="muted truncate">{item.archivedFromPath?'原路径 '+item.archivedFromPath+' · ':''}{fmt(item.archivedAt??item.updatedAt)} · R{item.revision??'—'}</small>
     </span>
    </Link>
    <Button label="恢复" variant="secondary" size="sm" isLoading={restoring===item.id} isDisabled={Boolean(restoring||deleting)}
      onClick={()=>void restore(item)}/>
    <Button label="永久删除" variant="ghost" size="sm" isLoading={deleting===item.id} isDisabled={Boolean(restoring||deleting)}
      onClick={()=>void remove(item)}/>
   </div>)}</div>:<Empty title="暂无归档内容" description="在记录页面使用“归档记录”后，它会出现在这里；归档不会删除数据。"/>}
  {q.hasNextPage&&<div className="load-more"><Button label="加载更多" variant="ghost" size="sm" isLoading={q.isFetchingNextPage}
   onClick={()=>void q.fetchNextPage()}/></div>}
 </div>;
}
