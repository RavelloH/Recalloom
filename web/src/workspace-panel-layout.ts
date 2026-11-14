export const PANEL_MIN_HEIGHT=160;
export const PANEL_COLLAPSED_HEIGHT=64;
export const PANEL_GAP=10;
export const PANEL_STACK_PEEK=64;

export type PanelLayoutInput={id:string;height:number;sequence:number;collapsed?:boolean;priority?:boolean};
export type PanelLayout={id:string;top:number;height:number;collapsed:boolean;exposedHeight:number};

/** Front-to-back overlapping cards, all anchored to the same bottom edge. */
export function calculatePanelLayout(panels:readonly PanelLayoutInput[],availableHeight:number,activeId?:string):PanelLayout[]{
 if(!panels.length)return [];
 const available=Number.isFinite(availableHeight)?Math.max(0,availableHeight):0;
 const entries=panels.map((panel,index)=>({
  ...panel,index,collapsed:!!panel.collapsed,
  height:Number.isFinite(panel.height)?Math.max(PANEL_MIN_HEIGHT,panel.height):PANEL_MIN_HEIGHT
 }));
 const peek=(panel:{collapsed:boolean})=>panel.collapsed?PANEL_COLLAPSED_HEIGHT:PANEL_STACK_PEEK;
 // Buckets make near-equality transitive. Effective heights below still
 // increase strictly, so a newer near-equal card remains in front.
 const sort=()=>entries.sort((a,b)=>Number(b.collapsed)-Number(a.collapsed)||
  (a.collapsed&&b.collapsed?0:Math.round(a.height/8)-Math.round(b.height/8))||b.sequence-a.sequence||a.index-b.index);
 const minimum=()=>sort().reduce((height,panel)=>Math.max(
  panel.collapsed?PANEL_COLLAPSED_HEIGHT:PANEL_MIN_HEIGHT,height+peek(panel)
 ),0);
 const retention=(panel:PanelLayoutInput)=>panel.id===activeId?2:panel.priority?1:0;
 const candidates=entries.filter(panel=>!panel.collapsed).sort((a,b)=>retention(a)-retention(b)||a.sequence-b.sequence||a.index-b.index);
 for(const panel of candidates){
  if(minimum()<=available)break;
  panel.collapsed=true;
 }
 const minimumHeight=minimum();
 // Once even the title bars cannot fit, share the remaining visible strip.
 const scale=minimumHeight>available?available/minimumHeight:1;
 let remainingPeek=entries.reduce((sum,panel)=>sum+peek(panel)*scale,0);
 let previousHeight=0;
 return entries.map(panel=>{
  remainingPeek-=peek(panel)*scale;
  const lower=Math.max((panel.collapsed?PANEL_COLLAPSED_HEIGHT:PANEL_MIN_HEIGHT)*scale,previousHeight+peek(panel)*scale);
  // Reserve only the rear cards' exposed headers, never their full heights.
  const upper=Math.max(0,available-remainingPeek);
  const requested=panel.collapsed?lower:panel.height;
  const height=Math.max(previousHeight,Math.min(available,upper,Math.max(lower,requested)));
  const layout={id:panel.id,top:available-height,height,collapsed:panel.collapsed,exposedHeight:height-previousHeight};
  previousHeight=height;
  return layout;
 });
}
