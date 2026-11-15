import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient,type InfiniteData} from '@tanstack/react-query';
import {patchReorderCache,type TaskCacheItem,type TaskListCache} from '../web/src/tasks/order-cache';

type Page={hasMore:boolean;nextCursor:string|number|null};
type Paged<T>={items:T[];page:Page};
type TaskListsPage=Paged<TaskListCache>&{counts:TaskListCache['counts']};

const counts={todo:2,in_progress:0,blocked:0,done:1,cancelled:0};
const list={id:'list',name:'List',path:'/List',folderId:null,status:'active',revision:1,order:'priority' as const,counts,total:3};
const task=(id:string,status:TaskCacheItem['status'],priority:number,position:number):TaskCacheItem=>({
 id,title:id,details:'',status,priority,recordId:list.id,position,updatedAt:'2026-01-01T00:00:00.000Z',list
});
const page=<T>(items:T[]):Paged<T>=>({items,page:{hasMore:false,nextCursor:null}});
const infinite=<T>(items:T[]):InfiniteData<Paged<T>>=>({pages:[page(items)],pageParams:[null]});

test('reorder mutation response immediately updates list, board, summary and exact task caches',()=>{
 const qc=new QueryClient(),a=task('a','todo',9,0),b=task('b','todo',1,1),c=task('c','done',5,2);
 const listKey=['task-workspace','view',list.id,'','todo,in_progress,blocked,done,cancelled'] as const;
 const todoKey=['task-workspace','view',list.id,'','todo'] as const;
 const doneKey=['task-workspace','view',list.id,'','done'] as const;
 const listsKey=['task-workspace','lists',list.id,''] as const;
 qc.setQueryData(listKey,infinite([a,b,c]));qc.setQueryData(todoKey,infinite([a,b]));qc.setQueryData(doneKey,infinite([c]));
 qc.setQueryData<InfiniteData<TaskListsPage>>(listsKey,{pages:[{...page([list]),counts}],pageParams:[null]});
 qc.setQueryData(['task-workspace','item',b.id],{item:b});

 const result={revision:2,tasks:[
  {id:b.id,title:b.title,details:'',status:'todo' as const,priority:b.priority},
  {id:a.id,title:a.title,details:'',status:'done' as const,priority:a.priority},
  {id:c.id,title:c.title,details:'',status:'done' as const,priority:c.priority}
 ]};
 patchReorderCache(qc,{recordId:list.id,action:'reorder',taskId:a.id},result);

 const ids=(key:readonly unknown[])=>qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(key)!.pages.flatMap(value=>value.items).map(item=>item.id);
 assert.deepEqual(ids(listKey),['b','a','c']);
 assert.deepEqual(ids(todoKey),['b']);
 assert.deepEqual(ids(doneKey),['a','c']);
 assert.equal(qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',b.id])!.item.position,0);
 const updated=qc.getQueryData<InfiniteData<TaskListsPage>>(listsKey)!.pages[0]!.items[0]!;
 assert.equal(updated.revision,2);assert.equal(updated.order,'manual');assert.deepEqual(updated.counts,{todo:1,in_progress:0,blocked:0,done:2,cancelled:0});
});

test('reorder cache uses the authoritative full result at a loaded page boundary',()=>{
 const qc=new QueryClient(),items=Array.from({length:45},(_,index)=>task('task-'+index,'todo',45-index,index));
 const pagedList={...list,counts:{...counts,todo:45,done:0},total:45};
 const cached=items.slice(0,40).map(item=>({...item,list:pagedList}));
 const key=['task-workspace','view',list.id,'','todo'] as const;
 const cursor=JSON.stringify({v:1,kind:'view',key:'scope',recordId:list.id,priority:-6,position:39,id:'task-39'});
 qc.setQueryData<InfiniteData<Paged<TaskCacheItem>>>(key,{pages:[{items:cached,page:{hasMore:true,nextCursor:cursor}}],pageParams:[null]});
 const reordered=[...items.slice(1),items[0]!].map(({recordId:_,position:__,updatedAt:___,list:____,...item})=>item);

 patchReorderCache(qc,{recordId:list.id,action:'reorder',taskId:'task-0'},
  {revision:2,tasks:reordered});

 const updated=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(key)!.pages[0]!;
 assert.deepEqual(updated.items.map(item=>item.id),Array.from({length:40},(_,index)=>'task-'+(index+1)));
 assert.equal(updated.items.some(item=>item.id==='task-0'),false,'moved task leaves the loaded first page');
 assert.equal(typeof updated.page.nextCursor,'string');
 assert.deepEqual(JSON.parse(updated.page.nextCursor as string),{v:1,kind:'view',key:'scope',recordId:list.id,priority:0,position:39,id:'task-40'});
});
