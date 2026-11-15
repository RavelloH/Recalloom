import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type DragEvent,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';
import type {TaskItem,TaskStatus} from './data';
import './drag.css';

type TaskLayout='card'|'row';
type TaskDragActions={
 pending:string[];
 onDrag:(item:TaskItem|null)=>void;
 onDrop:(item:TaskItem)=>Promise<void>;
 canDrop:(item:TaskItem)=>boolean;
 onColumnDrop:(status:TaskStatus)=>Promise<void>;
 canColumnDrop:()=>boolean;
};
type DragTarget={kind:'item';item:TaskItem}|{kind:'container';status:TaskStatus};
type PointerPending={pointerId:number;x:number;y:number;item:TaskItem;layout:TaskLayout;source:HTMLElement};
type DragSession={
 item:TaskItem;layout:TaskLayout;source:HTMLElement;sourceStyle:string|null;workspace:HTMLElement;
 slot:HTMLElement;preview:HTMLElement;originContainer:HTMLElement;originBeforeId:string|null;originStatus:TaskStatus;
 target:DragTarget|null;placementKey:string;keyboard:boolean;native:boolean;committing:boolean;
 pointerId:number|null;lastX:number;lastY:number;scrollFrame:number;activationFrame:number;activated:boolean;
 sourceBounds:{left:number;top:number;width:number;height:number};
 animations:Animation[];
};
type CleanupOutcome='cancel'|'failure'|'silent'|'success'|'unchanged';
type TaskDragContextValue={
 activeId:string|null;
 register:(item:TaskItem)=>()=>void;
 startNative:(event:DragEvent<HTMLElement>,item:TaskItem,layout:TaskLayout)=>void;
 finishNative:()=>void;
 startPointer:(event:PointerEvent<HTMLElement>,item:TaskItem,layout:TaskLayout)=>void;
 handleKey:(event:KeyboardEvent<HTMLElement>,item:TaskItem,layout:TaskLayout)=>void;
};

const TaskDragContext=createContext<TaskDragContextValue|null>(null);
const taskSelector='[data-task-id][data-task-record-id]';
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const taskElement=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>(taskSelector):null;
const itemId=(element:Element)=>element.getAttribute('data-task-id');
const itemRecord=(element:Element)=>element.getAttribute('data-task-record-id');

function makePreview(item:TaskItem,layout:TaskLayout,source:HTMLElement){
 const preview=document.createElement('div');
 preview.className='tasks-drag-preview';preview.dataset.layout=layout;preview.dataset.taskStatus=item.status;
 preview.setAttribute('aria-hidden','true');
 const sourceStyle=getComputedStyle(source);
 for(const property of ['--tasks-focus','--tasks-card-surface']){
  const value=sourceStyle.getPropertyValue(property);if(value)preview.style.setProperty(property,value);
 }
 const heading=document.createElement('div');heading.className='tasks-drag-preview-heading';
 const grip=source.querySelector('[data-task-drag] .rk-icon')?.cloneNode(true);
 if(grip){const icon=document.createElement('span');icon.className='tasks-drag-preview-grip';icon.append(grip);heading.append(icon);}
 const status=source.querySelector('.tasks-status-dot')?.cloneNode(true);
 if(status)heading.append(status);
 const title=document.createElement('strong');title.className='tasks-drag-preview-title';title.textContent=item.title;heading.append(title);
 preview.append(heading);
 if(item.details){const details=document.createElement('span');details.className='tasks-drag-preview-details';details.textContent=item.details;preview.append(details);}
 const meta=document.createElement('span');meta.className='tasks-drag-preview-meta';meta.textContent=item.list.name;preview.append(meta);
 return preview;
}
function makeSlot(layout:TaskLayout,height:number){
 const slot=document.createElement('div');slot.className='tasks-drop-slot';slot.dataset.layout=layout;
 slot.dataset.valid='true';slot.setAttribute('aria-hidden','true');slot.style.height=Math.max(42,Math.round(height))+'px';
 return slot;
}
function setNativeDragImage(dataTransfer:DataTransfer){
 const wrapper=document.createElement('div'),transparent=document.createElement('canvas');
 wrapper.style.position='absolute';wrapper.style.top='-9999px';wrapper.style.left='-9999px';wrapper.style.pointerEvents='none';
 transparent.width=1;transparent.height=1;wrapper.append(transparent);document.body.append(wrapper);
 try{dataTransfer.setDragImage(transparent,0,0);}finally{setTimeout(()=>wrapper.remove(),0);}
}
function containerStatus(container:HTMLElement,fallback:TaskStatus){
 return (container.dataset.taskDropStatus as TaskStatus|undefined)??fallback;
}
function containerItems(container:HTMLElement,recordId:string,source:HTMLElement){
 return Array.from(container.children).filter((child):child is HTMLElement=>
  child instanceof HTMLElement&&child.matches(taskSelector)&&child!==source&&itemRecord(child)===recordId);
}
function segmentEndReference(container:HTMLElement,recordId:string,source:HTMLElement,candidates:HTMLElement[]){
 const children=Array.from(container.children);
 if(candidates.length){
  const lastIndex=children.indexOf(candidates.at(-1)!);
  return children.slice(lastIndex+1).find((child):child is HTMLElement=>
   child instanceof HTMLElement&&child.matches(taskSelector)&&child!==source)??endAnchor(container);
 }
 return children.find((child):child is HTMLElement=>child instanceof HTMLElement&&child.matches(taskSelector)&&
  child!==source&&(itemRecord(child)??'')>recordId)??endAnchor(container);
}
function endAnchor(container:HTMLElement){
 return Array.from(container.children).find((child):child is HTMLElement=>child instanceof HTMLElement&&
  (child.classList.contains('tasks-load-more')||child.classList.contains('tasks-empty')||child.classList.contains('tasks-loading')||child.classList.contains('tasks-error')))??null;
}
function findContainer(hit:Element|null,workspace:HTMLElement){
 const direct=hit?.closest<HTMLElement>('[data-task-drop-container]');
 if(direct&&workspace.contains(direct))return direct;
 const column=hit?.closest<HTMLElement>('[data-task-column]');
 const cards=column?.querySelector<HTMLElement>('[data-task-drop-container]');
 if(cards&&workspace.contains(cards))return cards;
 const group=hit?.closest<HTMLElement>('[data-task-list-id]');
 const rows=group?.querySelector<HTMLElement>('[data-task-drop-container]');
 return rows&&workspace.contains(rows)?rows:null;
}
function validContainer(session:DragSession,container:HTMLElement){
 const recordId=container.dataset.taskDropRecordId;
 return (!recordId||recordId===session.item.recordId)&&container.dataset.taskDropLayout===session.layout;
}
function paintPreview(session:DragSession,x:number,y:number){
 session.lastX=x;session.lastY=y;
 const rect=session.preview.getBoundingClientRect();
 const left=Math.max(7,Math.min(innerWidth-Math.max(120,rect.width)-7,x+16));
 const top=Math.max(7,Math.min(innerHeight-Math.max(56,rect.height)-7,y+13));
 session.preview.style.transform='translate3d('+left+'px,'+top+'px,0) rotate(-1deg)';
}
function animatePlacement(session:DragSession,mutate:()=>void){
 const elements=Array.from(session.workspace.querySelectorAll<HTMLElement>(taskSelector)).filter(element=>element!==session.source);
 const before=new Map(elements.map(element=>[element,element.getBoundingClientRect()]));
 for(const animation of session.animations)animation.cancel();session.animations=[];
 mutate();
 if(reducedMotion())return;
 for(const element of elements){
  if(!element.isConnected)continue;
  const first=before.get(element),last=element.getBoundingClientRect();if(!first)continue;
  const dx=first.left-last.left,dy=first.top-last.top;
  if(Math.abs(dx)<.5&&Math.abs(dy)<.5)continue;
  session.animations.push(element.animate([{transform:'translate3d('+dx+'px,'+dy+'px,0)'},{transform:'translate3d(0,0,0)'}],
   {duration:190,easing:'cubic-bezier(.2,.8,.2,1)'}));
 }
}
function scrollAtPoint(session:DragSession){
 const hit=document.elementFromPoint(session.lastX,session.lastY);
 if(!hit)return false;
 const threshold=48;
 let moved=false;
 const scroll=(element:HTMLElement,axis:'x'|'y')=>{
  const rect=element.getBoundingClientRect();
  const point=axis==='x'?session.lastX:session.lastY,start=axis==='x'?rect.left:rect.top,end=axis==='x'?rect.right:rect.bottom;
  let delta=0;
  if(point<start+threshold)delta=-Math.ceil((start+threshold-point)/4);
  else if(point>end-threshold)delta=Math.ceil((point-(end-threshold))/4);
  if(!delta)return;
  const before=axis==='x'?element.scrollLeft:element.scrollTop;
  if(axis==='x')element.scrollLeft+=delta;else element.scrollTop+=delta;
  if((axis==='x'?element.scrollLeft:element.scrollTop)!==before)moved=true;
 };
 const vertical=hit.closest<HTMLElement>('.tasks-column-viewport,.tasks-list-viewport');if(vertical)scroll(vertical,'y');
 const horizontal=hit.closest<HTMLElement>('.tasks-board-viewport');if(horizontal)scroll(horizontal,'x');
 return moved;
}

export function TaskDragProvider({actions,children}:{actions:TaskDragActions;children:ReactNode}){
 const actionsRef=useRef(actions);actionsRef.current=actions;
 const items=useRef(new Map<string,TaskItem>()),session=useRef<DragSession|null>(null),pendingPointer=useRef<PointerPending|null>(null);
 const [activeId,setActiveId]=useState<string|null>(null),[announcement,setAnnouncement]=useState('');

 const register=useCallback((item:TaskItem)=>{items.current.set(item.id,item);return()=>{if(items.current.get(item.id)===item)items.current.delete(item.id);};},[]);
 const activate=useCallback((current:DragSession)=>{
  if(current.activated||session.current!==current||current.committing)return;
  current.activated=true;actionsRef.current.onDrag(current.item);document.body.append(current.preview);
  current.source.before(current.slot);current.source.setAttribute('data-task-drag-source','');
  const rect=current.sourceBounds;
  current.source.style.left=rect.left+'px';current.source.style.top=rect.top+'px';
  current.source.style.width=rect.width+'px';current.source.style.height=rect.height+'px';
  document.body.classList.add('tasks-drag-active');current.originContainer.setAttribute('data-task-drop-active','true');
  setActiveId(current.item.id);
  setAnnouncement(current.keyboard?'已抓取“'+current.item.title+'”。使用方向键移动，空格或回车放下，Escape 取消。':
   '已抓取“'+current.item.title+'”。拖到目标位置后放开，Escape 取消。');
  paintPreview(current,current.lastX||rect.left+Math.min(32,rect.width/2),current.lastY||rect.top+Math.min(24,rect.height/2));
 },[]);
 const cleanup=useCallback((outcome:CleanupOutcome='cancel')=>{
  const current=session.current;if(!current)return;
  session.current=null;pendingPointer.current=null;
  cancelAnimationFrame(current.activationFrame);cancelAnimationFrame(current.scrollFrame);
  for(const animation of current.animations)animation.cancel();
  current.slot.remove();current.preview.remove();current.source.removeAttribute('data-task-drag-source');
  if(current.sourceStyle===null)current.source.removeAttribute('style');else current.source.setAttribute('style',current.sourceStyle);
  current.workspace.querySelectorAll<HTMLElement>('[data-task-drop-active]').forEach(element=>element.removeAttribute('data-task-drop-active'));
  document.body.classList.remove('tasks-drag-active','tasks-drag-committing');
  actionsRef.current.onDrag(null);setActiveId(null);
  if(outcome==='success')setAnnouncement('任务位置已更新');
  else if(outcome==='failure')setAnnouncement('无法移动任务');
  else if(outcome==='unchanged')setAnnouncement('任务位置没有变化');
  else if(outcome==='cancel')setAnnouncement('已取消移动任务');
  if(current.keyboard)requestAnimationFrame(()=>{
   const restored=current.workspace.querySelector<HTMLElement>('[data-task-id="'+CSS.escape(current.item.id)+'"] [data-task-drag]');
   restored?.focus();
  });
 },[]);
 const returnToOrigin=useCallback((current:DragSession)=>{
  if(current.placementKey==='origin')return;
  animatePlacement(current,()=>current.source.before(current.slot));
  current.placementKey='origin';current.target=null;
  current.workspace.querySelectorAll<HTMLElement>('[data-task-drop-active]').forEach(element=>element.removeAttribute('data-task-drop-active'));
  current.originContainer.setAttribute('data-task-drop-active','true');
  setAnnouncement('将“'+current.item.title+'”放回原位');
 },[]);
 const place=useCallback((current:DragSession,container:HTMLElement,before:HTMLElement|null,visualBefore:HTMLElement|null=before)=>{
  if(!validContainer(current,container))return false;
  const status=containerStatus(container,current.item.status);
  const beforeId=before?itemId(before):null;
  const isOrigin=container===current.originContainer&&status===current.originStatus&&beforeId===current.originBeforeId;
  const visualKey=visualBefore?.matches(taskSelector)?(itemRecord(visualBefore)??'')+':'+(itemId(visualBefore)??''):'anchor';
  const key=isOrigin?'origin':container.dataset.taskDropKey+':'+status+':'+(beforeId??'end')+':'+visualKey;
  if(key===current.placementKey)return true;
  const targetItem=beforeId?items.current.get(beforeId)??null:null;
  if(targetItem&&!actionsRef.current.canDrop(targetItem))return false;
  if(!targetItem&&!actionsRef.current.canColumnDrop())return false;
  animatePlacement(current,()=>{
   if(isOrigin)current.source.before(current.slot);
   else if(visualBefore)container.insertBefore(current.slot,visualBefore);
   else container.insertBefore(current.slot,endAnchor(container));
  });
  current.placementKey=key;current.target=isOrigin?null:targetItem?{kind:'item',item:targetItem}:{kind:'container',status};
  current.workspace.querySelectorAll<HTMLElement>('[data-task-drop-active]').forEach(element=>element.removeAttribute('data-task-drop-active'));
  container.setAttribute('data-task-drop-active','true');
  const position=targetItem?'“'+targetItem.title+'”之前':status===current.item.status?'列表末尾':'“'+container.dataset.taskDropLabel+'”末尾';
  setAnnouncement('将“'+current.item.title+'”移动到'+position);
  if(current.keyboard)current.slot.scrollIntoView({block:'nearest',inline:'nearest'});
  return true;
 },[]);
 const updateAtPoint=useCallback((x:number,y:number)=>{
  const current=session.current;if(!current||current.committing)return false;
  activate(current);
  paintPreview(current,x,y);
  const hit=document.elementFromPoint(x,y);let container=findContainer(hit,current.workspace);
  if(!container){
   const columns=Array.from(current.workspace.querySelectorAll<HTMLElement>('[data-task-drop-container][data-task-drop-layout="card"]'));
   container=columns.find(value=>{const rect=value.getBoundingClientRect();return x>=rect.left&&x<=rect.right&&y>=rect.top-54&&y<=rect.bottom;})??null;
  }
  if(!container||!validContainer(current,container)){returnToOrigin(current);return false;}
  const candidates=containerItems(container,current.item.recordId,current.source);
  const before=candidates.find(element=>y<=element.getBoundingClientRect().top+element.getBoundingClientRect().height/2)??null;
  const visualBefore=before??segmentEndReference(container,current.item.recordId,current.source,candidates);
  if(!place(current,container,before,visualBefore)){returnToOrigin(current);return false;}
  return true;
 },[activate,place,returnToOrigin]);
 const scrollLoop=useCallback(()=>{
  const current=session.current;if(!current||current.committing)return;
  if(scrollAtPoint(current))updateAtPoint(current.lastX,current.lastY);
  current.scrollFrame=requestAnimationFrame(scrollLoop);
 },[updateAtPoint]);
 const begin=useCallback((item:TaskItem,layout:TaskLayout,source:HTMLElement,x:number,y:number,native:boolean,keyboard=false,pointerId:number|null=null)=>{
  if(session.current||actionsRef.current.pending.includes(item.recordId))return null;
  const workspace=source.closest<HTMLElement>('[data-task-workspace]'),container=source.parentElement;
  if(!workspace||!container||container.dataset.taskDropLayout!==layout)return null;
  const rect=source.getBoundingClientRect(),slot=makeSlot(layout,rect.height),preview=makePreview(item,layout,source);
  const originItems=containerItems(container,item.recordId,source),sourceIndex=Array.from(container.children).indexOf(source);
  const originBefore=originItems.find(element=>Array.from(container.children).indexOf(element)>sourceIndex)??null;
  const current:DragSession={item,layout,source,sourceStyle:source.getAttribute('style'),workspace,slot,preview,
   originContainer:container,originBeforeId:originBefore?itemId(originBefore):null,originStatus:containerStatus(container,item.status),
   target:null,placementKey:'origin',keyboard,native,committing:false,pointerId,lastX:x,lastY:y,
   scrollFrame:0,activationFrame:0,activated:false,sourceBounds:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},animations:[]};
  preview.style.width=Math.min(rect.width,360)+'px';
  session.current=current;
  if(native)current.activationFrame=requestAnimationFrame(()=>activate(current));else activate(current);
  if(!keyboard)current.scrollFrame=requestAnimationFrame(scrollLoop);return current;
 },[activate,scrollLoop]);
 const commit=useCallback(()=>{
  const current=session.current;if(!current||current.committing)return;
  if(!current.target){cleanup('unchanged');return;}
  current.committing=true;
  document.body.classList.add('tasks-drag-committing');
  setAnnouncement('正在保存“'+current.item.title+'”的新位置');
  const target=current.target;
  void (async()=>{
   try{
    if(target.kind==='item')await actionsRef.current.onDrop(target.item);
    else await actionsRef.current.onColumnDrop(target.status);
    if(session.current===current)cleanup('success');
   }catch{if(session.current===current)cleanup('failure');}
  })();
 },[cleanup]);
 const cancel=useCallback(()=>cleanup('cancel'),[cleanup]);

 const startNative=useCallback((event:DragEvent<HTMLElement>,item:TaskItem,layout:TaskLayout)=>{
  const source=taskElement(event.currentTarget);if(!source){event.preventDefault();return;}
  const current=begin(item,layout,source,event.clientX,event.clientY,true);
  if(!current){event.preventDefault();return;}
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-recalloom-task',item.id);
  event.dataTransfer.setData('text/plain','移动任务：'+item.title);
  setNativeDragImage(event.dataTransfer);
 },[begin]);
 const finishNative=useCallback(()=>{const current=session.current;if(current&&!current.committing&&current.native)cancel();},[cancel]);
 const startPointer=useCallback((event:PointerEvent<HTMLElement>,item:TaskItem,layout:TaskLayout)=>{
  if(event.pointerType==='mouse'||event.button!==0||session.current||pendingPointer.current)return;
  const source=taskElement(event.currentTarget);if(!source)return;
  pendingPointer.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,item,layout,source};
  event.currentTarget.setPointerCapture?.(event.pointerId);
 },[]);
 const keyboardMove=useCallback((current:DragSession,key:string)=>{
  let container=current.slot.parentElement as HTMLElement|null;if(!container)return;
  if(current.layout==='card'&&(key==='ArrowLeft'||key==='ArrowRight')){
   const containers=Array.from(current.workspace.querySelectorAll<HTMLElement>('[data-task-drop-container][data-task-drop-layout="card"]'));
   const index=containers.indexOf(container),next=containers[Math.max(0,Math.min(containers.length-1,index+(key==='ArrowLeft'?-1:1)))];
   if(next&&next!==container){
    const nextItems=containerItems(next,current.item.recordId,current.source);
    place(current,next,null,segmentEndReference(next,current.item.recordId,current.source,nextItems));return;
   }
  }
  const candidates=containerItems(container,current.item.recordId,current.source);
 const target=current.target;
 let index=target?.kind==='item'?candidates.findIndex(element=>itemId(element)===target.item.id):
  target?.kind==='container'?candidates.length:current.originBeforeId?candidates.findIndex(element=>itemId(element)===current.originBeforeId):candidates.length;
  if(index<0)index=candidates.length;
  if(key==='Home')index=0;else if(key==='End')index=candidates.length;
  else if(key==='ArrowUp')index=Math.max(0,index-1);else if(key==='ArrowDown')index=Math.min(candidates.length,index+1);else return;
  const before=candidates[index]??null;
  place(current,container,before,before??segmentEndReference(container,current.item.recordId,current.source,candidates));
 },[place]);
 const handleKey=useCallback((event:KeyboardEvent<HTMLElement>,item:TaskItem,layout:TaskLayout)=>{
  const current=session.current;
  if(!current){
   if(event.key!==' '&&event.key!=='Enter')return;
   const source=taskElement(event.currentTarget);if(!source)return;
   event.preventDefault();const rect=source.getBoundingClientRect();begin(item,layout,source,rect.left+28,rect.top+20,false,true);
   return;
  }
  if(!current.keyboard||current.item.id!==item.id)return;
  if(current.committing){event.preventDefault();return;}
  if(event.key==='Escape'){event.preventDefault();cancel();return;}
  if(event.key===' '||event.key==='Enter'){event.preventDefault();commit();return;}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
   event.preventDefault();keyboardMove(current,event.key);
  }
 },[begin,cancel,commit,keyboardMove]);

 useEffect(()=>{
  const dragOver=(event:globalThis.DragEvent)=>{
   const current=session.current;if(!current||!current.native||current.committing)return;
   event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';updateAtPoint(event.clientX,event.clientY);
  };
  const drop=(event:globalThis.DragEvent)=>{
   const current=session.current;if(!current||!current.native||current.committing)return;
   event.preventDefault();event.stopPropagation();updateAtPoint(event.clientX,event.clientY);commit();
  };
  const pointerMove=(event:globalThis.PointerEvent)=>{
   const pending=pendingPointer.current,current=session.current;
   if(current?.pointerId===event.pointerId&&!current.committing){event.preventDefault();updateAtPoint(event.clientX,event.clientY);return;}
   if(!pending||pending.pointerId!==event.pointerId||Math.hypot(event.clientX-pending.x,event.clientY-pending.y)<6)return;
   event.preventDefault();pendingPointer.current=null;
   begin(pending.item,pending.layout,pending.source,event.clientX,event.clientY,false,false,event.pointerId);
  };
  const pointerEnd=(event:globalThis.PointerEvent)=>{
   if(pendingPointer.current?.pointerId===event.pointerId)pendingPointer.current=null;
   const current=session.current;if(current?.pointerId!==event.pointerId||current.committing)return;
   if(event.type==='pointercancel')cancel();else{updateAtPoint(event.clientX,event.clientY);commit();}
  };
  const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'&&session.current&&!session.current.keyboard&&!session.current.committing)cancel();};
  document.addEventListener('dragover',dragOver,true);document.addEventListener('drop',drop,true);
  window.addEventListener('pointermove',pointerMove,{capture:true,passive:false});window.addEventListener('pointerup',pointerEnd,true);window.addEventListener('pointercancel',pointerEnd,true);
  window.addEventListener('keydown',escape,true);
  return()=>{
   document.removeEventListener('dragover',dragOver,true);document.removeEventListener('drop',drop,true);
   window.removeEventListener('pointermove',pointerMove,true);window.removeEventListener('pointerup',pointerEnd,true);window.removeEventListener('pointercancel',pointerEnd,true);
   window.removeEventListener('keydown',escape,true);cleanup('silent');
  };
 },[begin,cancel,cleanup,commit,updateAtPoint]);

 const value=useMemo<TaskDragContextValue>(()=>({activeId,register,startNative,finishNative,startPointer,handleKey}),
  [activeId,register,startNative,finishNative,startPointer,handleKey]);
 return <TaskDragContext.Provider value={value}>{children}<span className="tasks-drag-live" aria-live="polite" aria-atomic="true">{announcement}</span></TaskDragContext.Provider>;
}

export function useTaskDragItem(item:TaskItem){
 const value=useContext(TaskDragContext);
 if(!value)throw new Error('TaskEntry must be rendered inside TaskDragProvider.');
 useEffect(()=>value.register(item),[item,value.register]);
 return value;
}
