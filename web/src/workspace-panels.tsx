import React,{createContext,useContext,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './icon';
import {calculatePanelLayout,PANEL_MIN_HEIGHT} from './workspace-panel-layout';
import './workspace-panels.css';

const BottomSheet=React.lazy(()=>import('@astryxdesign/core/BottomSheet').then(module=>({default:module.BottomSheet})));

type PanelProps={id:string;label:string;open:boolean;onOpenChange:(open:boolean)=>void;onAfterClose?:()=>void;children:React.ReactNode};
type Panel={id:string;label:string;container:HTMLDivElement;owner:symbol;open:boolean;present:boolean;ready:boolean;height:number;sequence:number;collapsed:boolean;change:(open:boolean)=>void;afterClose?:()=>void;opener:HTMLElement|null};
type Drag={id:string;x:number;y:number;top:number;height:number;dx:number;dy:number;axis:'x'|'y'|null;originalHeight:number};
type Snapshot={panels:Panel[];width:number;height:number;docked:boolean;drag:Drag|null};
const motionDuration=440;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Geometry lives outside the editor tree. Pointer frames only repaint the rail. */
class PanelStore{
 private listeners=new Set<()=>void>();
 private timers=new Map<string,ReturnType<typeof setTimeout>>();
 private frames=new Map<string,number>();
 private sequence=0;
 private activeId:string|undefined;
 private snapshot:Snapshot={panels:[],width:0,height:0,docked:false,drag:null};
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 getSnapshot=()=>this.snapshot;
 getDocked=()=>this.snapshot.docked;
 private emit(patch:Partial<Snapshot>={}){this.snapshot={...this.snapshot,...patch};this.listeners.forEach(fn=>fn());}
 private update(id:string,patch:Partial<Panel>){this.emit({panels:this.snapshot.panels.map(panel=>panel.id===id?{...panel,...patch}:panel)});}
 get(id:string){return this.snapshot.panels.find(panel=>panel.id===id);}
 measure(width:number,height:number){
  const nextDocked=width>=840&&height>=260;
  // Never put a newly mounted sheet above a comparison/confirmation already
  // in the native top layer. Re-evaluate on that dialog's close event.
  const otherModal=Array.from(document.querySelectorAll('dialog[open]')).some(dialog=>
   dialog.matches(':modal')&&!this.snapshot.panels.some(panel=>panel.container.closest('dialog')===dialog));
  const docked=otherModal?this.snapshot.docked:nextDocked;
  if(width!==this.snapshot.width||height!==this.snapshot.height||docked!==this.snapshot.docked)this.emit({width,height,docked});
 }
 attach(props:Omit<PanelProps,'children'>,owner:symbol){
  let panel=this.get(props.id);
  if(!panel){
   const container=document.createElement('div');container.className='workspace-panel-content';
   panel={id:props.id,label:props.label,owner,container,open:false,present:false,ready:false,height:320,sequence:0,collapsed:false,change:props.onOpenChange,afterClose:props.onAfterClose,opener:null};
   this.emit({panels:[...this.snapshot.panels,panel]});
  }
  this.update(props.id,{owner,label:props.label,change:props.onOpenChange,afterClose:props.onAfterClose});
  this.setOpen(props.id,props.open);
  return panel.container;
 }
 detach(id:string,owner:symbol){
  // A route replacement can register the same persistent outline in this commit.
  queueMicrotask(()=>{if(this.get(id)?.owner===owner)this.setOpen(id,false,false);});
 }
 private cancel(id:string){clearTimeout(this.timers.get(id));this.timers.delete(id);cancelAnimationFrame(this.frames.get(id)??0);this.frames.delete(id);}
 setOpen(id:string,open:boolean,notifyAfter=true){
  const panel=this.get(id);if(!panel||panel.open===open)return;
  this.cancel(id);
  if(open){
   const others=this.snapshot.panels.filter(p=>p.open&&p.id!==id);
   const shortest=Math.min(...this.layout().filter(p=>!p.collapsed).map(p=>p.height));
   const height=others.length?Math.max(PANEL_MIN_HEIGHT,Math.min(320,shortest)):Math.max(PANEL_MIN_HEIGHT,this.snapshot.height-112);
   this.activeId=id;
   this.update(id,{open:true,present:true,ready:false,collapsed:false,height,sequence:++this.sequence,opener:document.activeElement instanceof HTMLElement?document.activeElement:null});
   if(!this.snapshot.docked)others.forEach(other=>other.change(false));
   let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{this.frames.delete(id);if(this.get(id)?.open)this.update(id,{ready:true});});this.frames.set(id,frame);});
   this.frames.set(id,frame);
  }else{
   if(this.activeId===id)this.activeId=undefined;
   this.update(id,{open:false,ready:false});
   if(this.snapshot.drag?.id===id)this.emit({drag:null});
   const owner=panel.owner;
   this.timers.set(id,setTimeout(()=>{
    this.timers.delete(id);
    const current=this.get(id);if(!current||current.open)return;
    const restore=this.snapshot.docked&&document.getElementById(id)?.contains(document.activeElement);
    if(restore)current.opener?.focus({preventScroll:true});
    this.update(id,{present:false});
    if(notifyAfter&&current.owner===owner)current.afterClose?.();
   },reduced()?0:motionDuration));
  }
 }
 layout(){return calculatePanelLayout(this.snapshot.panels.filter(p=>p.present).map(p=>({id:p.id,height:p.height,sequence:p.sequence,collapsed:p.collapsed,priority:p.id==='document-panel-outline'})),Math.max(0,this.snapshot.height-112),this.snapshot.drag?.id??this.activeId);}
 close(id:string){this.get(id)?.change(false);}
 keepOneMobilePanel(){
  if(this.snapshot.docked)return;
  const open=this.snapshot.panels.filter(panel=>panel.open).sort((a,b)=>b.sequence-a.sequence);
  open.slice(1).forEach(panel=>panel.change(false));
 }
 activate(id:string){if(this.activeId!==id){this.activeId=id;this.emit();}}
 setCollapsed(id:string,collapsed:boolean){if(!collapsed)this.activeId=id;this.update(id,{collapsed,sequence:++this.sequence});}
 resize(id:string,height:number){this.activeId=id;this.update(id,{height:Math.max(PANEL_MIN_HEIGHT,Math.min(this.snapshot.height-112,height)),collapsed:false});}
 startDrag(id:string,x:number,y:number){
  const layout=this.layout().find(p=>p.id===id),panel=this.get(id);if(!layout||!panel)return;
  this.emit({drag:{id,x,y,top:layout.top,height:layout.height,originalHeight:panel.height,dx:0,dy:0,axis:null}});
 }
 moveDrag(x:number,y:number){
  const drag=this.snapshot.drag;if(!drag)return;
  let dx=x-drag.x,dy=y-drag.y,axis=drag.axis;
  if(!axis&&Math.max(Math.abs(dx),Math.abs(dy))>=6)axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
  if(axis==='y'){
   dy=Math.min(drag.height-Math.min(PANEL_MIN_HEIGHT,drag.height),Math.max(-drag.top,dy));
   this.resize(drag.id,drag.height-dy);
  }
  dx=Math.max(0,dx);
  this.emit({drag:{...drag,dx,dy,axis}});
 }
 endDrag(cancel=false){
  const drag=this.snapshot.drag;if(!drag)return;
  if(cancel)this.resize(drag.id,drag.originalHeight);
  this.emit({drag:null});
  if(!cancel&&drag.axis==='x'&&drag.dx>=90)this.close(drag.id);
 }
 dispose(){this.timers.forEach(clearTimeout);this.frames.forEach(cancelAnimationFrame);this.listeners.clear();}
}
const PanelContext=createContext<PanelStore|null>(null);
export function useWorkspaceDocked(){
 const store=useContext(PanelContext);
 return useSyncExternalStore(store?.subscribe??(()=>()=>{}),store?.getDocked??(()=>false),()=>false);
}

const movingFocus=new WeakMap<HTMLElement,{element:HTMLElement;start:number|null;end:number|null}>();
function ContentSlot({container}:{container:HTMLElement}){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const host=ref.current!;host.appendChild(container);
  const focus=movingFocus.get(container);movingFocus.delete(container);
  const frame=focus?requestAnimationFrame(()=>{
   if(!container.contains(focus.element)||!focus.element.isConnected)return;
   focus.element.focus({preventScroll:true});
   if((focus.element instanceof HTMLInputElement||focus.element instanceof HTMLTextAreaElement)&&focus.start!==null)focus.element.setSelectionRange(focus.start,focus.end);
  }):0;
  return()=>{
   cancelAnimationFrame(frame);
   const element=document.activeElement;
   if(element instanceof HTMLElement&&container.contains(element))movingFocus.set(container,{element,
    start:element instanceof HTMLTextAreaElement?element.selectionStart:null,end:element instanceof HTMLTextAreaElement?element.selectionEnd:null});
   if(container.parentNode===host)host.removeChild(container);
  };
 },[container]);
 return <div className="workspace-panel-slot" ref={ref}/>;
}

function MobilePanel({panel,store}:{panel:Panel;store:PanelStore}){
 const [entry,setEntry]=useState({open:panel.open,ready:false});
 if(entry.open!==panel.open)setEntry({open:panel.open,ready:false});
 // Start after the lazy native host mounts and establishes its modal state.
 useEffect(()=>{
  if(!panel.open)return;
  let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>setEntry(current=>current.open?{...current,ready:true}:current));});
  return()=>cancelAnimationFrame(frame);
 },[panel.open]);
 return <BottomSheet id={panel.id} label={panel.label} height="tall" padding={0} isOpen={panel.open}
  className={'workspace-panel-sheet'+(panel.open&&!entry.ready?' workspace-panel-entering':'')} onOpenChange={open=>{if(!open)store.close(panel.id);}}>
  <ContentSlot container={panel.container}/>
 </BottomSheet>;
}

function DockPanel({panel,store,snapshot}:{panel:Panel;store:PanelStore;snapshot:Snapshot}){
 const layout=store.layout().find(p=>p.id===panel.id)!;
 const drag=snapshot.drag?.id===panel.id?snapshot.drag:null;
 const pending=useRef<number|null>(null);
 const pointer=useRef<{x:number;y:number}|null>(null);
 const root=useRef<HTMLElement>(null);
 useEffect(()=>{
  const element=root.current!;
  const activate=(event:FocusEvent)=>{
   // A collapsed title's controls must survive focus until their click runs.
   if(event.target instanceof Element&&event.target.closest('.workspace-panel-body'))store.activate(panel.id);
  };
  const keydown=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||event.isComposing||event.defaultPrevented)return;
   event.stopPropagation();
   if(store.getSnapshot().drag)store.endDrag(true);else store.close(panel.id);
  };
  element.addEventListener('focusin',activate);
  element.addEventListener('keydown',keydown);
  return()=>{element.removeEventListener('focusin',activate);element.removeEventListener('keydown',keydown);};
 },[store,panel.id]);
 useEffect(()=>()=>{if(pending.current!==null)cancelAnimationFrame(pending.current);},[]);
 const flush=()=>{if(pending.current!==null)cancelAnimationFrame(pending.current);pending.current=null;if(pointer.current)store.moveDrag(pointer.current.x,pointer.current.y);pointer.current=null;};
 const finish=(event:React.PointerEvent,cancel=false)=>{flush();store.endDrag(cancel);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 return <aside ref={root} id={panel.id} role="complementary" aria-label={panel.label} className="workspace-panel" data-workspace-panel={panel.id}
  data-ready={panel.ready||undefined} data-closing={!panel.open||undefined} data-collapsed={layout.collapsed||undefined} data-dragging={!!drag||undefined}
  style={{top:drag?.axis==='y'?drag.top+drag.dy:layout.top,height:drag?.axis==='y'?drag.height-drag.dy:layout.height,transform:drag?.axis==='x'?`translateX(${drag.dx}px)`:undefined,zIndex:drag?3:1}}>
  <div className="workspace-panel-grip-row">
   <div className="workspace-panel-grip" data-panel-handle role="separator" aria-orientation="horizontal" tabIndex={0}
    aria-label={'调整'+panel.label+'高度；向右拖动关闭'} aria-valuemin={layout.collapsed?44:PANEL_MIN_HEIGHT} aria-valuemax={Math.max(PANEL_MIN_HEIGHT,snapshot.height-112)} aria-valuenow={Math.round(layout.height)}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);store.startDrag(panel.id,event.clientX,event.clientY);}}
    onPointerMove={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;pointer.current={x:event.clientX,y:event.clientY};if(pending.current===null)pending.current=requestAnimationFrame(flush);}}
    onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onLostPointerCapture={()=>{flush();store.endDrag(true);}}
    onKeyDown={event=>{if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();store.resize(panel.id,event.key==='Home'?PANEL_MIN_HEIGHT:event.key==='End'?snapshot.height-112:layout.height+(event.key==='ArrowUp'?32:-32));}}}>
    <span className="workspace-panel-grip-line"/>
   </div>
   <button type="button" className="workspace-panel-fold" aria-label={(layout.collapsed?'展开':'折叠')+panel.label} aria-expanded={!layout.collapsed} onClick={()=>store.setCollapsed(panel.id,!layout.collapsed)}><Icon name={layout.collapsed?'chevronDown':'chevronUp'} size="sm"/></button>
  </div>
  {layout.collapsed&&<div className="workspace-panel-collapsed-title"><button type="button" onClick={()=>store.resize(panel.id,Math.max(240,panel.height))}>{panel.label}</button><button type="button" aria-label={'关闭'+panel.label} onClick={()=>store.close(panel.id)}><Icon name="x" size="sm"/></button></div>}
  <div className="workspace-panel-body" hidden={layout.collapsed}><ContentSlot container={panel.container}/></div>
 </aside>;
}

export function WorkspacePanels({children}:{children:React.ReactNode}){
 const [store]=useState(()=>new PanelStore());
 const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const root=useRef<HTMLDivElement>(null);
 const mounted=useRef(false);
 const width=Math.max(320,Math.min(400,Math.round(snapshot.width*.32)));
 const panels=snapshot.panels.filter(panel=>panel.present);
 const space=snapshot.docked&&panels.length?width+32:0;
 const previousGeometry=useRef<{space:number;element:HTMLElement;left:number}|null>(null);
 const articleMotion=useRef<Animation|null>(null);
 useLayoutEffect(()=>{
  const page=root.current?.querySelector<HTMLElement>('.record-page');
  if(!page){previousGeometry.current=null;return;}
  const previous=previousGeometry.current;
  // offsetLeft describes layout, excluding an already running transform.
  const left=page.offsetLeft;previousGeometry.current={space,element:page,left};
  if(!previous||previous.space===space)return;
  articleMotion.current?.cancel();
  if(previous.element!==page||previous.left===left||reduced())return;
  // Reflow the article once at its new measure, then animate only its offset.
  articleMotion.current=page.animate([{transform:`translateX(${previous.left-left}px)`},{transform:'translateX(0)'}],{duration:260,easing:'cubic-bezier(.2,.7,.2,1)'});
 });
 useEffect(()=>store.keepOneMobilePanel(),[store,snapshot.docked]);
 useLayoutEffect(()=>{
  const element=root.current!;
  const measure=()=>store.measure(Math.round(element.clientWidth),Math.round(element.clientHeight));
  const observer=new ResizeObserver(measure);observer.observe(element);
  document.addEventListener('close',measure,true);measure();
  return()=>{observer.disconnect();document.removeEventListener('close',measure,true);};
 },[store]);
 useEffect(()=>{
  mounted.current=true;
  return()=>{mounted.current=false;queueMicrotask(()=>{if(!mounted.current){store.dispose();articleMotion.current?.cancel();}});};
 },[store]);
 return <PanelContext.Provider value={store}><div ref={root} className="workspace" data-panel-layout={snapshot.docked?'docked':'sheet'} data-panels-open={panels.length>0||undefined}
  style={{'--workspace-panel-width':width+'px','--workspace-panel-space':space+'px'} as React.CSSProperties}>
  {children}
  {snapshot.docked?<div className="workspace-panel-rail" aria-label="文档面板">{panels.map(panel=><DockPanel key={panel.id} panel={panel} store={store} snapshot={snapshot}/>)}</div>:
   <React.Suspense fallback={null}>{panels.map(panel=><MobilePanel key={panel.id} panel={panel} store={store}/>)}</React.Suspense>}
 </div></PanelContext.Provider>;
}

/** Portals retain their originating editor context and instance while the shell moves. */
export function WorkspacePanel({children,...props}:PanelProps){
 const store=useContext(PanelContext);
 const callbacks=useRef(props);callbacks.current=props;
 const [container,setContainer]=useState<HTMLElement|null>(null);
 useLayoutEffect(()=>{
  if(!store)return;
  const owner=Symbol(props.id);
  setContainer(store.attach({...props,onOpenChange:open=>callbacks.current.onOpenChange(open),onAfterClose:()=>callbacks.current.onAfterClose?.()},owner));
  return()=>store.detach(props.id,owner);
 },[store,props.id]);
 useLayoutEffect(()=>{store?.setOpen(props.id,props.open);},[store,props.id,props.open]);
 return container?createPortal(children,container):null;
}
