import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient,type InfiniteData} from '@tanstack/react-query';
import {optimisticReorderCache,patchReorderCache,type TaskCacheItem,type TaskListCache} from '../web/src/tasks/order-cache';

type Page={hasMore:boolean;nextCursor:string|number|null};
type Paged<T>={items:T[];page:Page;orderVersion:number};
type TaskListsPage=Paged<TaskListCache>&{counts:TaskListCache['counts']};

const empty={todo:0,in_progress:0,blocked:0,done:0,cancelled:0};
const makeList=(id:string,counts:TaskListCache['counts']):TaskListCache=>({
 id,name:id,path:'/'+id,folderId:null,status:'active',revision:1,order:'manual',counts,total:Object.values(counts).reduce((sum,value)=>sum+value,0)
});
const task=(id:string,list:TaskListCache,status:TaskCacheItem['status'],boardPosition:number):TaskCacheItem=>({
 id,title:id,details:'',status,priority:0,recordId:list.id,position:0,boardPosition,updatedAt:'2026-01-01T00:00:00.000Z',list
});
const page=<T>(items:T[],orderVersion=1,paging:Page={hasMore:false,nextCursor:null}):Paged<T>=>({items,orderVersion,page:paging});
const infinite=<T>(items:T[],orderVersion=1):InfiniteData<Paged<T>>=>({pages:[page(items,orderVersion)],pageParams:[null]});
const ids=(qc:QueryClient,key:readonly unknown[])=>qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(key)!.pages.flatMap(value=>value.items).map(item=>item.id);

test('optimistic list reorder immediately follows the shared global rank',()=>{
 const qc=new QueryClient(),list=makeList('list',{...empty,todo:2}),otherList=makeList('other',{...empty,todo:1});
 const a=task('a',list,'todo',10),other=task('other',otherList,'todo',20),b=task('b',list,'todo',30);
 const globalKey=['task-workspace','view',null,'','todo','board'] as const;
 const listKey=['task-workspace','view',list.id,'','todo','board'] as const;
 qc.setQueryData(globalKey,infinite([a,other,b]));qc.setQueryData(listKey,infinite([a,b]));
 qc.setQueryData(['task-workspace','item',b.id],{item:b,orderVersion:1});

 const patch=optimisticReorderCache(qc,{recordId:list.id,action:'reorder',taskId:b.id,beforeTaskId:a.id,changes:{status:'todo'}});

 assert.ok(patch);assert.deepEqual(ids(qc,globalKey),[b.id,a.id,other.id]);assert.deepEqual(ids(qc,listKey),[b.id,a.id]);
 assert.ok(qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',b.id])!.item.boardPosition<a.boardPosition);
});

test('optimistic move into an empty scope appends after the loaded global order',()=>{
 const qc=new QueryClient(),list=makeList('list',{...empty,todo:1}),otherList=makeList('other',{...empty,todo:2});
 const source=task('source',list,'todo',5),a=task('a',otherList,'todo',10),b=task('b',otherList,'todo',20);
 const key=['task-workspace','view',null,'','todo','board'] as const;
 qc.setQueryData(key,infinite([source,a,b]));qc.setQueryData(['task-workspace','item',source.id],{item:source,orderVersion:1});

 optimisticReorderCache(qc,{recordId:list.id,action:'reorder',taskId:source.id,beforeTaskId:null,changes:{status:'todo'}});

 const items=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(key)!.pages[0]!.items;
 assert.deepEqual(items.map(item=>item.id),[a.id,b.id,source.id]);
 assert.equal(items.at(-1)!.boardPosition,b.boardPosition+1024);
});

test('successful reorder uses boardOrder rank and ignores legacy tasks array order',()=>{
 const qc=new QueryClient(),list=makeList('list',{...empty,todo:1,done:1}),otherList=makeList('other',{...empty,done:1});
 const a=task('a',list,'todo',10),b=task('b',list,'done',30),other=task('other',otherList,'done',100);
 const allKey=['task-workspace','view',null,'','todo,done','board'] as const;
 const todoKey=['task-workspace','view',null,'','todo','board'] as const;
 const doneKey=['task-workspace','view',null,'','done','board'] as const;
 const listsKey=['task-workspace','lists',null,''] as const;
 qc.setQueryData(allKey,infinite([a,b,other]));qc.setQueryData(todoKey,infinite([a]));qc.setQueryData(doneKey,infinite([b,other]));
 qc.setQueryData<InfiniteData<TaskListsPage>>(listsKey,{pages:[{...page([list,otherList]),counts:{...empty,todo:1,done:2}}],pageParams:[null]});
 qc.setQueryData(['task-workspace','item',a.id],{item:a,orderVersion:1});

 optimisticReorderCache(qc,{recordId:list.id,action:'board_reorder',taskId:a.id,beforeTaskId:other.id,changes:{status:'done'}});
 assert.deepEqual(ids(qc,todoKey),[]);assert.deepEqual(ids(qc,doneKey),[b.id,a.id,other.id]);
 const optimisticList=qc.getQueryData<InfiniteData<TaskListsPage>>(listsKey)!.pages[0]!;
 assert.deepEqual(optimisticList.items[0]!.counts,{...empty,todo:0,done:2});assert.deepEqual(optimisticList.counts,{...empty,todo:0,done:3});

 patchReorderCache(qc,{recordId:list.id,action:'board_reorder',taskId:a.id,beforeTaskId:other.id,changes:{status:'done'}},{
  revision:2,orderVersion:7,tasks:[{id:other.id,title:other.title,status:'done',priority:0},{id:a.id,title:a.title,status:'done',priority:0},{id:b.id,title:b.title,status:'done',priority:0}],
  boardOrder:{taskId:a.id,position:90,beforeTaskId:other.id}
 });

 const all=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(allKey)!.pages[0]!;
 assert.deepEqual(all.items.map(item=>item.id),[b.id,a.id,other.id]);
 assert.equal(all.items.find(item=>item.id===a.id)!.boardPosition,90);assert.equal(all.orderVersion,7);
 assert.equal(all.items.find(item=>item.recordId===list.id)!.list.revision,2);
 assert.equal(qc.getQueryData<InfiniteData<TaskListsPage>>(listsKey)!.pages[0]!.items[0]!.revision,2);
});

test('failed concurrent move rolls back only its task and preserves another successful move',()=>{
 const qc=new QueryClient(),one=makeList('one',{...empty,todo:2}),two=makeList('two',{...empty,todo:2});
 const a=task('a',one,'todo',10),x=task('x',two,'todo',20),b=task('b',one,'todo',30),y=task('y',two,'todo',40);
 const key=['task-workspace','view',null,'','todo','board'] as const;
 qc.setQueryData(key,infinite([a,x,b,y]));
 qc.setQueryData(['task-workspace','item',a.id],{item:a,orderVersion:1});qc.setQueryData(['task-workspace','item',y.id],{item:y,orderVersion:1});

 optimisticReorderCache(qc,{recordId:one.id,action:'reorder',taskId:a.id,beforeTaskId:b.id,changes:{status:'todo'}});
 const failed=optimisticReorderCache(qc,{recordId:two.id,action:'reorder',taskId:y.id,beforeTaskId:x.id,changes:{status:'todo'}})!;
 patchReorderCache(qc,{recordId:one.id,action:'reorder',taskId:a.id,beforeTaskId:b.id,changes:{status:'todo'}},{
  revision:1,orderVersion:2,tasks:[{id:b.id,title:b.title,status:'todo',priority:0},{id:a.id,title:a.title,status:'todo',priority:0}],
  boardOrder:{taskId:a.id,position:26,beforeTaskId:b.id}
 });
 failed.rollback();

 assert.deepEqual(ids(qc,key),[x.id,a.id,b.id,y.id]);
 assert.equal(qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',a.id])!.item.boardPosition,26);
 assert.equal(qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',y.id])!.item.boardPosition,40);
});

test('rollback restores a source clipped from loaded paginated views',()=>{
 const qc=new QueryClient(),list=makeList('list',{...empty,todo:2}),source=task('source',list,'todo',10),sibling=task('sibling',list,'todo',20);
 const todoKey=['task-workspace','view',null,'','todo','board'] as const;
 qc.setQueryData<InfiniteData<Paged<TaskCacheItem>>>(todoKey,{
  pages:[page([source,sibling],1,{hasMore:true,nextCursor:JSON.stringify({boardPosition:20,id:sibling.id,orderVersion:1})})],pageParams:[null]
 });

 const optimistic=optimisticReorderCache(qc,{recordId:list.id,action:'board_reorder',taskId:source.id,beforeTaskId:null,changes:{status:'done'}})!;
 assert.deepEqual(ids(qc,todoKey),[sibling.id]);
 optimistic.rollback();

 const restored=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(todoKey)!.pages[0]!;
 assert.deepEqual(restored.items.map(item=>item.id),[source.id,sibling.id]);
 assert.equal(restored.items[0]!.boardPosition,10);
 assert.deepEqual(restored.items[0]!.list.counts,{...empty,todo:2});
});

test('older successful response cannot replay after a newer order version',()=>{
 const qc=new QueryClient(),one=makeList('one',{...empty,todo:1}),two=makeList('two',{...empty,todo:1});
 const a=task('a',one,'todo',10),b=task('b',two,'todo',20),key=['task-workspace','view',null,'','todo','board'] as const;
 qc.setQueryData(key,infinite([a,b]));
 qc.setQueryData(['task-workspace','item',a.id],{item:a,orderVersion:1});qc.setQueryData(['task-workspace','item',b.id],{item:b,orderVersion:1});
 optimisticReorderCache(qc,{recordId:one.id,action:'reorder',taskId:a.id,beforeTaskId:null,changes:{status:'todo'}});
 optimisticReorderCache(qc,{recordId:two.id,action:'reorder',taskId:b.id,beforeTaskId:a.id,changes:{status:'todo'}});
 const optimisticA=qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',a.id])!.item.boardPosition;

 patchReorderCache(qc,{recordId:two.id,action:'reorder',taskId:b.id,beforeTaskId:a.id,changes:{status:'todo'}},{
  revision:1,orderVersion:3,tasks:[{id:b.id,title:b.title,status:'todo',priority:0}],boardOrder:{taskId:b.id,position:15,beforeTaskId:a.id}
 });
 patchReorderCache(qc,{recordId:one.id,action:'reorder',taskId:a.id,beforeTaskId:null,changes:{status:'todo'}},{
  revision:1,orderVersion:2,tasks:[{id:a.id,title:a.title,status:'todo',priority:0}],boardOrder:{taskId:a.id,position:100,beforeTaskId:null}
 });

 const data=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(key)!.pages[0]!;
 assert.equal(data.orderVersion,3);assert.equal(data.items.find(item=>item.id===a.id)!.boardPosition,optimisticA);
 assert.equal(data.items.find(item=>item.id===b.id)!.boardPosition,15);
});

test('rebalance keeps the optimistic visual order until invalidated data refetches',()=>{
 const qc=new QueryClient(),list=makeList('list',{...empty,todo:2});
 const a=task('a',list,'todo',10),b=task('b',list,'todo',20),key=['task-workspace','view',list.id,'','todo','board'] as const;
 qc.setQueryData(key,infinite([a,b]));qc.setQueryData(['task-workspace','item',b.id],{item:b,orderVersion:1});
 optimisticReorderCache(qc,{recordId:list.id,action:'reorder',taskId:b.id,beforeTaskId:a.id,changes:{status:'todo'}});
 const optimisticRank=qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',b.id])!.item.boardPosition;

 patchReorderCache(qc,{recordId:list.id,action:'reorder',taskId:b.id,beforeTaskId:a.id,changes:{status:'todo'}},{
  revision:1,orderVersion:9,tasks:[{id:a.id,title:a.title,status:'todo',priority:0},{id:b.id,title:b.title,status:'todo',priority:0}],
  boardOrder:{taskId:b.id,position:2048,beforeTaskId:a.id,rebalanced:true}
 });

 assert.deepEqual(ids(qc,key),[b.id,a.id]);
 assert.equal(qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',b.id])!.item.boardPosition,optimisticRank);
 assert.equal(qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(key)!.pages[0]!.orderVersion,1);
});
