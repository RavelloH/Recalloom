import {PANEL_COLLAPSED_HEIGHT,PANEL_MIN_HEIGHT} from './workspace-panel-layout';

export type PanelDragInput={dx:number;dy:number;height:number;top:number;minHeight?:number;collapsed?:boolean};

/** Apply both drag axes together while preserving the panel's bottom edge. */
export function calculatePanelDrag({dx,dy,height,top,minHeight,collapsed}:PanelDragInput){
 const minimum=Math.min(minHeight??(collapsed?PANEL_COLLAPSED_HEIGHT:PANEL_MIN_HEIGHT),height);
 const appliedY=Math.max(-top,Math.min(height-minimum,dy));
 return {
  dx:dx<0?-24*Math.abs(dx)/(Math.abs(dx)+64):dx,
  dy:appliedY,
  height:height-appliedY,
  top:top+appliedY
 };
}
