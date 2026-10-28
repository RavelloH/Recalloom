import type {Entry,Event,Paged,RecordDetail,Session,Task,Version} from './types';
export class ApiError extends Error {constructor(public status:number,public code:string,message?:string){super(message||code);} }
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const response=await fetch('/api'+path,{...init,method:init.method||'GET',credentials:'same-origin',headers:{...(init.body?{'content-type':'application/json'}:{}),...init.headers},cache:'no-store'});
 const data=await response.json().catch(()=>({code:'INVALID_RESPONSE'}));
 if(!response.ok)throw new ApiError(response.status,data.code||'HTTP_'+response.status,data.message||undefined);
 return data as T;
}
export const mutate=<T>(path:string,body:unknown,method='POST')=>api<T>(path,{method,body:JSON.stringify(body)});
export const queryString=(data:Record<string,string|number|null|undefined>)=>new URLSearchParams(Object.entries(data).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)])).toString();
export const browse=(folderId?:string|null,cursor?:string)=>api<Paged<Entry>>('/folders?'+queryString({parentId:folderId,cursor,limit:100}));
export const record=(id:string)=>api<RecordDetail>('/records/'+encodeURIComponent(id));
export const tasks=(filter?:{recordId?:string;status?:string})=>api<Paged<Task>>('/tasks?'+queryString({recordId:filter?.recordId,status:filter?.status,limit:200}));
export const versions=(id:string)=>api<Paged<Version>>('/records/'+id+'/versions?limit=50');
export const activity=()=>api<Paged<Event>>('/activity?limit=100');
export const sessions=()=>api<{items:Session[];currentSessionId:string}>('/auth/sessions');
