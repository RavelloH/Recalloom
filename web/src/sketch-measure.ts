/** Geometry-aware measuring for inline RMD sketch marks.
 * Inline spans return one DOM rect per text/math fragment, even when all of
 * those fragments are on the SAME visual line. Grouping by physical line is
 * crucial: one line should get one circle, not a circle per child span.
 */
export type SketchBounds={left:number;top:number;right:number;bottom:number};
export type SketchLine={bounds:SketchBounds;hasMath:boolean};

const valid=(r:SketchBounds)=>r.right>r.left&&r.bottom>r.top;
const center=(r:SketchBounds)=>(r.top+r.bottom)/2;
const height=(r:SketchBounds)=>r.bottom-r.top;
const union=(a:SketchBounds,b:SketchBounds):SketchBounds=>({
 left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),
 right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)
});

/** Merge fragmented inline boxes ONLY when they share the same visual line.
 * The line center is fixed from the first fragment so unusually tall
 * descendants cannot accidentally join consecutive wrapped lines.
 */
export function groupSketchLineBounds(fragments:readonly SketchBounds[]):SketchBounds[]{
 const lines:{bounds:SketchBounds;center:number;fragmentHeight:number}[]=[];
 for(const rect of fragments.filter(valid).sort((a,b)=>center(a)-center(b)||a.left-b.left)){
  const y=center(rect),h=height(rect);
  const line=lines.find(line=>Math.abs(line.center-y)<=Math.max(2,Math.min(h,line.fragmentHeight)*.6));
  if(line)line.bounds=union(line.bounds,rect);
  else lines.push({bounds:{...rect},center:y,fragmentHeight:h});
 }
 return lines.map(line=>line.bounds).sort((a,b)=>a.top-b.top||a.left-b.left);
}
const toBounds=(rect:DOMRect):SketchBounds=>({
 left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom
});
const asRect=(bounds:SketchBounds)=>new DOMRect(
 bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top
);

/** Expand each visual line to cover KaTeX glyphs: the .katex wrapper's CSS
 * box can be only 20px tall while its actual .base glyph is 23–25px tall.
 * MathML accessibility nodes must not contribute to visible geometry.
 */
export function measureInlineSketchLines(element:HTMLElement):{rect:DOMRect;hasMath:boolean}[]{
 const fragments=Array.from(element.getClientRects(),toBounds);
 const lines=groupSketchLineBounds(fragments).map(bounds=>({bounds,hasMath:false}));
 for(const math of Array.from(element.querySelectorAll<HTMLElement>('.katex'))){
  const anchor=toBounds(math.getBoundingClientRect());
  if(!valid(anchor)||!lines.length)continue;
  const target=lines.reduce((best,line)=>
   Math.abs(center(line.bounds)-center(anchor))<Math.abs(center(best.bounds)-center(anchor))?line:best,lines[0]!);
  target.hasMath=true;
  const glyphs=Array.from(math.querySelectorAll<HTMLElement>('.katex-html > .base'),node=>toBounds(node.getBoundingClientRect())).filter(valid);
  const visible=glyphs.length?glyphs:[toBounds((math.querySelector<HTMLElement>('.katex-html')??math).getBoundingClientRect())];
  for(const rect of visible)target.bounds=union(target.bounds,rect);
 }
 return lines.map(line=>({rect:asRect(line.bounds),hasMath:line.hasMath}));
}

export function measureBlockSketchLine(element:HTMLElement):{rect:DOMRect;hasMath:boolean;inkOffset:number}{
 const mathOnly=element.dataset.rkSketchMathOnly==='true';
 const math=mathOnly?element.querySelector<HTMLElement>('.katex-html'):null;
 const target=math??element.querySelector<HTMLElement>('.rk-sketch-content')??element;
 let bounds=toBounds(target.getBoundingClientRect());
 if(math){
  for(const node of Array.from(math.querySelectorAll<HTMLElement>(':scope > .base'))){
   const glyph=toBounds(node.getBoundingClientRect());
   if(valid(glyph))bounds=union(bounds,glyph);
  }
 }
 // CSS line-height is not optically centered on text ink; its extra
 // ascent/descent leading depends on font and script (Latin/CJK). Measure the
 // actual text range once per annotation redraw rather than guessing pixels.
 let inkOffset=0;
 if(!math&&target.textContent?.trim()&&!element.querySelector('.katex')){
  const range=document.createRange();
  range.selectNodeContents(target);
  const ink=toBounds(range.getBoundingClientRect());
  if(valid(ink))inkOffset=(bounds.top+bounds.bottom-ink.top-ink.bottom)/2;
 }
 return {rect:asRect(bounds),hasMath:!!element.querySelector('.katex'),inkOffset};
}
