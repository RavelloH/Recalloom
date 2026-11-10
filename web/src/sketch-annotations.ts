import {useEffect,type RefObject} from 'react';
import {SKETCH_DEFAULT_COLORS,SKETCH_PALETTE,isSketchKind,parseSketchNumber,sketchPaths,sketchSeed} from './sketch-geometry';
import {measureBlockSketchLine,measureInlineSketchLines} from './sketch-measure';
import './sketch-annotations.css';

const SVG_NS='http://www.w3.org/2000/svg';
const SELECTOR='[data-rk-sketch-kind]';

/** Attach an inert drawing layer OUTSIDE contenteditable; never put generated
 * SVG children into ProseMirror-managed markup or a KaTeX DOM subtree.
 * All overlays share the same renderer in preview, editor, and transclusions.
 */
export function installSketchAnnotations(root:HTMLElement):()=>void{
 const layer=document.createElement('div');
 layer.className='rk-sketch-overlay';
 layer.setAttribute('aria-hidden','true');
 root.appendChild(layer);
 let frame=0,disposed=false;
 const resize=new ResizeObserver(()=>schedule());
 // Observe each element only once. Disconnecting/reobserving during every
 // paint would continuously fire initial ResizeObserver entries and redraw.
 const observed=new Set<HTMLElement>();
 resize.observe(root);
 const make=(kind:string,rect:DOMRect,anchor:DOMRect,element:HTMLElement,index:number,hasMath:boolean,inkOffset=0)=>{
  if(!isSketchKind(kind)||rect.width<1||rect.height<1)return;
  const stroke=parseSketchNumber(element.dataset.rkSketchStroke,'stroke')??2;
  const padding=parseSketchNumber(element.dataset.rkSketchPadding,'padding')??(kind==='circle'||kind==='box'||kind==='bracket'?5:3);
  const roughness=parseSketchNumber(element.dataset.rkSketchRoughness,'roughness')??1;
  const opacity=parseSketchNumber(element.dataset.rkSketchOpacity,'opacity')??.42;
  const chosen=element.dataset.rkSketchColor;
  const color=chosen&&Object.hasOwn(SKETCH_PALETTE,chosen)
   ?SKETCH_PALETTE[chosen as keyof typeof SKETCH_PALETTE]
   :SKETCH_PALETTE[SKETCH_DEFAULT_COLORS[kind]];
  const width=rect.width+padding*2,height=rect.height+padding*2;
  const seed=sketchSeed(kind+':'+(element.textContent??'')+':'+index);
  const paths=sketchPaths(kind,width,height,seed,roughness,hasMath);
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('class','rk-sketch-svg');
  svg.setAttribute('data-sketch-drawing',kind);
  svg.setAttribute('width',String(width));
  svg.setAttribute('height',String(height));
  svg.setAttribute('viewBox','0 0 '+width+' '+height);
  svg.style.left=(rect.left-anchor.left-padding+root.scrollLeft)+'px';
  // Align block outlines with the actual text ink center, not an arbitrary
  // line-height offset. The clamped, measured correction varies with fonts.
  const proseOutline=!hasMath&&(kind==='box'||kind==='circle'||kind==='bracket');
  const opticalShift=proseOutline?Math.max(-4,Math.min(4,inkOffset)):0;
  svg.style.top=(rect.top-anchor.top-padding+root.scrollTop-opticalShift)+'px';
  for(const p of paths){
   const path=document.createElementNS(SVG_NS,'path');
   path.setAttribute('d',p.d);
   path.setAttribute('stroke',p.fill?'none':color);
   path.setAttribute('stroke-width',String(stroke));
   path.setAttribute('stroke-linecap','round');
   path.setAttribute('stroke-linejoin','round');
   path.setAttribute('fill',p.fill?color:'none');
   if(p.fill)path.setAttribute('fill-opacity',String(opacity));
   if(p.dash)path.setAttribute('stroke-dasharray',p.dash);
   svg.appendChild(path);
  }
  layer.appendChild(svg);
 };
 const redraw=()=>{
  if(disposed)return;
  // Reuse the same outside-editor SVG layer while changing its children.
  layer.replaceChildren();
  const currentlyVisible=new Set<HTMLElement>();
  const base=root.getBoundingClientRect();
  let count=0;
  for(const element of root.querySelectorAll<HTMLElement>(SELECTOR)){
   if(layer.contains(element)||element.closest('.markdown-preview,.wysiwyg')!==root)continue;
   if(++count>500)break; // Bound work on unusually large notebooks.
   currentlyVisible.add(element);
   if(!observed.has(element)){resize.observe(element);observed.add(element);}
   if(element.getClientRects().length===0)continue;
   const kind=element.dataset.rkSketchKind??'';
   // Browser inline client rects are *fragments*, not visual lines. Group
   // adjacent text + KaTeX on the same line into one drawing, while preserving
   // separate drawings on actual wrapped lines. Measure visible KaTeX glyphs
   // rather than the smaller outer math line box.
   const lines=element.classList.contains('rk-sketch-block')
    ?[measureBlockSketchLine(element)]
    :measureInlineSketchLines(element);
   lines.forEach((line,index)=>make(kind,line.rect,base,element,index,line.hasMath,
    'inkOffset' in line&&typeof line.inkOffset==='number'?line.inkOffset:0));
  }
  for(const old of observed)if(!currentlyVisible.has(old)){
   resize.unobserve(old);observed.delete(old);
  }
 };
 const schedule=()=>{
  if(disposed||frame)return;
  frame=requestAnimationFrame(()=>{frame=0;redraw();});
 };
 const mutations=new MutationObserver(records=>{
  if(records.some(item=>{
   if(layer===item.target||layer.contains(item.target))return false;
   if(item.type==='childList'&&[...item.addedNodes,...item.removedNodes].every(n=>n===layer||layer.contains(n)))return false;
   return true;
  }))schedule();
 });
 mutations.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-rk-sketch-kind','data-rk-sketch-color','data-rk-sketch-stroke','data-rk-sketch-padding','data-rk-sketch-roughness','data-rk-sketch-opacity','data-rk-sketch-math-only']});
 const theme=new MutationObserver(schedule);
 theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-effective-theme','class']});
 window.addEventListener('resize',schedule,{passive:true});
 root.addEventListener('scroll',schedule,true);
 document.fonts?.ready.then(schedule).catch(()=>{});
 schedule();
 return ()=>{
  disposed=true;
  if(frame)cancelAnimationFrame(frame);
  mutations.disconnect();theme.disconnect();resize.disconnect();
  window.removeEventListener('resize',schedule);root.removeEventListener('scroll',schedule,true);
  layer.remove();
 };
}
export function useSketchAnnotations(root:RefObject<HTMLElement|null>,enabled=true,key?:unknown){
 useEffect(()=>{
  if(!enabled||!root.current)return;
  return installSketchAnnotations(root.current);
 },[root,enabled,key]);
}
