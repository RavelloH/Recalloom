/** Static hand-drawn annotation styles shared by Markdown and Tiptap.
 * Deterministic geometry; no animation or runtime library dependency.
 */
export const SKETCH_KINDS=['highlight','circle','box','bracket','underline','double-underline','dotted-underline','wavy','arrow'] as const;
export const SKETCH_BLOCK_KINDS=['highlight','circle','box','bracket','underline','double-underline'] as const;
export type SketchKind=typeof SKETCH_KINDS[number];
export const isSketchKind=(name:string):name is SketchKind=>(SKETCH_KINDS as readonly string[]).includes(name);
export const isSketchBlock=(name:string)=>(SKETCH_BLOCK_KINDS as readonly string[]).includes(name);
export type SketchOptions={kind:SketchKind;color?:string;stroke?:number;padding?:number;roughness?:number;opacity?:number};
export const SKETCH_PALETTE={
 red:'#d36568',orange:'#d79543',yellow:'#e2c044',green:'#5ba879',blue:'#5999db',
 purple:'#9c81d0',pink:'#d777ac',cyan:'#4aadc6',teal:'#50a79a'
} as const;
export type SketchColor=keyof typeof SKETCH_PALETTE;
export const SKETCH_DEFAULT_COLORS:Record<SketchKind,SketchColor>={
 highlight:'yellow',circle:'cyan',box:'orange',bracket:'purple',
 underline:'blue','double-underline':'teal','dotted-underline':'blue',wavy:'purple',arrow:'blue'
};
export function parseSketchNumber(value:unknown,kind:'stroke'|'padding'|'roughness'|'opacity'):number|undefined{
 if(value===null||value===undefined||value==='')return undefined;
 const text=String(value);
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))return undefined;
 const number=Number(text);
 const limits={stroke:[.5,6],padding:[0,24],roughness:[0,3],opacity:[.1,.85]} as const;
 const [lo,hi]=limits[kind];
 return Number.isFinite(number)&&number>=lo&&number<=hi?number:undefined;
}
export const sketchAttrs=(kind:SketchKind,attributes:Record<string,string>)=>({
 kind,
 color:attributes.color||null,
 stroke:parseSketchNumber(attributes.stroke,'stroke')??null,
 padding:parseSketchNumber(attributes.padding,'padding')??null,
 roughness:parseSketchNumber(attributes.roughness,'roughness')??null,
 opacity:parseSketchNumber(attributes.opacity,'opacity')??null
});
export const isSketchColor=(v:string):v is SketchColor=>Object.hasOwn(SKETCH_PALETTE,v);
export function sketchSeed(s:string):number{
 let h=2166136261;
 for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
 return h>>>0;
}
export type SketchPath={d:string;fill?:boolean;dash?:string};
const round=(n:number)=>Number(n.toFixed(2));
/** Pure paths in local CSS pixel SVG coordinates; dimensions include padding. */
export function sketchPaths(kind:SketchKind,width:number,height:number,seed=1,roughness=1,hasMath=false):SketchPath[]{
 const w=Math.max(4,width),h=Math.max(4,height),r=Math.max(0,Math.min(3,roughness));
 let state=seed>>>0;
 const noise=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296-.5;};
 const jig=(v:number,m=1)=>round(v+noise()*r*m);
 const x0=2,y0=2,x1=w-2,y1=h-2;
 const line=(start:number,end:number,y:number,offset=0)=>{
  const sections=Math.max(2,Math.ceil((end-start)/27)),parts=['M '+round(start)+' '+jig(y,2)];
  for(let i=1;i<=sections;i++){const x=start+(end-start)*i/sections;parts.push('L '+round(x)+' '+jig(y+offset*Math.sin(i*1.7),2));}
  return parts.join(' ');
 };
 if(kind==='highlight'){
  // Ordinary text keeps a lighter highlighter stripe. Fractions, roots and
  // integrals can exceed KaTeX's outer line box; cover the whole measured
  // glyph height instead of painting only a narrow middle strip.
  const top=hasMath?2:h*.29,bottom=hasMath?h-2:h*.86;
  const variation=hasMath?1:3;
  return [{d:'M '+jig(x0,hasMath?1:2)+' '+jig(top,variation)+' L '+jig(x1,hasMath?1:2)+' '+jig(top-1,variation)+' L '+jig(x1,hasMath?1:2)+' '+jig(bottom,variation)+' L '+jig(x0,hasMath?1:2)+' '+jig(bottom+1,variation)+' Z',fill:true}];
 }
 if(kind==='circle'){
  const cx=w/2,cy=h/2,rx=Math.max(1,w/2-2),ry=Math.max(1,h/2-2);
  const pieces=32,coords:string[]=[];
  for(let i=0;i<=pieces;i++){
   const a=i/pieces*2*Math.PI;
   const x=cx+Math.cos(a)*rx+noise()*r*1.25;
   const y=cy+Math.sin(a)*ry+noise()*r*1.15;
   coords.push((i?'L ':'M ')+round(x)+' '+round(y));
  }
  return [{d:coords.join(' ')+' Z'}];
 }
 if(kind==='box'){
  return [{d:'M '+jig(x0,1)+' '+jig(y0,1)+' Q '+jig(w/2,2)+' '+jig(y0-1,3)+' '+jig(x1,1)+' '+jig(y0,1)+' L '+jig(x1,1)+' '+jig(y1,2)+' Q '+jig(w/2,2)+' '+jig(y1+1,3)+' '+jig(x0,1)+' '+jig(y1,1)+' Z'}];
 }
 if(kind==='bracket'){
  const cy=h/2;
  return [
   {d:'M '+jig(7,1)+' '+jig(y0,1)+' Q '+jig(x0,2)+' '+jig(h*.25,2)+' '+jig(7,2)+' '+jig(cy,1)+' Q '+jig(x0,2)+' '+jig(h*.75,2)+' '+jig(7,2)+' '+jig(y1,1)},
   {d:'M '+jig(w-7,1)+' '+jig(y0,1)+' Q '+jig(w-2,2)+' '+jig(h*.25,2)+' '+jig(w-7,2)+' '+jig(cy,1)+' Q '+jig(w-2,2)+' '+jig(h*.75,2)+' '+jig(w-7,2)+' '+jig(y1,1)}
  ];
 }
 const base=h-3;
 if(kind==='underline')return [{d:line(x0,x1,base)}];
 if(kind==='double-underline')return [{d:line(x0,x1,h-6)},{d:line(x0,x1,h-2)}];
 if(kind==='dotted-underline')return [{d:line(x0,x1,base),dash:'1 5'}];
 if(kind==='wavy'){
  const p=['M '+x0+' '+round(base-1)],steps=Math.max(2,Math.ceil((w-4)/5));
  for(let i=1;i<=steps;i++){
   const x=x0+(w-4)*i/steps;
   p.push('L '+round(x)+' '+round(base-1+Math.sin(i*1.35)*2.5+noise()*r*.6));
  }
  return [{d:p.join(' ')}];
 }
 return [{d:line(x0,x1-7,h-5)},{d:'M '+jig(x1-12,1)+' '+jig(h-10,1)+' L '+jig(x1-2,1)+' '+jig(h-5,1)+' L '+jig(x1-12,1)+' '+jig(h-1,1)}];
}
