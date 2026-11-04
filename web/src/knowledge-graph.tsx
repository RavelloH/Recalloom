import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link,useNavigate,useSearch} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import cytoscape,{type Core,type ElementDefinition} from 'cytoscape';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Banner} from '@astryxdesign/core/Banner';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {Network,ZoomIn,ZoomOut,Maximize2,ArrowRight,Sparkles,Link2,Folder,RefreshCw} from 'lucide-react';
import {graphQuery} from './queries';
import {relationLabel,semanticMessage,type KnowledgeEdge,type KnowledgeNode} from './graph-types';

function GraphCanvas({nodes,edges,selected,onSelect,cyRef,query}:{
 nodes:KnowledgeNode[];edges:KnowledgeEdge[];selected:string|null;
 onSelect:(id:string)=>void;cyRef:React.RefObject<Core|null>;query:string
}){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!host.current)return;
  const styles=getComputedStyle(host.current);
  const foreground=styles.getPropertyValue('--color-text-primary').trim()||'#202124';
  const muted=styles.getPropertyValue('--color-text-secondary').trim()||'#6f7681';
  const surface=styles.getPropertyValue('--color-background-surface').trim()||'#dfe8f4';
  const border=styles.getPropertyValue('--color-border').trim()||'#9ca3af';
  const compact=window.matchMedia('(max-width:760px)').matches;
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
   style:[
    {selector:'node',style:{label:'data(label)','background-color':surface,
     'border-width':1.5,'border-color':border,'color':foreground,
     width:40,height:40,'font-size':compact?10:11,'text-valign':'bottom','text-margin-y':9,
     'text-outline-width':0,'text-max-width':compact?'86px':'115px','text-wrap':'ellipsis',
     'overlay-opacity':0,'transition-property':'background-color, border-color, opacity',
     'transition-duration':120}},
    {selector:'node.task-node',style:{shape:'round-rectangle',width:36,height:36}},
    {selector:'node:selected',style:{'border-width':4,'border-color':'#447bd6','background-color':'#dbeafe'}},
    {selector:'edge',style:{'width':1.7,'line-color':border,'curve-style':'bezier',
     'target-arrow-shape':'none','opacity':0.74}},
    {selector:'edge.explicit',style:{'line-color':'#5e80b5','width':2.7,
     'target-arrow-shape':'triangle','target-arrow-color':'#5e80b5'}},
    {selector:'edge.semantic',style:{'line-style':'dashed','line-color':'#aa83c9','width':1.6}},
    {selector:'edge.folder',style:{'line-style':'dotted','line-color':muted,'width':1.2,'opacity':0.35}},
    {selector:'.dimmed',style:{opacity:0.15}},
    {selector:'node.focus-node',style:{'border-color':'#447bd6','border-width':3,'width':48,'height':48}}
   ],
   layout:{name:'cose',animate:false,fit:true,padding:52,
    nodeRepulsion:()=>12000,idealEdgeLength:()=>145,edgeElasticity:()=>90,numIter:650}
  });
  cy.on('tap','node',event=>onSelect(event.target.id()));
  cyRef.current=cy;
  return ()=>{cyRef.current=null;cy.destroy();};
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
  <header className="graph-page-heading"><div><h1><Network size={25}/>知识关系网</h1>
   <p className="muted">明确关系由 D1 保存；紫色虚线表示语义相似建议，不会自动建立正式关联。</p></div>
   <div className="graph-page-buttons">
    {focus&&<Button size="sm" variant="secondary" label="返回概览" onClick={()=>void focusOn()}/>}
    <Button size="sm" variant="ghost" icon={<RefreshCw size={14}/>} label="刷新" onClick={()=>void result.refetch()}/>
   </div>
  </header>
  <div className="graph-controls">
   <TextInput label="查找图中节点" isLabelHidden size="sm" placeholder="搜索已加载的文档" value={filter} onChange={setFilter}/>
   <CheckboxInput label={focus?'语义关联':'语义关联（聚焦后启用）'} size="sm" value={semantic} onChange={setSemantic} isDisabled={!focus}/>
   <div className="graph-zoom">
    <Button size="sm" variant="ghost" label="缩小" icon={<ZoomOut size={15}/>} onClick={()=>zoom(0.8)}/>
    <Button size="sm" variant="ghost" label="放大" icon={<ZoomIn size={15}/>} onClick={()=>zoom(1.25)}/>
    <Button size="sm" variant="ghost" label="适应视图" icon={<Maximize2 size={15}/>} onClick={()=>cy.current?.fit(undefined,35)}/>
   </div>
  </div>
  {result.isError&&<Banner status="error" container="section" title="关系网加载失败" description={result.error.message}/>}
  {result.isPending?<div className="graph-loading" role="status">正在加载知识关系…</div>:
   data&&<div className="graph-workspace">
    <div className="graph-stage">
     <div className="graph-topline"><span>{focus?'以当前文档为中心':'最近更新的知识子图'} · {nodes.length} 个文档 / {edges.length} 条关联</span>
      <span className="graph-legend"><i data-relation="explicit"/>明确关联 <i data-relation="semantic"/>语义建议 <i data-relation="folder"/>同目录</span>
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
        <Link to="/records/$recordId" params={{recordId:selectedNode.id}} className="graph-open-link"><ArrowRight size={15}/>打开文档</Link>
        {selectedNode.id!==focus&&<Button size="sm" variant="secondary" label="以此为中心" onClick={()=>void focusOn(selectedNode.id)}/>}
       </div>
       <div className="relation-group-heading">直接关联 <span>{connections.length}</span></div>
       {connections.length?<div className="graph-neighbors">{connections.slice(0,24).map(e=>{
        const other=nodes.find(n=>n.id===(e.sourceId===selected?e.targetId:e.sourceId));
        return <button className="graph-neighbor" key={e.id} onClick={()=>other&&setSelected(other.id)}>
         {e.type==='semantic'?<Sparkles size={14}/>:e.type==='folder'?<Folder size={14}/>:<Link2 size={14}/>}
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
