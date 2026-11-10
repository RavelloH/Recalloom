import {Icon} from './icon';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link,useNavigate,useSearch} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import cytoscape,{type Core,type ElementDefinition} from 'cytoscape';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Banner} from '@astryxdesign/core/Banner';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';

import {graphQuery} from './queries';
import {relationLabel,semanticMessage,type KnowledgeEdge,type KnowledgeNode} from './graph-types';

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
  {selector:'.dimmed',style:{opacity:0.15}},
  {selector:'node.focus-node',style:{'border-color':colors.focusBorder,
   'border-width':3,'width':48,'height':48}}
 ];
}

function GraphCanvas({nodes,edges,selected,onSelect,cyRef,query}:{
 nodes:KnowledgeNode[];edges:KnowledgeEdge[];selected:string|null;
 onSelect:(id:string)=>void;cyRef:React.RefObject<Core|null>;query:string
}){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!host.current)return;
  const compact=window.matchMedia('(max-width:760px)').matches;
  const initialPalette=readGraphPalette(host.current);
  const elements:ElementDefinition[]=[
   ...nodes.map(n=>({data:{id:n.id,label:n.name},classes:
    n.kind==='task_list'?'task-node':'document-node'})),
   ...edges.map(e=>({data:{id:e.id,source:e.sourceId,target:e.targetId,label:relationLabel(e.relation)},
    classes:e.type}))
  ];
  const cy=cytoscape({
   container:host.current,elements,
   minZoom:0.15,maxZoom:2.8,wheelSensitivity:0.23,
   boxSelectionEnabled:false,autounselectify:false,
   style:graphStyles(initialPalette,compact),
   layout:{name:'cose',animate:false,fit:true,padding:52,
    nodeRepulsion:()=>12000,idealEdgeLength:()=>145,edgeElasticity:()=>90,numIter:650}
  });
  cy.on('tap','node',event=>onSelect(event.target.id()));
  cyRef.current=cy;
  // Repaint colours when Astryx switches between light/dark/system themes.
  // Updating Cytoscape's stylesheet (instead of recreating the graph) keeps
  // pan, zoom, selected nodes and the computed layout intact.
  let paletteSignature=JSON.stringify(initialPalette)+':'+compact;
  let frame=0;
  const updateTheme=()=>{
   if(!host.current||cy.destroyed())return;
   const palette=readGraphPalette(host.current);
   const condensed=window.matchMedia('(max-width:760px)').matches;
   const signature=JSON.stringify(palette)+':'+condensed;
   if(signature===paletteSignature)return;
   paletteSignature=signature;
   cy.style().fromJson(graphStyles(palette,condensed)).update();
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(updateTheme);};
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-effective-theme','style','class']});
  const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
  const compactScreen=window.matchMedia('(max-width:760px)');
  systemTheme.addEventListener('change',schedule);
  compactScreen.addEventListener('change',schedule);
  const resizeObserver=new ResizeObserver(()=>{cy.resize();schedule();});
  resizeObserver.observe(host.current);
  return ()=>{
   cancelAnimationFrame(frame);
   observer.disconnect();resizeObserver.disconnect();
   systemTheme.removeEventListener('change',schedule);
   compactScreen.removeEventListener('change',schedule);
   cyRef.current=null;cy.destroy();
  };
 },[nodes,edges,onSelect,cyRef]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy)return;
  cy.nodes().unselect();
  if(selected&&cy.$id(selected).length)cy.$id(selected).select();
 },[selected,cyRef,nodes]);
 useEffect(()=>{
  const cy=cyRef.current;if(!cy)return;
  const token=query.trim().toLocaleLowerCase();
  cy.elements().removeClass('dimmed');
  if(token){
   cy.nodes().filter(n=>!n.data('label').toLocaleLowerCase().includes(token)).addClass('dimmed');
   cy.edges().forEach(e=>{if(e.source().hasClass('dimmed')||e.target().hasClass('dimmed'))e.addClass('dimmed');});
  }
 },[query,cyRef,nodes,edges]);
 return <div ref={host} className="knowledge-graph-canvas" aria-label="交互式文档关系图：单击节点查看详情，使用鼠标或触控拖动画布" role="img"/>;
}

export default function KnowledgeGraphPage(){
 const {focus}=useSearch({from:'/graph'});
 const nav=useNavigate();
 const [semantic,setSemantic]=useState(true);
 const [selected,setSelected]=useState<string|null>(null);
 const [filter,setFilter]=useState('');
 const cy=useRef<Core|null>(null);
 const result=useQuery(graphQuery(focus,semantic));
 const data=result.data;
 const nodes=data?.nodes??[],edges=data?.edges??[];
 const onSelect=React.useCallback((id:string)=>setSelected(id),[]);
 useEffect(()=>{setSelected(focus??null);},[focus]);
 const selectedNode=nodes.find(n=>n.id===selected)??null;
 const connections=useMemo(()=>selected?edges.filter(e=>e.sourceId===selected||e.targetId===selected):[],[edges,selected]);
 const list=filter.trim()?nodes.filter(n=>n.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())):nodes;
 const focusOn=async(id?:string)=>{
  if(id)await nav({to:'/graph',search:{focus:id}});
  else await nav({to:'/graph',search:{}});
 };
 const zoom=(multiplier:number)=>{const view=cy.current;if(view)view.zoom({level:Math.min(2.8,Math.max(0.15,view.zoom()*multiplier)),renderedPosition:{x:view.width()/2,y:view.height()/2}});};
 return <div className="page knowledge-graph-page">
  <header className="graph-page-heading"><div><h1><Icon name="relationGraph" inline/>知识关系网</h1>
   <p className="muted">明确关系由 D1 保存；紫色虚线表示语义相似建议，不会自动建立正式关联。</p></div>
   <div className="graph-page-buttons">
    {focus&&<Button size="sm" variant="secondary" label="返回概览" onClick={()=>void focusOn()}/>}
    <Button size="sm" variant="ghost" icon={<Icon name="refresh" size="sm"/>} label="刷新" onClick={()=>void result.refetch()}/>
   </div>
  </header>
  <div className="graph-controls">
   <TextInput label="查找图中节点" isLabelHidden size="sm" placeholder="搜索已加载的文档" value={filter} onChange={setFilter}/>
   <CheckboxInput label={focus?'语义关联':'语义关联（聚焦后启用）'} size="sm" value={semantic} onChange={setSemantic} isDisabled={!focus}/>
   <div className="graph-zoom">
    <Button size="sm" variant="ghost" label="缩小" icon={<Icon name="zoomOut" size="sm"/>} onClick={()=>zoom(0.8)}/>
    <Button size="sm" variant="ghost" label="放大" icon={<Icon name="zoomIn" size="sm"/>} onClick={()=>zoom(1.25)}/>
    <Button size="sm" variant="ghost" label="适应视图" icon={<Icon name="maximize" size="sm"/>} onClick={()=>cy.current?.fit(undefined,35)}/>
   </div>
  </div>
  {result.isError&&<Banner status="error" container="section" title="关系网加载失败" description={result.error.message}/>}
  {result.isPending?<div className="graph-loading" role="status">正在加载知识关系…</div>:
   data&&<div className="graph-workspace">
    <div className="graph-stage">
     <div className="graph-topline"><span>{focus?'以当前文档为中心':'最近更新的知识子图'} · {nodes.length} 个文档 / {edges.length} 条关联</span>
      <span className="graph-legend"><i data-relation="explicit"/>手动关联 <i data-relation="reference"/>正文引用 <i data-relation="embed"/>嵌入 <i data-relation="semantic"/>语义建议 <i data-relation="folder"/>同目录</span>
     </div>
     {nodes.length?
      <GraphCanvas nodes={nodes} edges={edges} selected={selected} onSelect={onSelect} cyRef={cy} query={filter}/>:
      <div className="graph-empty">知识库尚无可显示的记录。添加文档后即可查看关系网。</div>}
     <p className="graph-bottomline">{data.scope==='recent'?'默认仅显示最近的文档子图；选中文档并设为中心后，才能查询其语义相似候选。':'仅显示当前文档附近的有界子图。'} {data.scope==='local'?semanticMessage(data.semanticStatus):''}</p>
    </div>
    <aside className="graph-inspector" aria-label="选中节点详情">
     {selectedNode?<><div className="graph-inspector-top"><h2>{selectedNode.name}</h2>
       <span className="muted small">{selectedNode.kind==='task_list'?'任务列表':'Markdown 文档'}{selectedNode.status==='archived'?' · 已归档':''}</span></div>
       <p className="muted small">{selectedNode.folderName?'目录：'+selectedNode.folderName:'知识库根目录'}</p>
       <div className="graph-inspector-actions">
        <Link to="/records/$recordId" params={{recordId:selectedNode.id}} className="graph-open-link"><Icon name="arrowRight" size="sm"/>打开文档</Link>
        {selectedNode.id!==focus&&<Button size="sm" variant="secondary" label="以此为中心" onClick={()=>void focusOn(selectedNode.id)}/>}
       </div>
       <div className="relation-group-heading">直接关联 <span>{connections.length}</span></div>
       {connections.length?<div className="graph-neighbors">{connections.slice(0,24).map(e=>{
        const other=nodes.find(n=>n.id===(e.sourceId===selected?e.targetId:e.sourceId));
        return <button className="graph-neighbor" key={e.id} onClick={()=>other&&setSelected(other.id)}>
         {e.type==='semantic'?<Icon name="sparkles" size="sm"/>:e.type==='folder'?<Icon name="folder" size="sm"/>:<Icon name="link" size="sm"/>}
         <span className="truncate">{other?.name??'未知文档'}</span><small>{relationLabel(e.relation)}</small>
        </button>;
       })}</div>:<p className="muted small">当前图中暂无直接关联。可以从记录详情手动建立链接。</p>}
      </>:<div className="graph-inspector-top"><h2>选择文档</h2><p className="muted small">点击关系图中的节点，查看相连文档并展开。</p></div>}
     <div className="relation-group-heading">已加载文档 <span>{list.length}</span></div>
     <div className="graph-node-list">{list.slice(0,100).map(n=><button className={'graph-node-option'+(selected===n.id?' is-selected':'')}
      key={n.id} onClick={()=>setSelected(n.id)}>{n.kind==='task_list'?'☑':'◦'} <span className="truncate">{n.name}</span></button>)}</div>
    </aside>
   </div>}
 </div>;
}
