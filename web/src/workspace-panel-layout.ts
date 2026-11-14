export const PANEL_MIN_HEIGHT=160;
export const PANEL_COLLAPSED_HEIGHT=44;
export const PANEL_GAP=10;

export type PanelLayoutInput={id:string;height:number;sequence:number;collapsed?:boolean;priority?:boolean};
export type PanelLayout={id:string;top:number;height:number;collapsed:boolean};

/** Stack panels against the bottom edge without changing their requested sizes. */
export function calculatePanelLayout(panels:readonly PanelLayoutInput[],availableHeight:number,activeId?:string):PanelLayout[]{
 if(!panels.length)return [];
 const available=Number.isFinite(availableHeight)?Math.max(0,availableHeight):0;
 const entries=panels.map((panel,index)=>({
  ...panel,index,collapsed:!!panel.collapsed,
  height:Number.isFinite(panel.height)?Math.max(PANEL_MIN_HEIGHT,panel.height):PANEL_MIN_HEIGHT
 }));
 const gapTotal=PANEL_GAP*(entries.length-1);
 const minimum=()=>entries.reduce((sum,panel)=>sum+(panel.collapsed?PANEL_COLLAPSED_HEIGHT:PANEL_MIN_HEIGHT),gapTotal);
 const retention=(panel:PanelLayoutInput)=>panel.id===activeId?2:panel.priority?1:0;
 const candidates=entries.filter(panel=>!panel.collapsed).sort((a,b)=>retention(a)-retention(b)||a.sequence-b.sequence||a.index-b.index);
 for(const panel of candidates){
  if(minimum()<=available)break;
  panel.collapsed=true;
 }
 for(const panel of entries)if(panel.collapsed)panel.height=PANEL_COLLAPSED_HEIGHT;
 const requested=entries.reduce((sum,panel)=>sum+panel.height,gapTotal);
 if(requested>available){
  const slack=entries.reduce((sum,panel)=>sum+(panel.collapsed?0:panel.height-PANEL_MIN_HEIGHT),0);
  if(slack>0){
   const retain=Math.max(0,1-(requested-available)/slack);
   for(const panel of entries)if(!panel.collapsed)panel.height=PANEL_MIN_HEIGHT+(panel.height-PANEL_MIN_HEIGHT)*retain;
  }
 }
 // Fixed height buckets provide a transitive, deterministic near-equality order.
 entries.sort((a,b)=>Number(b.collapsed)-Number(a.collapsed)||
  Math.round(a.height/8)-Math.round(b.height/8)||b.sequence-a.sequence||a.index-b.index);
 // Below the height of all title bars, reduce gaps first and then title bars.
 const heights=entries.reduce((sum,panel)=>sum+panel.height,0);
 const gap=entries.length>1?Math.min(PANEL_GAP,Math.max(0,(available-heights)/(entries.length-1))):0;
 const scale=heights>0?Math.min(1,Math.max(0,(available-gap*(entries.length-1))/heights)):0;
 const used=heights*scale+gap*(entries.length-1);
 let top=Math.max(0,available-used);
 return entries.map(panel=>{
  const height=Math.min(panel.height*scale,Math.max(0,available-top));
  const layout={id:panel.id,top,height,collapsed:panel.collapsed};
  top+=height+gap;
  return layout;
 });
}
