import './styles/features/relations.css';
import './styles/features/graph.css';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate,useSearch} from '@tanstack/react-router';
import {keepPreviousData,useQuery} from '@tanstack/react-query';
import type {Core} from 'cytoscape';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {TextInput} from '@astryxdesign/core/TextInput';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {Banner} from '@astryxdesign/core/Banner';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Tooltip} from '@astryxdesign/core/Tooltip';
import {Icon} from './icon';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {graphQuery} from './queries';
import {semanticMessage,type KnowledgeEdge,type KnowledgeNode} from './graph-types';
import {GraphCanvas,useGraphViewHeight} from './graph-canvas';
import {GraphDocumentsPanel,GraphNodePanel,type GraphConnection,type GraphNodeSession} from './graph-panels';

const emptyNodes:KnowledgeNode[]=[],emptyEdges:KnowledgeEdge[]=[];
const edgeOptions:Array<{value:KnowledgeEdge['type'];label:string}>=[
 {value:'explicit',label:'手动关联'},{value:'reference',label:'正文引用'},{value:'embed',label:'嵌入'},
 {value:'semantic',label:'语义建议'},{value:'folder',label:'同目录'}
];

export default function KnowledgeGraphPage(){
 const {focus}=useSearch({from:'/graph'}),nav=useNavigate(),viewport=useGraphViewHeight();
 const [semantic,setSemantic]=useState(true),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState('');
 const [types,setTypes]=useState<KnowledgeEdge['type'][]>(()=>edgeOptions.map(option=>option.value));
 const [listOpen,setListOpen]=useState(false),[sessions,setSessions]=useState<GraphNodeSession[]>([]);
 const [activation,setActivation]=useState(0),sequence=useRef(0),cy=useRef<Core|null>(null);
 const result=useQuery({...graphQuery(focus,semantic),placeholderData:keepPreviousData});
 const data=result.data,nodes=data?.nodes??emptyNodes,edges=data?.edges??emptyEdges;
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
  const activation=++sequence.current;setSelected(id);setActivation(activation);
  setSessions(current=>{
   const session={node,connections:connections.get(id)??[],open:true,activation};
   return current.some(item=>item.node.id===id)?current.map(item=>item.node.id===id?session:item):[...current,session];
  });
 },[nodeMap,connections]);
 useEffect(()=>{setSelected(focus??null);},[focus]);
 const focusOn=(id?:string)=>{void nav({to:'/graph',search:id?{focus:id}:{}});};
 const zoom=(multiplier:number)=>{const view=cy.current;if(view)view.zoom({level:Math.min(2.8,Math.max(0.15,view.zoom()*multiplier)),renderedPosition:{x:view.width()/2,y:view.height()/2}});};
 const visibleEdges=edges.filter(edge=>types.includes(edge.type)).length;
 const summary=nodes.length+' 篇文稿 · '+visibleEdges+' 条关联';
 const scope=focus?(nodeMap.get(focus)?.name??'当前文稿'):'最近更新的文稿';
 return <div ref={viewport.ref} className="page knowledge-graph-page" style={{height:viewport.height}}>
  <header className="graph-page-heading">
   <div className="graph-page-title"><h1><Icon name="relationGraph" inline/>知识关系网</h1>
    <Tooltip placement="below" content={<span className="graph-help">默认展示最近的文稿；选中节点可查看详情，并以此为中心探索相邻文稿。实线表示手动关联或正文引用，虚线表示语义建议，点线表示同目录。{focus?' '+semanticMessage(data?.semanticStatus??'disabled'):''}</span>}>
     <IconButton label="关系网说明" variant="ghost" size="sm" icon={<Icon name="infoCircle" size="sm"/>}/>
    </Tooltip>
   </div>
   <div className="graph-page-buttons">
    {focus&&<Button size="sm" variant="secondary" label="返回概览" onClick={()=>focusOn()}/>}
    <IconButton size="sm" variant="ghost" icon={<Icon name="refresh" size="sm"/>} label="刷新" isDisabled={result.isFetching} onClick={()=>void result.refetch()}/>
   </div>
  </header>
  <div className="graph-controls">
   <TextInput label="查找图中节点" isLabelHidden size="sm" placeholder="搜索已加载的文稿" startIcon={<Icon name="search" size="sm"/>} value={filter} onChange={setFilter}/>
   <MultiSelector label="显示关联类型" isLabelHidden size="sm" variant="secondary" value={types} options={edgeOptions}
    onChange={value=>setTypes(value as KnowledgeEdge['type'][])} hasSelectAll selectAllLabel="全部类型" placeholder="隐藏全部关联"
    formatValue={items=>items.length===edgeOptions.length?'全部关联':items.length+' 类关联'} startIcon={<Icon name="filter" size="sm"/>}/>
   <CheckboxInput label="语义关联" size="sm" value={semantic} onChange={setSemantic} isDisabled={!focus}/>
   <Button size="sm" variant={listOpen?'secondary':'ghost'} label="文稿列表" icon={<Icon name="list" size="sm"/>}
    aria-pressed={listOpen} onClick={()=>setListOpen(open=>!open)}/>
  </div>
  <AutoResizer><AutoTransition transitionKey={result.isError?'error':'ready'} duration={.14}>
   {result.isError&&<Banner status="error" container="section" title="关系网加载失败" description={result.error.message}/>}
  </AutoTransition></AutoResizer>
  <div className="graph-workspace">
   <div className="graph-stage" aria-busy={result.isFetching}>
    <div className="graph-topline"><span className="graph-scope" title={scope}>{scope}</span>
     <AutoTransition as="span" transitionKey={result.isFetching?'loading':summary} duration={.14}><span role="status">{result.isFetching?'正在加载…':summary}</span></AutoTransition>
    </div>
    <GraphCanvas nodes={nodes} edges={edges} selected={selected} focusId={focus} onSelect={onSelect} cyRef={cy} query={filter} types={types} activation={activation}/>
    {!nodes.length&&!result.isFetching&&<div className="graph-empty"><EmptyState title="暂无可显示的文稿" description="添加文稿后即可查看关系网。"/></div>}
    <div className="graph-legend" aria-label="关联图例">{edgeOptions.filter(option=>types.includes(option.value)).map(option=><span key={option.value}><i data-relation={option.value}/>{option.label}</span>)}</div>
    <div className="graph-zoom" role="group" aria-label="画布缩放">
     <IconButton size="sm" variant="ghost" label="缩小" icon={<Icon name="zoomOut" size="sm"/>} onClick={()=>zoom(.8)}/>
     <IconButton size="sm" variant="ghost" label="放大" icon={<Icon name="zoomIn" size="sm"/>} onClick={()=>zoom(1.25)}/>
     <IconButton size="sm" variant="ghost" label="适应视图" icon={<Icon name="maximize" size="sm"/>} onClick={()=>cy.current?.fit(undefined,40)}/>
    </div>
   </div>
  </div>
  <GraphDocumentsPanel nodes={nodes} query={filter} selected={selected} open={listOpen} onOpenChange={setListOpen} onQuery={setFilter} onSelect={onSelect}/>
  {sessions.map(session=>{
   const node=nodeMap.get(session.node.id)??session.node;
   return <GraphNodePanel key={node.id} session={session} node={node} connections={nodeMap.has(node.id)?connections.get(node.id)??[]:session.connections}
    focusId={focus} onSelect={onSelect} onFocus={focusOn}
    onOpenChange={open=>setSessions(current=>current.map(item=>item.node.id===node.id?{...item,open}:item))}
    onAfterClose={()=>setSessions(current=>current.filter(item=>item.node.id!==node.id||item.open))}/>;
  })}
 </div>;
}
