import type {InfiniteData,QueryClient} from '@tanstack/react-query';

type TaskStatus='todo'|'in_progress'|'blocked'|'done'|'cancelled';
type TaskCounts=Record<TaskStatus,number>;
type Page={hasMore:boolean;nextCursor:string|number|null};
type Paged<T>={items:T[];page:Page};
export type TaskMutationItem={id:string;title:string;details?:string;status:TaskStatus;priority:number};
export type TaskMutationResult={revision:number;tasks:TaskMutationItem[];boardOrder?:{taskId:string;position:number;beforeTaskId:string|null;rebalanced?:boolean}};
export type TaskListCache={id:string;name:string;path:string;folderId:string|null;status:string;revision:number;order:'priority'|'manual';counts:TaskCounts;total:number};
export type TaskCacheItem=TaskMutationItem&{recordId:string;position:number;boardPosition?:number;updatedAt:string;list:TaskListCache};
type TaskListsPage=Paged<TaskListCache>&{counts:TaskCounts};
type ReorderInput={recordId:string;action:string;taskId?:string};

/** Apply the canonical mutation result before active queries finish refetching. */
export function patchReorderCache(qc:QueryClient,input:ReorderInput,result:TaskMutationResult){
 if((input.action!=='reorder'&&input.action!=='board_reorder')||!input.taskId)return;
 const views=qc.getQueriesData<InfiniteData<Paged<TaskCacheItem>>>({queryKey:['task-workspace','view']});
 const exact=qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',input.taskId]);
 const source=exact?.item??views.flatMap(([,data])=>data?.pages.flatMap(page=>page.items)??[]).find(item=>item.id===input.taskId);
 const lists=qc.getQueriesData<InfiniteData<TaskListsPage>>({queryKey:['task-workspace','lists']});
 const summary=source?.list??lists.flatMap(([,data])=>data?.pages.flatMap(page=>page.items)??[]).find(list=>list.id===input.recordId);
 if(!source||!summary)return;
 const known=new Map<string,TaskCacheItem>();
 const remember=(item:TaskCacheItem)=>{
  const previous=known.get(item.id);
  known.set(item.id,{...previous,...item,boardPosition:Number.isFinite(item.boardPosition)?item.boardPosition:previous?.boardPosition});
 };
 for(const [,data] of views)for(const page of data?.pages??[])for(const item of page.items)remember(item);
 for(const [,data] of qc.getQueriesData<{item:TaskCacheItem}>({queryKey:['task-workspace','item']}))if(data)remember(data.item);
 const counts={todo:0,in_progress:0,blocked:0,done:0,cancelled:0} satisfies Record<TaskStatus,number>;
 for(const task of result.tasks)counts[task.status]++;
 const list={...summary,revision:result.revision,order:input.action==='reorder'?'manual' as const:summary.order,counts,total:result.tasks.length};
 const listForQuery=(query:string)=>{
  if(!query)return list;
  const filtered=result.tasks.filter(task=>task.title.toLocaleLowerCase().includes(query)||(task.details??'').toLocaleLowerCase().includes(query));
  const filteredCounts={todo:0,in_progress:0,blocked:0,done:0,cancelled:0} satisfies Record<TaskStatus,number>;
  for(const task of filtered)filteredCounts[task.status]++;
  return {...list,counts:filteredCounts,total:filtered.length};
 };
 const order=new Map(result.tasks.map((task,index)=>[task.id,index]));
 const raw=new Map(result.tasks.map(task=>[task.id,task]));
 const makeItem=(task:TaskMutationItem,itemList=list):TaskCacheItem=>{
  // The full mutation response contains canonical tasks, not every board rank.
  // Never copy the dragged task's rank onto an unseen sibling from another page.
  const {boardPosition:_,...base}=known.get(task.id)??source;
  const boardPosition=result.boardOrder?.taskId===task.id?result.boardOrder.position:known.get(task.id)?.boardPosition;
  return {...base,...task,recordId:input.recordId,position:order.get(task.id)??0,boardPosition,list:itemList};
 };
 for(const [key,data] of views){
  if(!data)continue;
  const scopeRecord=key[2],query=String(key[3]??'').trim().toLocaleLowerCase(),statuses=new Set(String(key[4]??'').split(','));
  if(scopeRecord!==null&&scopeRecord!==input.recordId)continue;
  const viewList=listForQuery(query);
  const matches=(task:TaskMutationItem)=>statuses.has(task.status)&&(!query||task.title.toLocaleLowerCase().includes(query)||(task.details??'').toLocaleLowerCase().includes(query));
  const board=key[5]==='board';
  if(board&&result.boardOrder?.rebalanced)continue;
  const previous=data.pages.flatMap(page=>page.items),next=previous.filter(item=>item.recordId!==input.recordId);
  for(const task of result.tasks)if(matches(task)){
   const item=makeItem(task,viewList);
   if(!board||Number.isFinite(item.boardPosition))next.push(item);
  }
  next.sort(board?(a,b)=>(a.boardPosition!-b.boardPosition!)||a.id.localeCompare(b.id):
   (a,b)=>a.recordId.localeCompare(b.recordId)||(a.list.order==='priority'?b.priority-a.priority:0)||a.position-b.position||a.id.localeCompare(b.id));
  const hasMore=data.pages.at(-1)?.page.hasMore??false,lastLoaded=previous.at(-1);
  const prefix=board&&hasMore&&Number.isFinite(lastLoaded?.boardPosition)?next.filter(item=>
   item.boardPosition!<lastLoaded!.boardPosition!||(item.boardPosition===lastLoaded!.boardPosition&&item.id<=lastLoaded!.id)):next;
  const visible=hasMore?prefix.slice(0,previous.length):prefix;
  let offset=0;
  qc.setQueryData<InfiniteData<Paged<TaskCacheItem>>>(key,{...data,pages:data.pages.map((page,index)=>{
   const size=index===data.pages.length-1?visible.length-offset:page.items.length;
   const items=visible.slice(offset,offset+size);offset+=size;
   let nextCursor=page.page.nextCursor;
   if(typeof nextCursor==='string'&&items.length)try{
    const cursor=JSON.parse(nextCursor) as Record<string,unknown>,last=items.at(-1)!;
    nextCursor=JSON.stringify(board?{...cursor,boardPosition:last.boardPosition,id:last.id}:
     {...cursor,recordId:last.recordId,priority:last.list.order==='manual'?0:-last.priority,position:last.position,id:last.id});
   }catch{/* The authoritative refetch replaces an unknown cursor format. */}
   return {...page,items,page:{...page.page,nextCursor}};
  })});
 }
 for(const [key,data] of lists)if(data){
  const query=String(key[3]??'').trim().toLocaleLowerCase(),queryList=listForQuery(query);
  const oldList=data.pages.flatMap(page=>page.items).find(item=>item.id===input.recordId);
  qc.setQueryData<InfiniteData<TaskListsPage>>(key,{...data,pages:data.pages.map(page=>({...page,
   counts:oldList?Object.fromEntries((Object.keys(page.counts) as TaskStatus[]).map(status=>
    [status,page.counts[status]-oldList.counts[status]+queryList.counts[status]])) as typeof page.counts:page.counts,
   items:page.items.map(item=>item.id===input.recordId?queryList:item)}))});
 }
 for(const [key,data] of qc.getQueriesData<{item:TaskCacheItem}>({queryKey:['task-workspace','item']})){
  const task=data?.item.recordId===input.recordId?raw.get(data.item.id):undefined;
  if(task)qc.setQueryData<{item:TaskCacheItem}>(key,{item:makeItem(task)});
 }
}
