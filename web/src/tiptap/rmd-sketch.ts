import {Mark,mergeAttributes} from '@tiptap/core';
import {isSketchKind,parseSketchNumber} from '../sketch-geometry';

/** Native editable mark. No React NodeView inside inline text or math atoms.
 * The shared outside-editor SVG layer draws this span in both modes.
 */
export const RmdSketchMark=Mark.create({
 name:'rmdSketch',
 priority:1850,
 inclusive:false,
 addAttributes(){
  return {
   kind:{default:'highlight',parseHTML:(el:HTMLElement)=>el.dataset.rkSketchKind??'highlight'},
   color:{default:null,parseHTML:(el:HTMLElement)=>el.dataset.rkSketchColor??null},
   stroke:{default:null,parseHTML:(el:HTMLElement)=>parseSketchNumber(el.dataset.rkSketchStroke,'stroke')??null},
   padding:{default:null,parseHTML:(el:HTMLElement)=>parseSketchNumber(el.dataset.rkSketchPadding,'padding')??null},
   roughness:{default:null,parseHTML:(el:HTMLElement)=>parseSketchNumber(el.dataset.rkSketchRoughness,'roughness')??null},
   opacity:{default:null,parseHTML:(el:HTMLElement)=>parseSketchNumber(el.dataset.rkSketchOpacity,'opacity')??null},
  };
 },
 parseHTML(){return [{tag:'span[data-rk-sketch-kind]'}];},
 renderHTML({HTMLAttributes}){
  const {kind,color,stroke,padding,roughness,opacity}=HTMLAttributes as Record<string,unknown>;
  if(!isSketchKind(String(kind)))return ['span',0];
  const props:Record<string,string>={
   class:'rk-sketch-inline',
   'data-rk-sketch-kind':String(kind)
  };
  for(const [key,val] of Object.entries({color,stroke,padding,roughness,opacity}))
   if(val!==null&&val!==undefined&&val!=='')props['data-rk-sketch-'+key]=String(val);
  return ['span',mergeAttributes(props),0];
 }
});
