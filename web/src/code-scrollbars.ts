import {attachScrollbars} from './scrollbars';

/**
 * Code blocks are plentiful in long RMD documents, but most never overflow.
 * Keep a single IntersectionObserver/ResizeObserver for the entire document,
 * and activate an overlay scrollbar only when an approaching code block
 * actually needs horizontal scrolling. Its ProseMirror contentDOM is never
 * detached, moved or replaced by this scheduler.
 */
type CodeEntry={
 host:HTMLElement;
 viewport:HTMLElement;
 near:boolean;
 content:Element|null;
 release:(()=>void)|null;
};

class CodeScrollbarScheduler{
 private readonly entries=new Map<Element,CodeEntry>();
 private readonly sizes=new Map<Element,CodeEntry>();
 private readonly pending=new Set<CodeEntry>();
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
  const entry:CodeEntry={host,viewport,near:false,content:null,release:null};
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

 private observeSizes(entry:CodeEntry){
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
 private unobserveSizes(entry:CodeEntry){
  if(this.sizes.delete(entry.viewport))this.resize.unobserve(entry.viewport);
  if(entry.content){
   if(this.sizes.delete(entry.content))this.resize.unobserve(entry.content);
   entry.content=null;
  }
 }

 private schedule(entry:CodeEntry){
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

const schedulers=new WeakMap<Document,CodeScrollbarScheduler>();

/** Code-only lazy policy; tables and page scrollers keep their current behavior.
 * Without browser observer APIs, safely fall back to the preexisting eager path.
 */
export function attachLazyCodeScrollbars(host:HTMLElement,viewport:HTMLElement){
 if(typeof IntersectionObserver==='undefined'||typeof ResizeObserver==='undefined'){
  return {check:()=>{},dispose:attachScrollbars(host,viewport,'x',{
   edges:typeof ResizeObserver!=='undefined'
  })};
 }
 const owner=host.ownerDocument;
 let scheduler=schedulers.get(owner);
 if(!scheduler){scheduler=new CodeScrollbarScheduler(owner);schedulers.set(owner,scheduler);}
 return scheduler.attach(host,viewport);
}
