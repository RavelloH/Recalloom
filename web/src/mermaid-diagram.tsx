import React,{useEffect,useState} from 'react';
import DOMPurify from 'dompurify';
import {IconAlertTriangle,IconTopologyStar3} from '@tabler/icons-react';

type DiagramTheme='light'|'dark';
/** Mermaid is a derived image, never editable HTML or persisted Markdown.
 * Its global renderer is serialized so multiple diagrams cannot change
 * one another's theme during a render. */
let diagramCounter=0;
let enginePromise:Promise<typeof import('mermaid')>|undefined;
let renderQueue=Promise.resolve();
const getEngine=()=>enginePromise??=import('mermaid');

const currentTheme=():DiagramTheme=>
 typeof document!=='undefined'&&document.documentElement.dataset.effectiveTheme==='dark'?'dark':'light';

const themePalette=(mode:DiagramTheme)=>{
 const dark=mode==='dark';
 const ink=dark?'#eef2f7':'#1c2835';
 const surface=dark?'#171b22':'#f6f8fa';
 return {
  background:surface,
  fontFamily:'Inter, system-ui, sans-serif',
  primaryColor:dark?'#273646':'#e7eef5',
  primaryTextColor:ink,
  primaryBorderColor:dark?'#92a8bb':'#65788d',
  secondaryColor:dark?'#2b3e45':'#deedf0',
  secondaryTextColor:ink,
  secondaryBorderColor:dark?'#8baeb7':'#769da5',
  tertiaryColor:dark?'#39334a':'#f0e9f6',
  tertiaryTextColor:ink,
  tertiaryBorderColor:dark?'#a99cbb':'#9887ac',
  textColor:ink,
  lineColor:dark?'#b7c7d7':'#5b6c7c',
  mainBkg:dark?'#273646':'#e7eef5',
  nodeBorder:dark?'#92a8bb':'#65788d',
  clusterBkg:dark?'#222c37':'#f1f4f8',
  clusterBorder:dark?'#6a7e91':'#97a5b5',
  edgeLabelBackground:surface,
  actorBkg:dark?'#273646':'#e7eef5',
  actorBorder:dark?'#92a8bb':'#65788d',
  actorTextColor:ink
 };
};
const renderDiagram=(id:string,source:string,theme:DiagramTheme)=>{
 const job=renderQueue.then(async()=>{
  const mermaid=(await getEngine()).default;
  mermaid.initialize({
   startOnLoad:false,
   securityLevel:'strict',
   theme:'base',
   themeVariables:themePalette(theme),
   flowchart:{htmlLabels:false},
   htmlLabels:false,
   suppressErrorRendering:true,
   maxTextSize:16000,
   deterministicIds:true
  });
  await mermaid.parse(source);
  return (await mermaid.render(id,source)).svg;
 });
 renderQueue=job.then(()=>{},()=>{});
 return job;
};
export function isSafeMermaidSource(raw:string):boolean{
 if(raw.length>16000||!raw.trim())return false;
 // Generated SVG is displayed as an image, never inserted into document DOM.
 // Authors may not override application security settings or diagram theme.
 if(/%%\{\s*(?:init|config|wrap)/i.test(raw))return false;
 return true;
}
export default function MermaidDiagram({code}:{code:string}){
 const [theme,setTheme]=useState<DiagramTheme>(currentTheme);
 const [svg,setSvg]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{
  const root=document.documentElement;
  const observer=new MutationObserver(()=>{
   const next=currentTheme();
   setTheme(previous=>previous===next?previous:next);
  });
  observer.observe(root,{attributes:true,attributeFilter:['data-effective-theme']});
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  let alive=true;
  setSvg(null);setError(null);
  if(!isSafeMermaidSource(code)){
   setError('图表为空、过长或包含不允许的配置指令');return;
  }
  const id='rk-mermaid-'+(++diagramCounter);
  void (async()=>{
   try{
    const raw=await renderDiagram(id,code,theme);
    const clean=DOMPurify.sanitize(raw,{
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
 },[code,theme]);
 return <div className="rk-mermaid" data-rk-mermaid="" data-rk-diagram-theme={theme} contentEditable={false}>
  {svg?<div className="rk-mermaid-svg"><img src={"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)} alt="Mermaid 图表" draggable={false}/></div>
   :error?<div className="rk-mermaid-error"><IconAlertTriangle size="1.125em" aria-hidden="true"/>{error}</div>
   :<div className="rk-mermaid-loading"><IconTopologyStar3 size="1.125em" aria-hidden="true"/> 正在绘制图表…</div>}
 </div>;
}
