import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import cytoscape,{type Core,type ElementDefinition} from 'cytoscape';
import {relationLabel,type KnowledgeEdge,type KnowledgeNode} from './graph-types';
import {arrangeGraph} from './graph-layout';

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
   width:34,height:34,'font-size':compact?12:14,'font-weight':500,'text-opacity':0,
   'text-valign':'bottom','text-margin-y':10,
   'text-outline-width':2,'text-outline-color':colors.halo,
   'text-max-width':compact?'86px':'125px','text-wrap':'ellipsis',
   'overlay-opacity':0,'transition-property':'background-color, border-color, opacity, text-opacity',
   'transition-duration':120
  }},
  {selector:'node.task-node',style:{shape:'round-rectangle',
   'background-color':colors.taskFill}},
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
  {selector:'node.context-node',style:{width:28,height:28,opacity:.65}},
  {selector:'edge.context-edge',style:{opacity:.12}},
  {selector:'node.label-visible',style:{'text-opacity':1}},
  {selector:'node.neighbor-node',style:{width:40,height:40,'font-size':compact?14:16}},
  {selector:'.dimmed, .search-dimmed',style:{opacity:0.24}},
  {selector:'node.focus-node',style:{'border-color':colors.focusBorder,
   'border-width':3,'width':50,'height':50,'text-opacity':1,'font-size':18,'font-weight':700}},
  {selector:'node.inspected-node, node.hovered-node',style:{'border-width':4,'text-opacity':1,
   'border-color':colors.focusBorder,'background-color':colors.focusFill,'z-index':10}}
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

export function GraphCanvas({nodes,edges,selected,focusId,onSelect,cyRef,query,types,activation,viewportReady}:{
 nodes:KnowledgeNode[];edges:KnowledgeEdge[];selected:string|null;focusId?:string;
 onSelect:(id:string)=>void;cyRef:RefObject<Core|null>;query:string;types:KnowledgeEdge['type'][];activation:number;viewportReady:boolean;
}){
 const host=useRef<HTMLDivElement>(null),select=useRef(onSelect);select.current=onSelect;
 const labels=useRef<()=>void>(()=>{});
 const layoutAnimation=useRef<cytoscape.Layouts|null>(null);
 const fitted=useRef(false);
 const layout=useRef({signature:'',focusId:focusId as string|undefined,ready:false});
 type View={pan:{x:number;y:number};zoom:number};
 const reveal=useRef<{before:View;expected:View}|null>(null),lastFocus=useRef(focusId);
 useEffect(()=>{
  if(!host.current)return;
  const element=host.current,compact=matchMedia('(max-width:760px)').matches,initialPalette=readGraphPalette(element);
  // Normalize pixel/line/page deltas before Cytoscape's device calibration,
  // which otherwise makes the first several mouse-wheel steps almost inert.
  const wheel=(event:WheelEvent)=>{
   const view=cyRef.current;if(!view||!event.deltaY)return;
   event.preventDefault();event.stopImmediatePropagation();
   const unit=event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1;
   const delta=Math.max(-180,Math.min(180,event.deltaY*unit)),bounds=element.getBoundingClientRect();
   view.stop();view.zoom({level:Math.max(.15,Math.min(2.8,view.zoom()*Math.exp(-delta*.0025))),
    renderedPosition:{x:event.clientX-bounds.left,y:event.clientY-bounds.top}});
  };
  element.addEventListener('wheel',wheel,{passive:false,capture:true});
  const cy=cytoscape({container:element,minZoom:0.15,maxZoom:2.8,
   boxSelectionEnabled:false,autounselectify:true,style:graphStyles(initialPalette,compact),layout:{name:'preset'}});
  cy.on('tap','node',event=>select.current(event.target.id()));
  cy.on('mouseover','node',event=>{event.target.addClass('hovered-node');if(host.current)host.current.title=event.target.data('label');});
  cy.on('mouseout','node',event=>{event.target.removeClass('hovered-node');if(host.current)host.current.removeAttribute('title');});
  let labelFrame=0;const measurement=document.createElement('canvas').getContext('2d');
  const scheduleLabels=()=>{cancelAnimationFrame(labelFrame);labelFrame=requestAnimationFrame(()=>{
   if(cy.destroyed())return;
   const zoom=cy.zoom(),occupied:Array<{left:number;right:number;top:number;bottom:number}>=[];
   const priority=(node:cytoscape.NodeSingular)=>node.hasClass('focus-node')?0:node.hasClass('neighbor-node')?1:node.hasClass('prominent-node')?2:3;
   const candidates=cy.nodes().toArray().sort((a,b)=>priority(a)-priority(b)||a.id().localeCompare(b.id()));
   cy.batch(()=>{for(const node of candidates){
    const important=priority(node)<2,font=node.hasClass('focus-node')?18:important?14:12;
    const point=node.renderedPosition(),label=String(node.data('label'));
    if(measurement)measurement.font=node.style('font-weight')+' '+font+'px '+node.style('font-family');
    const width=Math.min(130,measurement?.measureText(label).width??label.length*font);
    const top=point.y+node.renderedHeight()/2+10*zoom;
    const box={left:point.x-width/2-5,right:point.x+width/2+5,top:top-3,bottom:top+font*1.4+3};
    const fits=!occupied.some(other=>box.left<other.right&&box.right>other.left&&box.top<other.bottom&&box.bottom>other.top);
    const inside=box.left>=4&&box.right<=cy.width()-4&&box.top>=4&&box.bottom<=cy.height()-45;
    const visible=priority(node)===0||fits&&inside;
    node.toggleClass('label-visible',visible);
    node.style({'font-size':font/zoom,'text-max-width':130/zoom});
    if(visible)occupied.push(box);
   }});
  });};
  labels.current=scheduleLabels;cy.on('zoom layoutstop',scheduleLabels);
  cyRef.current=cy;layout.current={signature:'',focusId:undefined,ready:false};fitted.current=false;
  let paletteSignature=JSON.stringify(initialPalette)+':'+compact,frame=0;
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   if(!host.current||cy.destroyed())return;
   const palette=readGraphPalette(host.current),condensed=matchMedia('(max-width:760px)').matches;
   const signature=JSON.stringify(palette)+':'+condensed;if(signature===paletteSignature)return;
   paletteSignature=signature;cy.style().fromJson(graphStyles(palette,condensed)).update();scheduleLabels();
  });};
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-effective-theme','style','class']});
  const systemTheme=matchMedia('(prefers-color-scheme: dark)'),compactScreen=matchMedia('(max-width:760px)');
  systemTheme.addEventListener('change',schedule);compactScreen.addEventListener('change',schedule);
  const resizeObserver=new ResizeObserver(()=>{cy.resize();schedule();});resizeObserver.observe(host.current);
  return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(labelFrame);labels.current=()=>{};element.removeEventListener('wheel',wheel,true);observer.disconnect();resizeObserver.disconnect();systemTheme.removeEventListener('change',schedule);compactScreen.removeEventListener('change',schedule);cyRef.current=null;cy.destroy();};
 },[cyRef]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy)return;
  const arrangement=arrangeGraph(nodes,edges,focusId);
  const ids=new Set([...nodes.map(node=>node.id),...edges.map(edge=>edge.id)]);
  const additions:ElementDefinition[]=[];
  cy.batch(()=>{
   cy.elements().filter(element=>!ids.has(element.id())).remove();
   nodes.forEach(node=>{
    const existing=cy.$id(node.id),classes=node.kind==='task_list'?'task-node':'document-node';
    if(existing.length){existing.data('label',node.name);existing.removeClass('task-node document-node').addClass(classes);}
    else{
     additions.push({group:'nodes',data:{id:node.id,label:node.name},classes,position:arrangement.positions.get(node.id)});
    }
   });
   cy.add(additions);
   for(const edge of edges){const existing=cy.$id(edge.id);if(existing.length)existing.data('label',relationLabel(edge.relation));else cy.add({group:'edges',data:{id:edge.id,source:edge.sourceId,target:edge.targetId,label:relationLabel(edge.relation)},classes:edge.type});}
   const prominent=new Set(nodes.slice(0,8).map(node=>node.id));
   cy.nodes().forEach(node=>{
    node.toggleClass('focus-node',node.id()===focusId);
    node.toggleClass('neighbor-node',arrangement.neighbors.has(node.id()));
    node.toggleClass('context-node',Boolean(focusId&&node.id()!==focusId&&!arrangement.neighbors.has(node.id())));
    node.toggleClass('prominent-node',!focusId&&prominent.has(node.id()));
   });
   cy.edges().forEach(edge=>{edge.toggleClass('context-edge',Boolean(focusId&&edge.source().id()!==focusId&&edge.target().id()!==focusId));});
  });
  const signature=JSON.stringify([focusId,[...arrangement.positions]]),previous=layout.current;
  if(nodes.length&&previous.signature!==signature){
   const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:320;
   layoutAnimation.current?.stop();
   const nextLayout=cy.layout({name:'preset',positions:Object.fromEntries(arrangement.positions),animate:previous.ready&&fitted.current&&duration>0,
    animationDuration:duration,animationEasing:'ease-out-cubic',fit:false});
   layoutAnimation.current=nextLayout;nextLayout.run();
   if(fitted.current&&previous.focusId!==focusId){
    cy.stop();
    // New centers occupy the origin; keep zoom and make the camera follow them.
    const zoom=Math.max(.65,Math.min(1.15,cy.zoom()));
    cy.animate({zoom,pan:{x:cy.width()/2,y:cy.height()/2}},{duration,easing:'ease-out-cubic'});
   }
   layout.current={signature,focusId,ready:true};
  }
  // The route measures its viewport on the first frame. A cached API response
  // can arrive sooner (notably WebKit); never fit a zero-height canvas.
  if(viewportReady&&!fitted.current&&nodes.length){
   cy.resize();cy.stop();cy.fit(undefined,40);
   if(cy.zoom()>1.15)cy.zoom({level:1.15,renderedPosition:{x:cy.width()/2,y:cy.height()/2}});
   if(focusId)cy.pan({x:cy.width()/2,y:cy.height()/2});
   fitted.current=true;
  }
  labels.current();
 },[nodes,edges,focusId,cyRef,viewportReady]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy)return;
  const token=query.trim().toLocaleLowerCase();
  cy.batch(()=>{
   cy.elements().removeClass('dimmed search-dimmed inspected-node');
   cy.edges().forEach(edge=>{edge.style('display',types.some(type=>edge.hasClass(type))?'element':'none');});
   const node=selected?cy.$id(selected):null;
   if(node?.length){node.addClass('inspected-node');
    const connected=cy.collection().merge(node);for(const edge of node.connectedEdges().filter(edge=>edge.visible()))connected.merge(edge).merge(edge.connectedNodes());
    cy.elements().difference(connected).addClass('dimmed');
   }
   if(token){cy.nodes().filter(node=>!node.data('label').toLocaleLowerCase().includes(token)).addClass('search-dimmed');
    cy.edges().forEach(edge=>{if(edge.source().hasClass('search-dimmed')||edge.target().hasClass('search-dimmed'))edge.addClass('search-dimmed');});}
  });
 },[selected,query,types,nodes,edges,cyRef]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy)return;
  if(lastFocus.current!==focusId){lastFocus.current=focusId;reveal.current=null;return;}
  if(!selected){
   const saved=reveal.current;reveal.current=null;if(!saved)return;
   const pan=cy.pan(),expected=saved.expected;
   // Preserve any subsequent manual pan/zoom. Only undo our own reveal movement.
   if(Math.abs(pan.x-expected.pan.x)<1&&Math.abs(pan.y-expected.pan.y)<1&&Math.abs(cy.zoom()-expected.zoom)<.001){
    cy.stop();cy.animate(saved.before,{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:240,easing:'ease-out-cubic'});
   }
   return;
  }
  if(!activation)return;
  let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
   const node=cy.$id(selected),element=host.current;if(!node.length||!element||cy.destroyed())return;
   const bounds=element.getBoundingClientRect(),rail=element.closest('.workspace')?.querySelector<HTMLElement>('.workspace-panel-rail');
   const covered=rail?.querySelector('.workspace-panel:not([data-closing])');
   const width=covered?Math.max(120,Math.min(bounds.width,rail!.getBoundingClientRect().left-bounds.left-20)):bounds.width;
   const position=node.renderedPosition(),padding=46;
   const dx=Math.min(Math.max(position.x,padding),Math.max(padding,width-padding))-position.x;
   const dy=Math.min(Math.max(position.y,padding),Math.max(padding,cy.height()-padding-20))-position.y;
   if(!reveal.current){const view={pan:{...cy.pan()},zoom:cy.zoom()};reveal.current={before:view,expected:view};}
   if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
   cy.stop();const pan=cy.pan(),target={x:pan.x+dx,y:pan.y+dy};reveal.current.expected={pan:target,zoom:cy.zoom()};
   cy.animate({pan:target},{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:240,easing:'ease-out-cubic'});
  });});
  return()=>cancelAnimationFrame(frame);
 },[selected,activation,focusId,cyRef]);
 return <div ref={host} className="knowledge-graph-canvas" aria-label="交互式文档关系图：单击文稿设为中心，使用鼠标或触控拖动画布" role="img"/>;
}
