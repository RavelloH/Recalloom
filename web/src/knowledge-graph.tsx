import './styles/features/relations.css';
import './styles/features/graph.css';
import {useCallback,useMemo,useRef,useState} from 'react';
import {useNavigate,useSearch} from '@tanstack/react-router';
import type {Core} from 'cytoscape';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {WorkspaceToolbar,WorkspaceSearch} from './workspace-toolbar';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {Banner} from '@astryxdesign/core/Banner';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Tooltip} from '@astryxdesign/core/Tooltip';
import {Icon} from './icon';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {PageTitle,LoadingRows} from './pages/shared';
import {useGraphData} from './graph-data';
import {semanticMessage,type KnowledgeEdge} from './graph-types';
import {GraphCanvas,useGraphViewHeight,fitGraphViewport} from './graph-canvas';
import {GraphDocumentsPanel,GraphNodePanel,type GraphConnection,type GraphNodeSession} from './graph-panels';

const edgeOptions:Array<{value:KnowledgeEdge['type'];label:string}>=[
 {value:'explicit',label:'手动关联'},{value:'reference',label:'正文引用'},{value:'embed',label:'嵌入'},
 {value:'semantic',label:'语义建议'},{value:'folder',label:'同目录'}
];

export default function KnowledgeGraphPage(){
 const {focus}=useSearch({from:'/graph'}),nav=useNavigate(),viewport=useGraphViewHeight();
 const [semantic,setSemantic]=useState(true),[filter,setFilter]=useState('');
 const [types,setTypes]=useState<KnowledgeEdge['type'][]>(()=>edgeOptions.map(option=>option.value));
 const [listOpen,setListOpen]=useState(false),[sessions,setSessions]=useState<GraphNodeSession[]>([]);
 const sequence=useRef(0),cy=useRef<Core|null>(null);
 const {nodes,edges,error,loading,semanticStatus,semanticLoading,refresh}=useGraphData(focus,semantic);
 const active=sessions.filter(session=>session.open).sort((a,b)=>b.activation-a.activation)[0];
 const selected=active?.node.id??null,activation=active?.activation??0;
 const nodeMap=useMemo(()=>new Map(nodes.map(node=>[node.id,node])),[nodes]);
 const connections=useMemo(()=>{
  const map=new Map<string,GraphConnection[]>();
  for(const edge of edges){
   const source=nodeMap.get(edge.sourceId),target=nodeMap.get(edge.targetId);if(!source||!target)continue;
   map.set(source.id,[...(map.get(source.id)??[]),{edge,node:target}]);
   map.set(target.id,[...(map.get(target.id)??[]),{edge,node:source}]);
  }
  return map;
 },[edges,nodeMap]);
 const onSelect=useCallback((id:string)=>{
  const node=nodeMap.get(id);if(!node)return;
  const activation=++sequence.current;
  setSessions(current=>{
   const session={node,connections:connections.get(id)??[],open:true,activation};
   return current.some(item=>item.node.id===id)?current.map(item=>item.node.id===id?session:item):[...current,session];
  });
 },[nodeMap,connections]);
 const focusOn=useCallback((id?:string)=>{
  const view=cy.current;
  if(id&&id===focus&&view){
   const position=view.$id(id).position();view.stop();
   view.animate({pan:{x:view.width()/2-position.x*view.zoom(),y:view.height()/2-position.y*view.zoom()}},
    {duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:240,easing:'ease-out-cubic'});
  }
  void nav({to:'/graph',search:id?{focus:id}:{}});
 },[nav,focus]);
 const zoom=(multiplier:number)=>{const view=cy.current;if(view)view.zoom({level:Math.min(2.8,Math.max(0.15,view.zoom()*multiplier)),renderedPosition:{x:view.width()/2,y:view.height()/2}});};
 const visibleEdges=edges.filter(edge=>types.includes(edge.type)).length;
 const summary=nodes.length+' 篇文稿 · '+visibleEdges+' 条关联';
 const scope=focus?(nodeMap.get(focus)?.name??'当前文稿'):'最近更新的文稿';
 const semanticSummary=semanticLoading?'正在补充语义关联…':semanticStatus==='ready'?'语义建议 '+edges.filter(edge=>edge.type==='semantic').length:
  semanticStatus==='indexing'?'语义索引准备中':semanticStatus==='unavailable'?'语义索引暂不可用':'语义关联已关闭';
 return <div ref={viewport.ref} className="page workspace-page workspace-full-page knowledge-graph-page" style={{height:viewport.height}}>
  <PageTitle title="知识关系网" description="以文稿为中心探索关联，保留周围的知识上下文。" actions={<>
    {focus&&<Button size="sm" variant="secondary" label="返回概览" onClick={()=>focusOn()}/>}
    <Tooltip placement="below" content={<span className="graph-help">单击文稿将其设为中心，通过详情按钮查看和管理关联。中心周围展示直接关联，外围保留其他文稿。虚线表示语义建议，点线表示同目录。{semanticMessage(semanticStatus)}</span>}>
     <IconButton label="关系网说明" variant="ghost" size="sm" icon={<Icon name="infoCircle" size="sm"/>}/>
    </Tooltip>
    <IconButton size="sm" variant="ghost" icon={<Icon name="refresh" size="sm"/>} label="刷新" isDisabled={loading||semanticLoading} isLoading={loading||semanticLoading} onClick={()=>void refresh()}/>
   </>}/>
  <WorkspaceToolbar filters={<>
   <MultiSelector label="显示关联类型" isLabelHidden size="sm" variant="secondary" value={types} options={edgeOptions}
    onChange={value=>setTypes(value as KnowledgeEdge['type'][])} hasSelectAll selectAllLabel="全部类型" placeholder="隐藏全部关联"
    formatValue={items=>items.length===edgeOptions.length?'全部关联':items.length+' 类关联'} startIcon={<Icon name="filter" size="sm"/>}/>
   <CheckboxInput label="语义关联" size="sm" value={semantic} onChange={setSemantic}/>
   <Button size="sm" variant={listOpen?'secondary':'ghost'} label="文稿列表" icon={<Icon name="list" size="sm"/>}
    aria-pressed={listOpen} onClick={()=>setListOpen(open=>!open)}/>
  </>} search={<WorkspaceSearch label="查找图中节点" placeholder="搜索已加载的文稿…" value={filter} onChange={setFilter}/>}/>
  <AutoResizer><AutoTransition transitionKey={error?'error':'ready'} duration={.14}>
   {error&&<Banner status="error" container="section" title="关系网加载失败" description={error.message}/>}
  </AutoTransition></AutoResizer>
  <div className="graph-workspace">
   <div className="graph-stage" aria-busy={loading}>
    <div className="graph-topline"><div className="graph-scope"><AutoTransition as="span" transitionKey={scope} duration={.16}><span title={scope}>{scope}</span></AutoTransition>
      {focus&&<IconButton size="sm" variant="ghost" label="查看当前文稿详情" icon={<Icon name="infoCircle" size="sm"/>} onClick={()=>onSelect(focus)}/>}
     </div>
     <AutoTransition as="span" transitionKey={loading?summary+'loading':summary} duration={.14}><span role="status">{summary}{loading?' · 加载关联中…':''}</span></AutoTransition>
    </div>
    <GraphCanvas nodes={nodes} edges={edges} selected={selected} focusId={focus} onSelect={focusOn} cyRef={cy} query={filter} types={types} activation={activation} viewportReady={viewport.height!==undefined}/>
    <AutoTransition className="graph-state" transitionKey={nodes.length?'ready':loading?'loading':error?'error':'empty'}>
     {!nodes.length&&(loading?<div className="graph-loading"><LoadingRows kind="compact" count={5}/></div>:!error&&<div className="graph-empty"><EmptyState title="暂无可显示的文稿" description="添加文稿后即可查看关系网。"/></div>)}
    </AutoTransition>
    <div className="graph-legend" aria-label="关联图例">{edgeOptions.filter(option=>types.includes(option.value)).map(option=><span key={option.value}><i data-relation={option.value}/>{option.label}</span>)}
     <AutoTransition as="span" transitionKey={semanticSummary} duration={.14}><span className="graph-semantic-status" title={semanticMessage(semanticStatus)}>{semanticSummary}</span></AutoTransition>
    </div>
    <div className="graph-zoom" role="group" aria-label="画布缩放">
     <IconButton size="sm" variant="ghost" label="缩小" icon={<Icon name="zoomOut" size="sm"/>} onClick={()=>zoom(.8)}/>
     <IconButton size="sm" variant="ghost" label="放大" icon={<Icon name="zoomIn" size="sm"/>} onClick={()=>zoom(1.25)}/>
     <IconButton size="sm" variant="ghost" label="适应视图" icon={<Icon name="maximize" size="sm"/>} onClick={()=>{if(cy.current)fitGraphViewport(cy.current);}}/>
    </div>
   </div>
  </div>
  <GraphDocumentsPanel nodes={nodes} query={filter} selected={focus??null} open={listOpen} onOpenChange={setListOpen} onQuery={setFilter} onSelect={onSelect} onFocus={focusOn}/>
  {sessions.map(session=>{
   const node=nodeMap.get(session.node.id)??session.node;
   return <GraphNodePanel key={node.id} session={session} node={node} connections={nodeMap.has(node.id)?connections.get(node.id)??[]:session.connections}
    focusId={focus} onSelect={onSelect} onFocus={focusOn}
    onOpenChange={open=>setSessions(current=>current.map(item=>item.node.id===node.id?{...item,open}:item))}
    onAfterClose={()=>setSessions(current=>current.filter(item=>item.node.id!==node.id||item.open))}/>;
  })}
 </div>;
}
