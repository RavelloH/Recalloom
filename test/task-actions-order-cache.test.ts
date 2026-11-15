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
const mutation=({id,title,details,status,priority}:TaskCacheItem)=>({id,title,details,status,priority});
const page=<T>(items:T[]):Paged<T>=>({items,page:{hasMore:false,nextCursor:null}});
const infinite=<T>(items:T[]):InfiniteData<Paged<T>>=>({pages:[page(items)],pageParams:[null]});

test('reorder mutation response immediately updates list, board, summary and exact task caches',()=>{
 const qc=new QueryClient(),a=task('a','todo',9,0),b=task('b','todo',1,1),c=task('c','done',5,2);
 const listKey=['task-workspace','view',list.id,'','todo,in_progress,blocked,done,cancelled','list'] as const;
 const todoKey=['task-workspace','view',list.id,'','todo','list'] as const;
 const doneKey=['task-workspace','view',list.id,'','done','list'] as const;
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
 const key=['task-workspace','view',list.id,'','todo','list'] as const;
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

test('global board reorder crosses list boundaries while canonical order stays independent',()=>{
 const qc=new QueryClient(),a={...task('a','todo',9,0),boardPosition:10},b={...task('b','todo',1,1),boardPosition:30};
 const otherList={...list,id:'other',name:'Other',counts:{...counts,todo:1,done:0},total:1};
 const other={...task('other-task','todo',0,0),recordId:otherList.id,boardPosition:20,list:otherList};
 const boardKey=['task-workspace','view',null,'','todo','board'] as const;
 const canonicalKey=['task-workspace','view',list.id,'','todo','list'] as const;
 qc.setQueryData(boardKey,infinite([a,other,b]));qc.setQueryData(canonicalKey,infinite([a,b]));
 qc.setQueryData(['task-workspace','item',a.id],{item:a});
 const result={revision:1,tasks:[a,b],boardOrder:{taskId:a.id,position:40,beforeTaskId:null}};

 patchReorderCache(qc,{recordId:list.id,action:'board_reorder',taskId:a.id},result);

 const board=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(boardKey)!.pages[0]!.items;
 assert.deepEqual(board.map(item=>item.id),[other.id,b.id,a.id]);
 const canonical=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(canonicalKey)!.pages[0]!.items;
 assert.deepEqual(canonical.map(item=>item.id),[a.id,b.id]);
 assert.equal(canonical[0]!.list.order,'priority');
 assert.equal(canonical[0]!.position,0);
 assert.equal(qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',a.id])!.item.boardPosition,40);
});

test('cross-status board placement updates both columns without inventing unseen sibling ranks',()=>{
 const qc=new QueryClient(),a={...task('a','todo',9,0),boardPosition:10},b={...task('b','todo',1,1),boardPosition:30};
 const unknown=task('unloaded','done',0,2),otherList={...list,id:'other'};
 const other={...task('other-task','done',0,0),recordId:otherList.id,boardPosition:100,list:otherList};
 const todoKey=['task-workspace','view',null,'','todo','board'] as const;
 const doneKey=['task-workspace','view',null,'','done','board'] as const;
 qc.setQueryData(todoKey,infinite([a,b]));qc.setQueryData(doneKey,infinite([other]));

 patchReorderCache(qc,{recordId:list.id,action:'board_reorder',taskId:a.id},{revision:2,
  tasks:[{...a,status:'done'},b,unknown],boardOrder:{taskId:a.id,position:50,beforeTaskId:other.id}});

 const todo=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(todoKey)!.pages[0]!.items;
 const done=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(doneKey)!.pages[0]!.items;
 assert.deepEqual(todo.map(item=>item.id),[b.id]);
 assert.deepEqual(done.map(item=>item.id),[a.id,other.id]);
 assert.equal(done.some(item=>item.id===unknown.id),false);
 assert.equal(done[0]!.recordId,list.id);
 assert.equal(done[0]!.list.counts.todo,1);
 assert.equal(done[0]!.list.counts.done,2);
});

test('board pagination rewrites its own cursor and truncates a move beyond the loaded prefix',()=>{
 const qc=new QueryClient(),items=Array.from({length:45},(_,index)=>({...task('task-'+index,'todo',0,index),boardPosition:index*100}));
 const key=['task-workspace','view',null,'','todo','board'] as const;
 const cursor=JSON.stringify({v:1,kind:'view',key:'board-scope',boardPosition:3900,id:'task-39'});
 qc.setQueryData<InfiniteData<Paged<TaskCacheItem>>>(key,{pages:[{items:items.slice(0,40),page:{hasMore:true,nextCursor:cursor}}],pageParams:[null]});

 patchReorderCache(qc,{recordId:list.id,action:'board_reorder',taskId:'task-0'},
  {revision:2,tasks:items,boardOrder:{taskId:'task-0',position:5000,beforeTaskId:null}});

 const updated=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(key)!.pages[0]!;
 assert.deepEqual(updated.items.map(item=>item.id),Array.from({length:39},(_,index)=>'task-'+(index+1)));
 assert.deepEqual(JSON.parse(updated.page.nextCursor as string),{v:1,kind:'view',key:'board-scope',boardPosition:3900,id:'task-39'});
});

test('canonical reorder also updates board rank while exact content keeps a finite cached rank',()=>{
 const qc=new QueryClient(),a={...task('a','todo',9,0),boardPosition:10},b={...task('b','todo',1,1),boardPosition:30};
 const otherList={...list,id:'other',name:'Other',counts:{...counts,todo:1,done:0},total:1};
 const other={...task('other-task','todo',0,0),recordId:otherList.id,boardPosition:20,list:otherList};
 const boardKey=['task-workspace','view',null,'','todo','board'] as const;
 const canonicalKey=['task-workspace','view',list.id,'','todo','list'] as const;
 qc.setQueryData(boardKey,infinite([a,other,b]));qc.setQueryData(canonicalKey,infinite([a,b]));
 qc.setQueryData(['task-workspace','item',b.id],{item:{...b,boardPosition:undefined,updatedAt:'2026-02-02T00:00:00.000Z'}});

 patchReorderCache(qc,{recordId:list.id,action:'reorder',taskId:a.id},{revision:2,tasks:[mutation(b),mutation(a)],
  boardOrder:{taskId:a.id,position:40,beforeTaskId:null}});

 const board=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(boardKey)!.pages[0]!.items;
 assert.deepEqual(board.map(item=>item.id),[other.id,b.id,a.id]);
 assert.equal(board.find(item=>item.id===b.id)!.boardPosition,30);
 assert.equal(board.find(item=>item.id===b.id)!.updatedAt,'2026-02-02T00:00:00.000Z');
 const canonical=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(canonicalKey)!.pages[0]!.items;
 assert.deepEqual(canonical.map(item=>item.id),[b.id,a.id]);
 assert.equal(canonical[0]!.list.order,'manual');
});

test('rank rebalance leaves board pages untouched while canonical and exact caches update',()=>{
 const qc=new QueryClient(),a={...task('a','todo',9,0),boardPosition:10},b={...task('b','todo',1,1),boardPosition:30};
 const otherList={...list,id:'other',name:'Other',counts:{...counts,todo:1,done:0},total:1};
 const other={...task('other-task','todo',0,0),recordId:otherList.id,boardPosition:20,list:otherList};
 const boardKey=['task-workspace','view',null,'','todo','board'] as const;
 const canonicalKey=['task-workspace','view',list.id,'','todo','list'] as const;
 qc.setQueryData(boardKey,infinite([a,other,b]));qc.setQueryData(canonicalKey,infinite([a,b]));
 qc.setQueryData(['task-workspace','item',a.id],{item:a});

 patchReorderCache(qc,{recordId:list.id,action:'reorder',taskId:a.id},{revision:2,tasks:[mutation(b),mutation(a)],
  boardOrder:{taskId:a.id,position:2048,beforeTaskId:null,rebalanced:true}});

 const board=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(boardKey)!.pages[0]!.items;
 assert.deepEqual(board.map(item=>[item.id,item.boardPosition]),[[a.id,10],[other.id,20],[b.id,30]]);
 const canonical=qc.getQueryData<InfiniteData<Paged<TaskCacheItem>>>(canonicalKey)!.pages[0]!.items;
 assert.deepEqual(canonical.map(item=>item.id),[b.id,a.id]);
 assert.equal(canonical[0]!.list.order,'manual');
 const exact=qc.getQueryData<{item:TaskCacheItem}>(['task-workspace','item',a.id])!.item;
 assert.equal(exact.position,1);assert.equal(exact.boardPosition,2048);assert.equal(exact.list.revision,2);
});
