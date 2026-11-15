import type {InfiniteData,QueryClient} from '@tanstack/react-query';

type TaskStatus='todo'|'in_progress'|'blocked'|'done'|'cancelled';
type TaskCounts=Record<TaskStatus,number>;
type Page={hasMore:boolean;nextCursor:string|number|null};
type Paged<T>={items:T[];page:Page;orderVersion?:number};
export type TaskMutationItem={id:string;title:string;details?:string;status:TaskStatus;priority:number};
export type TaskMutationResult={revision:number;tasks:TaskMutationItem[];orderVersion:number;boardOrder?:{taskId:string;position:number;beforeTaskId:string|null;rebalanced?:boolean}};
export type TaskListCache={id:string;name:string;path:string;folderId:string|null;status:string;revision:number;order:'priority'|'manual';counts:TaskCounts;total:number};
export type TaskCacheItem=TaskMutationItem&{recordId:string;position:number;boardPosition:number;updatedAt:string;list:TaskListCache};
type TaskListsPage=Paged<TaskListCache>&{counts:TaskCounts};
export type ReorderInput={recordId:string;action:string;taskId?:string;beforeTaskId?:string|null;changes?:{status?:TaskStatus}};

const rankSort=(a:TaskCacheItem,b:TaskCacheItem)=>a.boardPosition-b.boardPosition||a.id.localeCompare(b.id);
const lower=(value:string|undefined)=>value?.toLocaleLowerCase()??'';
const matchesQuery=(item:Pick<TaskMutationItem,'title'|'details'>,query:string)=>!query||lower(item.title).includes(query)||lower(item.details).includes(query);
const changedCounts=(counts:TaskCounts,from:TaskStatus,to:TaskStatus)=>from===to?counts:{...counts,[from]:Math.max(0,counts[from]-1),[to]:counts[to]+1};
const observedOrderVersions=new WeakMap<QueryClient,number>();

function cachedOrderVersion(qc:QueryClient){
 let version=0;
 for(const [,data] of qc.getQueriesData<InfiniteData<Paged<unknown>>>({queryKey:['task-workspace','view']}))
  for(const page of data?.pages??[])version=Math.max(version,page.orderVersion??0);
 for(const [,data] of qc.getQueriesData<InfiniteData<Paged<unknown>>>({queryKey:['task-workspace','lists']}))
  for(const page of data?.pages??[])version=Math.max(version,page.orderVersion??0);
 for(const [,data] of qc.getQueriesData<{orderVersion?:number}>({queryKey:['task-workspace','item']}))
  version=Math.max(version,data?.orderVersion??0);
 return version;
}

function knownItems(qc:QueryClient){
 const known=new Map<string,{item:TaskCacheItem;orderVersion:number}>();
 const remember=(item:TaskCacheItem,orderVersion=0)=>{
  const previous=known.get(item.id);
  if(previous&&(previous.orderVersion>orderVersion||previous.orderVersion===orderVersion&&previous.item.list.revision>item.list.revision))return;
  known.set(item.id,{item:{...previous?.item,...item,boardPosition:Number.isFinite(item.boardPosition)?item.boardPosition:previous?.item.boardPosition??0},orderVersion});
 };
 for(const [,data] of qc.getQueriesData<InfiniteData<Paged<TaskCacheItem>>>({queryKey:['task-workspace','view']}))
  for(const page of data?.pages??[])for(const item of page.items)remember(item,page.orderVersion);
 for(const [,data] of qc.getQueriesData<{item:TaskCacheItem;orderVersion?:number}>({queryKey:['task-workspace','item']}))if(data)remember(data.item,data.orderVersion);
 return known;
}

function sourceItem(qc:QueryClient,input:ReorderInput,known=knownItems(qc)){
 if(!input.taskId)return undefined;
 return known.get(input.taskId)?.item;
}

function optimisticPosition(items:TaskCacheItem[],source:TaskCacheItem,input:ReorderInput,status:TaskStatus){
 const ordered=items.filter(item=>item.id!==source.id).sort(rankSort);
 const anchor=input.beforeTaskId?ordered.find(item=>item.id===input.beforeTaskId):undefined;
 if(anchor){
  const index=ordered.indexOf(anchor),previous=ordered[index-1];
  return previous?(previous.boardPosition+anchor.boardPosition)/2:anchor.boardPosition-1024;
 }
 const inScope=(item:TaskCacheItem)=>input.action==='board_reorder'?item.status===status:item.recordId===input.recordId;
 const last=ordered.filter(inScope).at(-1);
 if(!last)return (ordered.at(-1)?.boardPosition??0)+1024;
 const next=ordered.find(item=>rankSort(item,last)>0);
 return next?(last.boardPosition+next.boardPosition)/2:last.boardPosition+1024;
}

function rewriteCursor(cursor:string|number|null,last:TaskCacheItem|undefined,orderVersion?:number){
 if(typeof cursor!=='string'||!last)return cursor;
 try{return JSON.stringify({...JSON.parse(cursor),boardPosition:last.boardPosition,id:last.id,...(orderVersion===undefined?{}:{orderVersion})});}
 catch{return cursor;}
}

function rewritePages(data:InfiniteData<Paged<TaskCacheItem>>,items:TaskCacheItem[],orderVersion?:number,minimumCapacity=0){
 const currentCapacity=data.pages.reduce((sum,page)=>sum+page.items.length,0),capacity=Math.max(currentCapacity,minimumCapacity);
 const expansion=capacity-currentCapacity,hasMore=data.pages.at(-1)?.page.hasMore??false;
 const ordered=[...items].sort(rankSort),visible=hasMore?ordered.slice(0,capacity):ordered;
 let offset=0;
 return {...data,pages:data.pages.map((page,index)=>{
  const oldSize=page.items.length+(index===data.pages.length-1?expansion:0),size=index===data.pages.length-1
   ?hasMore?Math.min(oldSize,Math.max(0,visible.length-offset)):Math.max(0,visible.length-offset)
   :oldSize;
  const pageItems=visible.slice(offset,offset+size);offset+=size;
  return {...page,items:pageItems,orderVersion:orderVersion??page.orderVersion,page:{...page.page,nextCursor:rewriteCursor(page.page.nextCursor,pageItems.at(-1),orderVersion)}};
 })};
}

function updateViewCaches(qc:QueryClient,source:TaskCacheItem,next:TaskCacheItem,revision?:number,orderVersion?:number,restoreMissing?:Set<string>){
 for(const [key,data] of qc.getQueriesData<InfiniteData<Paged<TaskCacheItem>>>({queryKey:['task-workspace','view']})){
  if(!data)continue;
  const scopeRecord=key[2],query=lower(String(key[3]??'').trim()),selected=new Set(String(key[4]??'').split(','));
  const previous=data.pages.flatMap(page=>page.items),wasVisible=previous.some(item=>item.id===source.id);
  const existingSummary=previous.find(item=>item.recordId===source.recordId)?.list??source.list;
  const contributes=matchesQuery(source,query);
  const list={...existingSummary,...(revision===undefined?{}:{revision}),counts:contributes?changedCounts(existingSummary.counts,source.status,next.status):existingSummary.counts};
  const items=previous.filter(item=>item.id!==source.id).map(item=>item.recordId===source.recordId?{...item,list}:item);
  const visible=(scopeRecord===null||scopeRecord===source.recordId)&&selected.has(next.status)&&matchesQuery(next,query);
  if(visible)items.push({...next,list});
  if(!visible&&!wasVisible&&revision===undefined&&source.status===next.status&&source.boardPosition===next.boardPosition)continue;
  const restoreCapacity=restoreMissing?.has(JSON.stringify(key))&&visible&&!wasVisible;
  qc.setQueryData(key,rewritePages(data,items,orderVersion,restoreCapacity?previous.length+1:0));
 }
}

function updateListCaches(qc:QueryClient,source:TaskCacheItem,next:TaskCacheItem,revision?:number,orderVersion?:number){
 for(const [key,data] of qc.getQueriesData<InfiniteData<TaskListsPage>>({queryKey:['task-workspace','lists']})){
  if(!data)continue;
  const query=lower(String(key[3]??'').trim());
  if(!matchesQuery(source,query)){
   if(orderVersion!==undefined)qc.setQueryData(key,{...data,pages:data.pages.map(page=>({...page,orderVersion}))});
   continue;
  }
  qc.setQueryData(key,{...data,pages:data.pages.map(page=>{
   const oldList=page.items.find(item=>item.id===source.recordId);
   if(!oldList)return {...page,orderVersion:orderVersion??page.orderVersion};
   const counts=changedCounts(oldList.counts,source.status,next.status),list={...oldList,...(revision===undefined?{}:{revision}),counts};
   return {...page,orderVersion:orderVersion??page.orderVersion,
    counts:changedCounts(page.counts,source.status,next.status),items:page.items.map(item=>item.id===source.recordId?list:item)};
  })});
 }
}

function updateExactCaches(qc:QueryClient,source:TaskCacheItem,next:TaskCacheItem,revision?:number,orderVersion?:number){
 for(const [key,data] of qc.getQueriesData<{item:TaskCacheItem;orderVersion?:number}>({queryKey:['task-workspace','item']})){
  if(!data)continue;
  const list=data.item.recordId===source.recordId?{...data.item.list,...(revision===undefined?{}:{revision}),
   counts:changedCounts(data.item.list.counts,source.status,next.status)}:data.item.list;
  qc.setQueryData(key,{...data,...(orderVersion===undefined?{}:{orderVersion}),item:data.item.id===source.id?{...next,list}:{...data.item,list}});
 }
}

function applyItem(qc:QueryClient,source:TaskCacheItem,next:TaskCacheItem,revision?:number,orderVersion?:number,restoreMissing?:Set<string>){
 updateViewCaches(qc,source,next,revision,orderVersion,restoreMissing);
 updateListCaches(qc,source,next,revision,orderVersion);
 updateExactCaches(qc,source,next,revision,orderVersion);
}

export type OptimisticReorder={taskId:string;rollback:()=>void};

/** Move one task through every loaded ranked view without snapshotting unrelated cache state. */
export function optimisticReorderCache(qc:QueryClient,input:ReorderInput):OptimisticReorder|undefined{
 if((input.action!=='reorder'&&input.action!=='board_reorder')||!input.taskId)return;
 const known=knownItems(qc),source=sourceItem(qc,input,known);if(!source)return;
 const visibleViews=new Set(qc.getQueriesData<InfiniteData<Paged<TaskCacheItem>>>({queryKey:['task-workspace','view']})
  .filter(([,data])=>data?.pages.some(page=>page.items.some(item=>item.id===source.id))).map(([key])=>JSON.stringify(key)));
 const status=input.changes?.status??source.status;
 const next={...source,status,boardPosition:optimisticPosition([...known.values()].map(value=>value.item),source,input,status),
  list:{...source.list,counts:changedCounts(source.list.counts,source.status,status)}};
 applyItem(qc,source,next);
 let active=true;
 return {taskId:source.id,rollback:()=>{
  if(!active)return;active=false;
  const current=sourceItem(qc,input)??next;
  applyItem(qc,current,{...source,list:current.list},undefined,undefined,visibleViews);
 }};
}

/** Reconcile an optimistic move with the server rank; response task array order is intentionally ignored. */
export function patchReorderCache(qc:QueryClient,input:ReorderInput,result:TaskMutationResult){
 if((input.action!=='reorder'&&input.action!=='board_reorder')||!input.taskId||!result.boardOrder)return;
 const observed=Math.max(observedOrderVersions.get(qc)??0,cachedOrderVersion(qc));
 if(result.orderVersion<observed)return;
 observedOrderVersions.set(qc,result.orderVersion);
 const source=sourceItem(qc,input);if(!source)return;
 const task=result.tasks.find(item=>item.id===input.taskId),status=task?.status??input.changes?.status??source.status;
 const next={...source,...task,status,boardPosition:result.boardOrder.rebalanced?source.boardPosition:result.boardOrder.position};
 applyItem(qc,source,next,result.revision,result.boardOrder.rebalanced?undefined:result.orderVersion);
}
