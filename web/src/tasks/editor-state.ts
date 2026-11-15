export type TaskEditorStatus='todo'|'in_progress'|'blocked'|'done'|'cancelled';
type TaskEditorItem={title:string;details?:string;status:TaskEditorStatus};
type TaskEditorChanges=Partial<Pick<TaskEditorItem,'title'|'details'|'status'>>;

export type TaskEditorDraft={title:string;details:string;status:TaskEditorStatus};

export function taskItemFromMutation<
 T extends {id:string;status:TaskEditorStatus},
 L extends {id:string;revision:number;counts:Record<TaskEditorStatus,number>;total:number}
>(task:T,tasks:T[],list:L,revision:number,updatedAt=new Date().toISOString(),placement?:{position:number},seed?:{position:number;boardPosition:number}){
 const counts:Record<TaskEditorStatus,number>={todo:0,in_progress:0,blocked:0,done:0,cancelled:0};
 for(const candidate of tasks)counts[candidate.status]++;
 const index=tasks.findIndex(candidate=>candidate.id===task.id);
 return {...task,recordId:list.id,position:seed?.position??(index<0?Math.max(0,tasks.length-1):index),boardPosition:placement?.position??seed?.boardPosition??0,updatedAt,
  list:{...list,revision,counts,total:tasks.length}};
}

export const taskEditorDraft=(item?:TaskEditorItem,status:TaskEditorStatus='todo'):TaskEditorDraft=>({
 title:item?.title??'',details:item?.details??'',status:item?.status??status
});

export function taskEditorDirty(base:TaskEditorItem|undefined,draft:TaskEditorDraft,detailsAvailable:boolean,status:TaskEditorStatus='todo',listName=''){
 const initial=taskEditorDraft(base,status);
 return draft.title.trim()!==initial.title||(detailsAvailable&&draft.details!==initial.details)
  ||draft.status!==initial.status||(!base&&Boolean(listName.trim()));
}

export function taskEditorChanges(base:TaskEditorItem,draft:TaskEditorDraft,detailsAvailable:boolean):TaskEditorChanges{
 const initial=taskEditorDraft(base),changes:TaskEditorChanges={};
 if(draft.title.trim()!==initial.title)changes.title=draft.title.trim();
 if(draft.status!==initial.status)changes.status=draft.status;
 if(detailsAvailable&&draft.details!==initial.details)changes.details=draft.details;
 return changes;
}

export function hydrateTaskEditor<T extends TaskEditorItem>(base:T|undefined,draft:TaskEditorDraft,item:T,{dirty,busy,detailsTouched}:{dirty:boolean;busy:boolean;detailsTouched:boolean}){
 if(!base||(!dirty&&!busy&&item!==base))return {base:item,draft:taskEditorDraft(item),replace:true};
 // Exact hydration may fill untouched details, but retains the seed revision for CAS.
 if(base.details===undefined&&item.details!==undefined&&!detailsTouched){
  return {base:{...base,details:item.details},draft:{...draft,details:item.details},replace:false};
 }
 return {base,draft,replace:false};
}
