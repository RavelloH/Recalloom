import {attachScrollbars} from './scrollbars';

/**
 * Code blocks and tables are plentiful in long documents, but most never overflow.
 * Keep a single IntersectionObserver/ResizeObserver for the entire document,
 * and activate an overlay scrollbar only when an approaching block
 * actually needs horizontal scrolling. Its ProseMirror contentDOM is never
 * detached, moved or replaced by this scheduler.
 */
type BlockEntry={
 host:HTMLElement;
 viewport:HTMLElement;
 near:boolean;
 content:Element|null;
 release:(()=>void)|null;
};

class BlockScrollbarScheduler{
 private readonly entries=new Map<Element,BlockEntry>();
 private readonly sizes=new Map<Element,BlockEntry>();
 private readonly pending=new Set<BlockEntry>();
 private frame:number|null=null;
 private readonly intersection:IntersectionObserver;
 private readonly resize:ResizeObserver;

 constructor(private readonly document:Document){
  this.intersection=new IntersectionObserver(changes=>{
   for(const change of changes){
    const entry=this.entries.get(change.target);
    if(!entry)continue;
    entry.near=change.isIntersecting;
    if(entry.near){
     if(!entry.release){
      this.observeSizes(entry);
      this.schedule(entry);
     }
    }else if(!entry.release){
     this.unobserveSizes(entry);
     this.pending.delete(entry);
    }
   }
  },{rootMargin:'400px 0px',threshold:0});
  this.resize=new ResizeObserver(changes=>{
   for(const change of changes){
    const entry=this.sizes.get(change.target);
    if(entry?.near&&!entry.release)this.schedule(entry);
   }
  });
 }

 attach(host:HTMLElement,viewport:HTMLElement){
  const entry:BlockEntry={host,viewport,near:false,content:null,release:null};
  this.entries.set(host,entry);
  this.intersection.observe(host);
  return {
   check:()=>{if(entry.near&&!entry.release)this.schedule(entry);},
   dispose:()=>{
    this.intersection.unobserve(host);
    this.unobserveSizes(entry);
    this.pending.delete(entry);
    entry.release?.();
    entry.release=null;
    this.entries.delete(host);
    if(this.entries.size===0){
     this.intersection.disconnect();
     this.resize.disconnect();
     if(this.frame!==null)this.document.defaultView?.cancelAnimationFrame(this.frame);
     this.frame=null;
     schedulers.delete(this.document);
    }
   }
  };
 }

 private observeSizes(entry:BlockEntry){
  if(this.sizes.has(entry.viewport))return;
  this.sizes.set(entry.viewport,entry);
  this.resize.observe(entry.viewport);
  const content=entry.viewport.firstElementChild;
  entry.content=content;
  if(content){
   this.sizes.set(content,entry);
   this.resize.observe(content);
  }
 }
 private unobserveSizes(entry:BlockEntry){
  if(this.sizes.delete(entry.viewport))this.resize.unobserve(entry.viewport);
  if(entry.content){
   if(this.sizes.delete(entry.content))this.resize.unobserve(entry.content);
   entry.content=null;
  }
 }

 private schedule(entry:BlockEntry){
  this.pending.add(entry);
  if(this.frame!==null)return;
  const view=this.document.defaultView;
  if(!view)return;
  this.frame=view.requestAnimationFrame(()=>{
   this.frame=null;
   const batch=[...this.pending];
   this.pending.clear();
   // Read all sizes first to avoid interleaving layout reads and overlay writes.
   const overflowing=batch.filter(e=>e.near&&!e.release&&e.viewport.clientWidth>0&&
    e.viewport.scrollWidth>e.viewport.clientWidth+1);
   for(const e of overflowing){
    if(!this.entries.has(e.host)||e.release)continue;
    this.unobserveSizes(e);
    e.release=attachScrollbars(e.host,e.viewport,'x',{edges:true});
   }
  });
 }
}

const schedulers=new WeakMap<Document,BlockScrollbarScheduler>();

/** Lazy horizontal block policy; page scrollers keep their current behavior.
 * Without browser observer APIs, safely fall back to the preexisting eager path.
 */
export function attachLazyBlockScrollbars(host:HTMLElement,viewport:HTMLElement){
 if(typeof IntersectionObserver==='undefined'||typeof ResizeObserver==='undefined'){
  // Table node views are constructed before ProseMirror connects their DOM.
  // Preserve the old eager path's next-frame attachment in this fallback.
  let release:(()=>void)|null=null,frame:number|null=null,disposed=false;
  const view=host.ownerDocument.defaultView;
  const check=()=>{
   if(disposed||release||frame!==null||!view)return;
   frame=view.requestAnimationFrame(()=>{
    frame=null;
    if(!disposed&&host.isConnected&&viewport.isConnected)
     release=attachScrollbars(host,viewport,'x',{edges:typeof ResizeObserver!=='undefined'});
   });
  };
  check();
  return {check,dispose:()=>{
   disposed=true;
   if(frame!==null)view?.cancelAnimationFrame(frame);
   release?.();
  }};
 }
 const owner=host.ownerDocument;
 let scheduler=schedulers.get(owner);
 if(!scheduler){scheduler=new BlockScrollbarScheduler(owner);schedulers.set(owner,scheduler);}
 return scheduler.attach(host,viewport);
}
