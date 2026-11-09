/**
 * A display formula is not an independent scroller unless it actually
 * exceeds the available width. On some touch/trackpad browsers even an empty
 * horizontal scroll box can interrupt vertical scroll chaining.
 *
 * Observe a whole record with one MutationObserver and ResizeObserver, so
 * KaTeX/ProseMirror can continue owning and replacing their own DOM.
 */
const MATH_CANDIDATES=[
 '.tiptap [data-type="block-math"]',
 '.markdown-preview .katex-display',
 '.markdown-preview [data-highlighted-math]',
 '.markdown-preview .rk-numbered-math-content',
 '.rk-rmd-block-mark.rk-rmd-mark-math-only'
].join(',');
const NESTED_OWNERS='[data-highlighted-math],.rk-numbered-math-content,.rk-rmd-block-mark.rk-rmd-mark-math-only';
const ACTIVE='rk-math-scroll-active';

function scrollRoot(element:Element):element is HTMLElement{
 if(!(element instanceof HTMLElement))return false;
 if(element.matches('.markdown-preview .katex-display,.tiptap [data-type="block-math"]')&&element.closest(NESTED_OWNERS))return false;
 return true;
}

export function observeMathHorizontalOverflow(root:HTMLElement):()=>void{
 if(typeof ResizeObserver==='undefined'||typeof MutationObserver==='undefined')return()=>{};
 const targets=new Set<HTMLElement>();
 const contents=new Map<HTMLElement,Element>();
 let frame=0;
 const resize=new ResizeObserver(()=>schedule());
 const refresh=()=>{
  const found=new Set<HTMLElement>();
  root.querySelectorAll(MATH_CANDIDATES).forEach(node=>{
   if(scrollRoot(node))found.add(node);
  });
  for(const element of targets){
   if(found.has(element))continue;
   const content=contents.get(element);
   if(content)resize.unobserve(content);
   contents.delete(element);
   resize.unobserve(element);
   targets.delete(element);
  }
  for(const element of found){
   if(!targets.has(element)){
    targets.add(element);
    resize.observe(element);
   }
   // Font loading can change intrinsic formula width without resizing its
   // full-width viewport. Observe the KaTeX content as well as the viewport.
   const content=element.querySelector('.katex')??element.firstElementChild;
   const previous=contents.get(element);
   if(previous!==content){
    if(previous)resize.unobserve(previous);
    if(content){resize.observe(content);contents.set(element,content);}
    else contents.delete(element);
   }
  }
  measure();
 };
 const measure=()=>{
  for(const element of targets){
   if(!element.isConnected)continue;
   const overflow=element.clientWidth>0&&element.scrollWidth>element.clientWidth+1;
   element.classList.toggle(ACTIVE,overflow);
  }
 };
 const schedule=()=>{
  if(frame)return;
  frame=requestAnimationFrame(()=>{frame=0;refresh();});
 };
 const mutations=new MutationObserver(records=>{
  for(const record of records){
   if(record.target instanceof Element&&record.target.closest(MATH_CANDIDATES)){
    schedule();
    return;
   }
   if(record.type!=='childList')continue;
   for(const node of [...record.addedNodes,...record.removedNodes]){
    if(node instanceof Element&&(node.matches(MATH_CANDIDATES)||node.querySelector(MATH_CANDIDATES))){
     schedule();
     return;
    }
   }
  }
 });
 mutations.observe(root,{childList:true,characterData:true,subtree:true});
 window.addEventListener('resize',schedule,{passive:true});
 schedule();
 return()=>{
  mutations.disconnect();
  resize.disconnect();
  window.removeEventListener('resize',schedule);
  if(frame)cancelAnimationFrame(frame);
  for(const element of targets)element.classList.remove(ACTIVE);
  contents.clear();
  targets.clear();
 };
}
