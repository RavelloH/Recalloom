import {useCallback,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {mutate} from '../api';
import type {Task} from '../types';
import type {TaskItem} from './data';
import {optimisticReorderCache,patchReorderCache,type TaskMutationResult} from './order-cache';

type TaskChanges=Partial<Pick<Task,'title'|'details'|'status'>>;
type Write={recordId:string;expectedRevision:number;action:'add'|'update'|'remove'|'reorder'|'board_reorder';taskId?:string;beforeTaskId?:string|null;changes?:TaskChanges};

export function useTaskActions(){
 const qc=useQueryClient(),busy=useRef(new Set<string>()),dirty=useRef(new Set<string>()),[pending,setPending]=useState<string[]>([]),[error,setError]=useState<unknown>(null);
 const refresh=useCallback((recordIds:string[])=>{
  void Promise.all([
   qc.invalidateQueries({queryKey:['task-workspace']}),qc.invalidateQueries({queryKey:['tasks']}),
   ...recordIds.map(recordId=>qc.invalidateQueries({queryKey:['record',recordId]})),qc.invalidateQueries({queryKey:['recent-updates']}),
   qc.invalidateQueries({queryKey:['activity']}),qc.invalidateQueries({queryKey:['recent-activity']})
  ]);
 },[qc]);
 const write=useCallback(async(input:Write)=>{
  if(busy.current.has(input.recordId))throw new Error('这个任务列表正在保存，请稍后重试。');
  busy.current.add(input.recordId);setPending([...busy.current]);setError(null);
  const ordered=input.action==='reorder'||input.action==='board_reorder';
  const cancellation=ordered?Promise.all([
   qc.cancelQueries({queryKey:['task-workspace']}),qc.cancelQueries({queryKey:['tasks']}),qc.cancelQueries({queryKey:['record',input.recordId]})
  ]):Promise.resolve([]);
  const optimistic=ordered?optimisticReorderCache(qc,input):undefined;
  try{
   await cancellation;
   const result=await mutate<TaskMutationResult>('/tasks/mutate',input);
   patchReorderCache(qc,input,result);
   return result;
  }catch(error){optimistic?.rollback();setError(error);throw error;}
  finally{
   dirty.current.add(input.recordId);busy.current.delete(input.recordId);setPending([...busy.current]);
   if(!busy.current.size){const recordIds=[...dirty.current];dirty.current.clear();refresh(recordIds);}
  }
 },[qc,refresh]);
 const update=useCallback((item:TaskItem,changes:TaskChanges)=>write({recordId:item.recordId,expectedRevision:item.list.revision,taskId:item.id,action:'update',changes}),[write]);
 const move=useCallback((item:TaskItem,beforeTaskId:string|null,status=item.status)=>write({recordId:item.recordId,expectedRevision:item.list.revision,taskId:item.id,action:'reorder',beforeTaskId,changes:{status}}),[write]);
 const moveBoard=useCallback((item:TaskItem,beforeTaskId:string|null,status=item.status)=>write({recordId:item.recordId,expectedRevision:item.list.revision,taskId:item.id,action:'board_reorder',beforeTaskId,changes:{status}}),[write]);
 const clearError=useCallback(()=>setError(null),[]);
 return {write,update,move,moveBoard,pending,error,clearError};
}
export type TaskActions=ReturnType<typeof useTaskActions>;
