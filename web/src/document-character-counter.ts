import {markdownCharacterCount} from './document-heading';

export type DocumentCharacterCountReply=
 | {id:number;characters:number}
 | {id:number;error:true};

export interface DocumentCharacterCountWorker{
 postMessage(message:{id:number;markdown:string}):void;
 addEventListener(type:'message',listener:(event:{data:DocumentCharacterCountReply})=>void):void;
 addEventListener(type:'error',listener:(event:unknown)=>void):void;
 terminate():void;
}

export interface DocumentCharacterCounter{
 request(markdown:string):void;
 dispose():void;
}

export interface DocumentCharacterCounterOptions{
 createWorker?:()=>DocumentCharacterCountWorker;
 count?: (markdown:string)=>number;
}

type Job={id:number;markdown:string};

function createModuleWorker():DocumentCharacterCountWorker{
 return new Worker(new URL('./document-character-count.worker.ts',import.meta.url),{type:'module'}) as unknown as DocumentCharacterCountWorker;
}

/** Runs one count at a time and keeps only the newest source waiting behind it. */
export function createDocumentCharacterCounter(
 onCount:(markdown:string,characters:number)=>void,
 options:DocumentCharacterCounterOptions={}
):DocumentCharacterCounter{
 const makeWorker=options.createWorker??createModuleWorker;
 const count=options.count??markdownCharacterCount;
 let worker:DocumentCharacterCountWorker|null=null;
 let workerAttempted=false;
 let failed=false;
 let disposed=false;
 let nextId=0;
 let latest:Job|null=null;
 let inFlight:Job|null=null;
 let pending:Job|null=null;

 const deliverFallback=(job:Job)=>{
  if(disposed||latest?.id!==job.id)return;
  try{
   const characters=count(job.markdown);
   if(!disposed&&latest?.id===job.id)onCount(job.markdown,characters);
  }catch{
   // A fallback failure leaves the last valid count in place.
  }
 };

 const stopWorker=()=>{
  const current=worker;
  worker=null;
  if(current){
   try{current.terminate();}catch{/* Ignore termination errors during failure recovery. */}
  }
 };

 const failWorker=()=>{
  if(disposed||failed)return;
  failed=true;
  stopWorker();
  inFlight=null;
  pending=null;
  if(latest)deliverFallback(latest);
 };

 const startWorker=():boolean=>{
  if(worker)return true;
  if(failed)return false;
  if(workerAttempted)return false;
  workerAttempted=true;
  try{
   const created=makeWorker();
   worker=created;
   created.addEventListener('message',event=>{
    if(disposed||worker!==created)return;
    const reply=event.data;
    const job=inFlight;
    if(!job||reply.id!==job.id)return;
    if('error'in reply){failWorker();return;}
    if(!Number.isFinite(reply.characters)){failWorker();return;}
    inFlight=null;
    if(latest?.id===job.id)onCount(job.markdown,reply.characters);
    const next=pending;
    pending=null;
    if(next)send(next);
   });
   created.addEventListener('error',event=>{
    if(event&&typeof event==='object'&&'preventDefault'in event&&typeof event.preventDefault==='function'){
     event.preventDefault();
    }
    failWorker();
   });
   return true;
  }catch{
   failed=true;
   stopWorker();
   return false;
  }
 };

 const send=(job:Job)=>{
  if(disposed)return;
  const current=worker;
  if(!current||failed){deliverFallback(job);return;}
  inFlight=job;
  try{
   current.postMessage({id:job.id,markdown:job.markdown});
  }catch{
   failWorker();
  }
 };

 const request=(markdown:string)=>{
  if(disposed)return;
  const job={id:++nextId,markdown};
  latest=job;
  if(!startWorker()){
   deliverFallback(job);
   return;
  }
  if(inFlight){pending=job;return;}
  send(job);
 };

 return{
  request,
  dispose(){
   if(disposed)return;
   disposed=true;
   latest=null;
   inFlight=null;
   pending=null;
   stopWorker();
  }
 };
}
