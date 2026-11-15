import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import cytoscape,{type Core,type ElementDefinition} from 'cytoscape';
import {relationLabel,type KnowledgeEdge,type KnowledgeNode} from './graph-types';

type GraphPalette={
 ink:string;fill:string;taskFill:string;border:string;halo:string;
 focusFill:string;focusBorder:string;explicit:string;reference:string;embed:string;semantic:string;folder:string
};
/** Cytoscape accepts rgb()/rgba(), but not Astryx's light-dark() custom
 * property values. Let the browser resolve them in a temporary DOM probe. */
function readGraphPalette(host:HTMLElement):GraphPalette{
 const dark=document.documentElement.dataset.effectiveTheme==='dark';
 const fallback=(light:string,darkColor:string)=>dark?darkColor:light;
 const probe=document.createElement('span');
 probe.style.cssText='position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
 host.appendChild(probe);
 const color=(variable:string,fallback:string)=>{
  probe.style.color='var('+variable+', '+fallback+')';
  const computed=getComputedStyle(probe).color;
  return /^rgba?\(/.test(computed)?computed:fallback;
 };
 try{
  return {
   ink:color('--kg-node-ink',fallback('rgb(23,23,23)','rgb(245,245,245)')),
   fill:color('--kg-node-fill',fallback('rgb(237,242,248)','rgb(53,67,84)')),
   taskFill:color('--kg-node-task-fill',fallback('rgb(243,238,249)','rgb(68,58,83)')),
   border:color('--kg-node-border',fallback('rgb(167,184,203)','rgb(122,147,174)')),
   halo:color('--kg-label-halo',fallback('rgb(255,255,255)','rgb(38,38,38)')),
   focusFill:color('--kg-focus-fill',fallback('rgb(220,234,255)','rgb(41,67,95)')),
   focusBorder:color('--kg-focus-border',fallback('rgb(52,108,186)','rgb(173,208,255)')),
   explicit:color('--kg-edge-explicit',fallback('rgb(78,120,177)','rgb(154,196,255)')),
   reference:color('--kg-edge-reference',fallback('rgb(53,133,118)','rgb(124,214,187)')),
   embed:color('--kg-edge-embed',fallback('rgb(169,119,63)','rgb(226,180,107)')),
   semantic:color('--kg-edge-semantic',fallback('rgb(145,104,178)','rgb(211,168,255)')),
   folder:color('--kg-edge-folder',fallback('rgb(160,168,178)','rgb(135,147,165)'))
  };
 }finally{probe.remove();}
}
function graphStyles(colors:GraphPalette,compact:boolean):cytoscape.StylesheetJson{
 return [
  {selector:'node',style:{
   label:'data(label)','background-color':colors.fill,
   'border-width':2,'border-color':colors.border,'color':colors.ink,
   width:44,height:44,'font-size':compact?11:12,'font-weight':500,
   'text-valign':'bottom','text-margin-y':10,
   'text-outline-width':2,'text-outline-color':colors.halo,
   'text-max-width':compact?'86px':'125px','text-wrap':'ellipsis',
   'overlay-opacity':0,'transition-property':'background-color, border-color, opacity',
   'transition-duration':120
  }},
  {selector:'node.task-node',style:{shape:'round-rectangle',width:40,height:40,
   'background-color':colors.taskFill}},
  {selector:'node:selected',style:{'border-width':4,
   'border-color':colors.focusBorder,'background-color':colors.focusFill}},
  {selector:'edge',style:{'width':1.8,'line-color':colors.folder,
   'curve-style':'bezier','target-arrow-shape':'none','opacity':0.72}},
  {selector:'edge.explicit',style:{'line-color':colors.explicit,'width':2.8,
   'opacity':0.93,'target-arrow-shape':'triangle',
   'target-arrow-color':colors.explicit}},
  {selector:'edge.reference',style:{'line-color':colors.reference,'width':2.5,
   'opacity':0.95,'target-arrow-shape':'triangle','target-arrow-color':colors.reference}},
  {selector:'edge.embed',style:{'line-color':colors.embed,'width':2.8,
   'opacity':0.96,'target-arrow-shape':'triangle','target-arrow-color':colors.embed}},
  {selector:'edge.semantic',style:{'line-style':'dashed','line-color':colors.semantic,
   'opacity':0.92,'width':2}},
  {selector:'edge.folder',style:{'line-style':'dotted','line-color':colors.folder,
   'width':1.4,'opacity':0.55}},
  {selector:'.dimmed, .search-dimmed',style:{opacity:0.15}},
  {selector:'node.focus-node',style:{'border-color':colors.focusBorder,
   'border-width':3,'width':48,'height':48}}
 ];
}

/** Follow the shell's real viewport, which already excludes mobile navigation. */
export function useGraphViewHeight(){
 const ref=useRef<HTMLDivElement>(null),[height,setHeight]=useState<number>();
 useLayoutEffect(()=>{
  const page=ref.current,viewport=page?.closest<HTMLElement>('.main-scroll');if(!page||!viewport)return;
  let frame=0;
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const offset=page.getBoundingClientRect().top-viewport.getBoundingClientRect().top+viewport.scrollTop;
   setHeight(Math.max(260,Math.floor(viewport.clientHeight-offset-16)));
  });};
  const observer=new ResizeObserver(measure);observer.observe(viewport);if(page.parentElement)observer.observe(page.parentElement);
  window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);measure();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
 },[]);
 return {ref,height};
}

export function GraphCanvas({nodes,edges,selected,focusId,onSelect,cyRef,query,types,activation}:{
 nodes:KnowledgeNode[];edges:KnowledgeEdge[];selected:string|null;focusId?:string;
 onSelect:(id:string)=>void;cyRef:RefObject<Core|null>;query:string;types:KnowledgeEdge['type'][];activation:number;
}){
 const host=useRef<HTMLDivElement>(null),select=useRef(onSelect),laidOut=useRef(false);select.current=onSelect;
 useEffect(()=>{
  if(!host.current)return;
  const compact=matchMedia('(max-width:760px)').matches,initialPalette=readGraphPalette(host.current);
  const cy=cytoscape({container:host.current,minZoom:0.15,maxZoom:2.8,wheelSensitivity:0.23,
   boxSelectionEnabled:false,autounselectify:false,style:graphStyles(initialPalette,compact),layout:{name:'preset'}});
  cy.on('tap','node',event=>select.current(event.target.id()));
  cy.on('mouseover','node',event=>{if(host.current)host.current.title=event.target.data('label');});
  cy.on('mouseout','node',()=>{if(host.current)host.current.removeAttribute('title');});
  cyRef.current=cy;laidOut.current=false;
  let paletteSignature=JSON.stringify(initialPalette)+':'+compact,frame=0;
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   if(!host.current||cy.destroyed())return;
   const palette=readGraphPalette(host.current),condensed=matchMedia('(max-width:760px)').matches;
   const signature=JSON.stringify(palette)+':'+condensed;if(signature===paletteSignature)return;
   paletteSignature=signature;cy.style().fromJson(graphStyles(palette,condensed)).update();
  });};
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-effective-theme','style','class']});
  const systemTheme=matchMedia('(prefers-color-scheme: dark)'),compactScreen=matchMedia('(max-width:760px)');
  systemTheme.addEventListener('change',schedule);compactScreen.addEventListener('change',schedule);
  const resizeObserver=new ResizeObserver(()=>{cy.resize();schedule();});resizeObserver.observe(host.current);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();resizeObserver.disconnect();systemTheme.removeEventListener('change',schedule);compactScreen.removeEventListener('change',schedule);cyRef.current=null;cy.destroy();};
 },[cyRef]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy)return;
  const ids=new Set([...nodes.map(node=>node.id),...edges.map(edge=>edge.id)]);
  const additions:ElementDefinition[]=[];
  cy.batch(()=>{
   cy.elements().filter(element=>!ids.has(element.id())).remove();
   nodes.forEach((node,index)=>{
    const existing=cy.$id(node.id),classes=node.kind==='task_list'?'task-node':'document-node';
    if(existing.length){existing.data('label',node.name);existing.removeClass('task-node document-node').addClass(classes);}
    else{
     const edge=edges.find(edge=>edge.sourceId===node.id||edge.targetId===node.id);
     const neighbor=edge?cy.$id(edge.sourceId===node.id?edge.targetId:edge.sourceId):null;
     const center=neighbor?.length?neighbor.position():{x:cy.width()/2,y:cy.height()/2};
     const angle=index*2.399963;
     additions.push({group:'nodes',data:{id:node.id,label:node.name},classes,position:{x:center.x+150*Math.cos(angle),y:center.y+150*Math.sin(angle)}});
    }
   });
   cy.add(additions);
   for(const edge of edges){const existing=cy.$id(edge.id);if(existing.length)existing.data('label',relationLabel(edge.relation));else cy.add({group:'edges',data:{id:edge.id,source:edge.sourceId,target:edge.targetId,label:relationLabel(edge.relation)},classes:edge.type});}
   cy.nodes().removeClass('focus-node');if(focusId)cy.$id(focusId).addClass('focus-node');
  });
  if(!laidOut.current&&nodes.length){
   cy.layout({name:'cose',animate:false,fit:true,padding:40,nodeRepulsion:()=>12000,idealEdgeLength:()=>145,edgeElasticity:()=>90,numIter:650}).run();laidOut.current=true;
  }
 },[nodes,edges,focusId,cyRef]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy)return;
  const token=query.trim().toLocaleLowerCase();
  cy.batch(()=>{
   cy.elements().removeClass('dimmed search-dimmed');cy.nodes().unselect();
   cy.edges().forEach(edge=>{edge.style('display',types.some(type=>edge.hasClass(type))?'element':'none');});
   const node=selected?cy.$id(selected):null;
   if(node?.length){node.select();
    const connected=cy.collection().merge(node);for(const edge of node.connectedEdges().filter(edge=>edge.visible()))connected.merge(edge).merge(edge.connectedNodes());
    cy.elements().difference(connected).addClass('dimmed');
   }
   if(token){cy.nodes().filter(node=>!node.data('label').toLocaleLowerCase().includes(token)).addClass('search-dimmed');
    cy.edges().forEach(edge=>{if(edge.source().hasClass('search-dimmed')||edge.target().hasClass('search-dimmed'))edge.addClass('search-dimmed');});}
  });
 },[selected,query,types,nodes,edges,cyRef]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy||!selected||!activation)return;
  let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
   const node=cy.$id(selected),element=host.current;if(!node.length||!element||cy.destroyed())return;
   const bounds=element.getBoundingClientRect(),rail=element.closest('.workspace')?.querySelector<HTMLElement>('.workspace-panel-rail');
   const covered=rail?.querySelector('.workspace-panel:not([data-closing])');
   const width=covered?Math.max(120,Math.min(bounds.width,rail!.getBoundingClientRect().left-bounds.left-20)):bounds.width;
   const position=node.renderedPosition(),padding=46;
   const dx=Math.min(Math.max(position.x,padding),Math.max(padding,width-padding))-position.x;
   const dy=Math.min(Math.max(position.y,padding),Math.max(padding,cy.height()-padding-20))-position.y;
   if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
   cy.stop();const pan=cy.pan();cy.animate({pan:{x:pan.x+dx,y:pan.y+dy}},{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:240,easing:'ease-out-cubic'});
  });});
  return()=>cancelAnimationFrame(frame);
 },[selected,activation,nodes,cyRef]);
 return <div ref={host} className="knowledge-graph-canvas" aria-label="交互式文档关系图：单击节点查看详情，使用鼠标或触控拖动画布" role="img"/>;
}
