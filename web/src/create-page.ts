import type {QueryClient} from '@tanstack/react-query';
import {ApiError,mutate} from './api';

export type NewPageKind='document'|'task_list'|'folder';
const untitled:Record<NewPageKind,string>={document:'未命名文档',task_list:'未命名任务列表',folder:'未命名文件夹'};

let pendingTitleFocus:string|null=null;
export const requestTitleFocus=(id:string)=>{pendingTitleFocus=id;};
export function consumeTitleFocus(id:string){
 if(pendingTitleFocus!==id)return false;
 pendingTitleFocus=null;
 return true;
}

/** Notion-style instant creation; sibling names must stay unique, so retry with a suffix. */
export async function createUntitled(qc:QueryClient,kind:NewPageKind,parentId:string|null){
 for(let attempt=1;attempt<=30;attempt++){
  const name=untitled[kind]+(attempt>1?' '+attempt:'');
  try{
   const created=kind==='folder'
    ?await mutate<{id:string}>('/folders',{name,parentId})
    :await mutate<{id:string}>('/records',{name,kind,folderId:parentId});
   await Promise.all([qc.invalidateQueries({queryKey:['browse']}),qc.invalidateQueries({queryKey:['browse-pages']}),qc.invalidateQueries({queryKey:['recent-updates']})]);
   requestTitleFocus(created.id);
   return created.id;
  }catch(error){
   if(error instanceof ApiError&&error.code==='PATH_CONFLICT')continue;
   throw error;
  }
 }
 throw new Error('同一目录下的未命名页面过多，请先重命名已有页面。');
}
