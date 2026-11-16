import {useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {ApiError,api,mutate,queryString} from '../api';
import {useConfirmDialog} from '../confirm-dialog';
import type {ArchivedRecord} from '../queries';

export type RestoreTarget={folderId?:string|null;name?:string};
export type ArchiveResult={id:string;name:string;error?:string};
export function archiveError(error:unknown){
 if(error instanceof ApiError){
  if(error.code==='RESTORE_DESTINATION_REQUIRED')return '原文件夹已不存在，请选择恢复位置。';
  if(error.code==='PATH_CONFLICT')return '目标位置已有同名内容，请修改名称或选择其他位置。';
  if(error.status===409)return '内容已被其他客户端修改，请刷新后重试。';
 }
 return error instanceof Error?error.message:'操作失败，请重试。';
}

export function useArchiveActions(onSuccess:(ids:string[])=>void,onRestoreRequired:(items:ArchivedRecord[])=>void){
 const qc=useQueryClient(),locked=useRef(false);
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[results,setResults]=useState<ArchiveResult[]>([]);
 const {confirm,confirmation}=useConfirmDialog();
 const run=async(items:ArchivedRecord[],operation:'restore'|'delete',target?:RestoreTarget)=>{
  if(locked.current||!items.length)return false;
  locked.current=true;setBusy(true);setResults([]);
  const outcomes:ArchiveResult[]=[],needsTarget:ArchivedRecord[]=[];
  try{
   if(operation==='delete'){
    setProgress('正在检查删除影响…');
    const totals={revisions:0,tasks:0,incomingWikiReferences:0,manualRelations:0};
    for(const item of items){
     try{
      const preview=await api<typeof totals>('/records/'+item.id+'/deletion-preview?'+queryString({expectedMetadataRevision:item.metadataRevision,expectedRevision:item.revision}));
      for(const field of Object.keys(totals) as Array<keyof typeof totals>)totals[field]+=preview[field];
     }catch(error){outcomes.push({id:item.id,name:item.name,error:archiveError(error)});}
    }
    // Reconfirm the full current selection after any stale preview is refreshed.
    if(outcomes.length){setResults(outcomes);return false;}
    if(!await confirm({title:items.length===1?'永久删除已归档记录？':'永久删除 '+items.length+' 项归档内容？',
     description:(items.length===1?'「'+items[0].name+'」':'所选 '+items.length+' 项内容')+'及其 '+totals.revisions+' 个正文版本和 '+totals.tasks+' 条任务将被永久清除。涉及 '+totals.incomingWikiReferences+' 个 Wiki 引用、'+totals.manualRelations+' 个手动关联。此操作不可撤销。',actionLabel:'永久删除',destructive:true}))return false;
   }
   for(const [index,item] of items.entries()){
    setProgress((operation==='restore'?'正在恢复':'正在删除')+' '+(index+1)+' / '+items.length);
    try{
     if(operation==='restore')await mutate('/records/'+item.id+'/meta',{
      status:'active',expectedMetadataRevision:item.metadataRevision,...(target?{folderId:target.folderId,...(target.name?{name:target.name}:{})}:{})
     },'PATCH');
     else await mutate('/records/'+item.id,{expectedMetadataRevision:item.metadataRevision,expectedRevision:item.revision},'DELETE');
     outcomes.push({id:item.id,name:item.name});
     onSuccess([item.id]);
    }catch(error){
     outcomes.push({id:item.id,name:item.name,error:archiveError(error)});
     if(operation==='restore'&&!target&&error instanceof ApiError&&['RESTORE_DESTINATION_REQUIRED','PATH_CONFLICT'].includes(error.code))needsTarget.push(item);
    }
   }
   setResults(outcomes);
   return outcomes.every(result=>!result.error);
  }finally{
   try{
    await Promise.all(['archived-records','archive-preview','browse','browse-pages','record','recent-updates','recent-activity','task-workspace','tasks','knowledge-graph','activity','activity-feed','activity-summary','search','index-summary','index-tasks','storage-summary'].map(key=>qc.invalidateQueries({queryKey:[key]})));
   }finally{
    locked.current=false;setBusy(false);setProgress('');
    if(needsTarget.length)onRestoreRequired(needsTarget);
   }
  }
 };
 return {busy,progress,results,confirmation,restore:(items:ArchivedRecord[],target?:RestoreTarget)=>run(items,'restore',target),remove:(items:ArchivedRecord[])=>run(items,'delete')};
}
