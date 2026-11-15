import {useState} from 'react';
import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Icon} from './icon';
import {AutoTransition} from './motion-primitives';
import {RecordRelations} from './record-relations';
import {WorkspacePanel} from './workspace-panels';
import {ago} from './pages/shared';
import {relationLabel,type KnowledgeEdge,type KnowledgeNode} from './graph-types';

export type GraphConnection={edge:KnowledgeEdge;node:KnowledgeNode};
export type GraphNodeSession={node:KnowledgeNode;connections:GraphConnection[];open:boolean;activation:number};

export function GraphDocumentsPanel({nodes,query,selected,open,onOpenChange,onQuery,onSelect,onFocus}:{
 nodes:KnowledgeNode[];query:string;selected:string|null;open:boolean;onOpenChange:(open:boolean)=>void;
 onQuery:(query:string)=>void;onSelect:(id:string)=>void;onFocus:(id:string)=>void;
}){
 const token=query.trim().toLocaleLowerCase(),list=nodes.filter(node=>node.name.toLocaleLowerCase().includes(token));
 return <WorkspacePanel id="graph-documents" title="文稿列表" label="文稿列表" description={'已加载 '+nodes.length+' 篇文稿'}
  reserveSpace={false} open={open} onOpenChange={onOpenChange}>
  <div className="graph-panel">
   <TextInput label="筛选文稿列表" isLabelHidden size="sm" width="100%" placeholder="搜索已加载的文稿" value={query} onChange={onQuery}/>
   <AutoTransition transitionKey={list.map(node=>node.id).join(':')} duration={.14}>
    {list.length?<div className="graph-node-list">{list.map(node=><div className="graph-node-row" key={node.id}><Button label={node.name}
     variant={selected===node.id?'secondary':'ghost'} width="100%" className="graph-node-option" aria-pressed={selected===node.id}
     icon={<Icon name={node.kind==='task_list'?'taskList':'document'} size="sm"/>} onClick={()=>{onFocus(node.id);onOpenChange(false);}}/>
     <IconButton label={'查看'+node.name+'的详情'} size="sm" variant="ghost" icon={<Icon name="infoCircle" size="sm"/>} onClick={()=>onSelect(node.id)}/>
    </div>)}</div>:
     <EmptyState title={token?'没有匹配的文稿':'暂无文稿'} description={token?'可以尝试其他关键词。':'添加文稿后即可查看关系网。'}/>}
   </AutoTransition>
  </div>
 </WorkspacePanel>;
}

export function GraphNodePanel({session,node,connections,focusId,onSelect,onFocus,onOpenChange,onAfterClose}:{
 session:GraphNodeSession;node:KnowledgeNode;connections:GraphConnection[];focusId?:string;onSelect:(id:string)=>void;
 onFocus:(id:string)=>void;onOpenChange:(open:boolean)=>void;onAfterClose:()=>void;
}){
 const [manage,setManage]=useState(false);
 return <WorkspacePanel id={'graph-node-'+node.id} label={'节点详情：'+node.name} title="节点详情" description={node.name}
  reserveSpace={false} activationKey={session.activation} open={session.open} onOpenChange={onOpenChange} onAfterClose={onAfterClose}>
  <div className="graph-panel">
   <div className="graph-inspector-actions">
    <Link to="/records/$recordId" params={{recordId:node.id}} className="graph-open-link"><Icon name="arrowUpRight" size="sm"/>打开文档</Link>
    {node.id!==focusId&&<Button size="sm" variant="secondary" label="以此为中心" onClick={()=>onFocus(node.id)}/>}
   </div>
   <dl className="graph-node-meta">
    <dt>类型</dt><dd>{node.kind==='task_list'?'任务列表':'Markdown 文档'}{node.status==='archived'?' · 已归档':''}</dd>
    <dt>目录</dt><dd>{node.folderName??'知识库根目录'}</dd>
    <dt>更新</dt><dd><time dateTime={node.updatedAt} title={node.updatedAt}>{ago(node.updatedAt)||'刚刚'}</time> · R{node.revision}</dd>
   </dl>
   <section className="graph-connections" aria-label="图中关联">
    <h3 className="relation-group-heading">图中关联 <AutoTransition as="span" transitionKey={connections.length} duration={.14}>{connections.length}</AutoTransition></h3>
    <AutoTransition transitionKey={connections.map(item=>item.edge.id).join(':')} duration={.14}>
     {connections.length?<div className="graph-neighbors">{connections.map(({edge,node:other})=><div className="graph-node-row" key={edge.id}><Button
      label={other.name} variant="ghost" width="100%" className="graph-neighbor" onClick={()=>onFocus(other.id)}
      icon={<Icon name={edge.type==='semantic'?'sparkles':edge.type==='folder'?'folder':edge.sourceId===node.id?'arrowUpRight':'arrowDownLeft'} size="sm"/>}
      endContent={<small className="graph-neighbor-relation">{relationLabel(edge.relation)}</small>}/>
      <IconButton label={'查看'+other.name+'的详情'} size="sm" variant="ghost" icon={<Icon name="infoCircle" size="sm"/>} onClick={()=>onSelect(other.id)}/>
     </div>)}</div>:
      <p className="muted small">当前图中暂无直接关联。可以在下方管理关联。</p>}
    </AutoTransition>
   </section>
   <Collapsible isOpen={manage} onOpenChange={setManage} className="graph-manage-relations" trigger="管理关联">
    {manage&&<RecordRelations recordId={node.id}/>}
   </Collapsible>
  </div>
 </WorkspacePanel>;
}
