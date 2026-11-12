import {useSyncExternalStore} from 'react';

export type RecentPage={id:string;name:string;kind:'document'|'task_list';path:string;visitedAt:number};
const key='recalloom:recent-pages';
const limit=12;
const listeners=new Set<()=>void>();
let cache:RecentPage[]|null=null;

function read():RecentPage[]{
 if(cache)return cache;
 try{
  const parsed:unknown=JSON.parse(localStorage.getItem(key)??'[]');
  cache=Array.isArray(parsed)?parsed.filter((x):x is RecentPage=>!!x&&typeof x.id==='string'&&typeof x.name==='string'&&typeof x.visitedAt==='number'):[];
 }catch{cache=[];}
 return cache;
}
function write(items:RecentPage[]){
 cache=items;
 try{localStorage.setItem(key,JSON.stringify(items));}catch{ /* storage may be unavailable */ }
 listeners.forEach(fn=>fn());
}
export function rememberPage(page:Omit<RecentPage,'visitedAt'>){
 write([{...page,visitedAt:Date.now()},...read().filter(x=>x.id!==page.id)].slice(0,limit));
}
export function forgetPage(id:string){
 if(read().some(x=>x.id===id))write(read().filter(x=>x.id!==id));
}
export function clearRecentPages(){
 cache=[];
 try{localStorage.removeItem(key);}catch{ /* storage may be unavailable */ }
 listeners.forEach(fn=>fn());
}
export const getRecentPages=read;
export function useRecentPages(){
 return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},read,read);
}
