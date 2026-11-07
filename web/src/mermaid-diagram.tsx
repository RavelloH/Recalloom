import React,{useEffect,useState} from 'react';
import DOMPurify from 'dompurify';
import {AlertTriangle,Network} from 'lucide-react';

/** Mermaid stays a plain editable code fence. This is only its safe,
 * non-editable visualization; failures never replace the source text.
 */
let diagramCounter=0;
let enginePromise:Promise<typeof import('mermaid')>|undefined;
const getEngine=async()=>{
 enginePromise??=import('mermaid').then(mod=>{
  mod.default.initialize({
   startOnLoad:false,
   securityLevel:'strict',
   theme:'neutral',
   flowchart:{htmlLabels:false},
   suppressErrorRendering:true,
   maxTextSize:16000,
   deterministicIds:true
  });
  return mod;
 });
 return enginePromise;
};
export function isSafeMermaidSource(raw:string):boolean{
 if(raw.length>16000||!raw.trim())return false;
 // Generated SVG is displayed as an image, never inserted into the document DOM.
 // Document authors cannot change application-wide Mermaid security settings.
 if(/%%\{\s*(?:init|config|wrap)/i.test(raw))return false;
 return true;
}
export default function MermaidDiagram({code}:{code:string}){
 const [svg,setSvg]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{
  let alive=true;
  setSvg(null);setError(null);
  if(!isSafeMermaidSource(code)){setError('图表为空、过长或包含不允许的配置指令');return;}
  const id='rk-mermaid-'+(++diagramCounter);
  void (async()=>{
   try{
    const m=(await getEngine()).default;
    await m.parse(code);
    const rendered=await m.render(id,code);
    const clean=DOMPurify.sanitize(rendered.svg,{
     USE_PROFILES:{svg:true,svgFilters:true},
     FORBID_TAGS:['script','foreignObject','iframe','image','object','embed'],
     FORBID_ATTR:['onload','onerror','onclick','onmouseover']
    });
    if(alive){if(!clean.includes('<svg'))throw Error('Unsafe diagram');setSvg(clean);}
   }catch{
    if(alive)setError('无法渲染当前 Mermaid 图表，请检查源码语法');
   }
  })();
  return()=>{alive=false;};
 },[code]);
 return <div className="rk-mermaid" data-rk-mermaid="" contentEditable={false}>
  {svg?<div className="rk-mermaid-svg"><img src={"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)} alt="Mermaid 图表" draggable={false}/></div>
   :error?<div className="rk-mermaid-error"><AlertTriangle size={16} aria-hidden="true"/>{error}</div>
   :<div className="rk-mermaid-loading"><Network size={16} aria-hidden="true"/> 正在绘制图表…</div>}
 </div>;
}
