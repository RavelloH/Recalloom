import React,{useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Banner} from '@astryxdesign/core/Banner';
import {ArrowDownLeft,ArrowUpRight,Link2,Network,Sparkles,Unlink} from 'lucide-react';
import {mutate} from './api';
import {relationsQuery,searchQuery} from './queries';
import {relationLabel,semanticMessage} from './graph-types';

const choices=[
 {value:'related',label:'相关'},{value:'references',label:'引用'},
 {value:'depends_on',label:'依赖'},{value:'continues',label:'续篇'},
 {value:'supports',label:'支持'},{value:'contradicts',label:'不同观点'}
];

export function RecordRelations({recordId,onNavigate}:{recordId:string;onNavigate?:()=>void}){
 const qc=useQueryClient();
 const related=useQuery(relationsQuery(recordId));
 const [query,setQuery]=useState('');
 const [relation,setRelation]=useState('related');
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState('');
 const search=useQuery({...searchQuery(query,'metadata',12),enabled:query.trim().length>=2});
 // Relations are directional and typed. A reference in one direction must
 // not prevent a different relation (or a reverse link) to the same record.
 const existing=new Set(related.data?.links.filter(e=>e.sourceId===recordId)
  .map(e=>e.targetId+':'+e.relation)??[]);
 const refresh=async()=>{
  await Promise.all([
   qc.invalidateQueries({queryKey:['relations',recordId]}),
   qc.invalidateQueries({queryKey:['knowledge-graph']})
  ]);
 };
 const apply=async(sourceId:string,targetId:string,edgeRelation:string,action:'add'|'remove')=>{
  if(busy)return;
  setBusy(sourceId+targetId);setError('');
  try{
   await mutate('/records/'+sourceId+'/links',{targetId,relation:edgeRelation,action});
   await refresh();
   if(action==='add')setQuery('');
  }catch(e){setError(e instanceof Error?e.message:'关系操作失败');}
  finally{setBusy(null);}
 };
 const data=related.data;
 return <section className="relation-panel" aria-label="文档关联">
  <div className="relation-panel-heading">
   <h3><Network size={16}/>关联文档</h3>
   <Link to="/graph" search={{focus:recordId}} onClick={onNavigate} className="relation-graph-link">查看关系网</Link>
  </div>
  {error&&<Banner status="error" container="section" title="关联操作失败" description={error}/>}
  {related.isPending?<p className="muted small" role="status">正在加载关联…</p>:
   related.isError?<Banner status="error" container="section" title="关联加载失败" description={related.error.message}/>:
   <>
    <div className="relation-group-heading"><Link2 size={14}/>已确认关系 <span>{data?.links.length??0}</span></div>
    {data?.links.length?<div className="relation-items">{data.links.map(link=><div className="relation-row" key={link.id}>
     {link.direction==='outgoing'?<ArrowUpRight size={15}/>:<ArrowDownLeft size={15}/>}
     <div className="relation-copy">
      <Link to="/records/$recordId" params={{recordId:link.other.id}} onClick={onNavigate} className="relation-name">{link.other.name}</Link>
      <small className="muted">{link.direction==='outgoing'?'指向':'来自'} · {relationLabel(link.relation)}{link.other.status==='archived'?' · 已归档':''}</small>
     </div>
     <Button size="sm" variant="ghost" label="解除关系" icon={<Unlink size={13}/>}
      isDisabled={Boolean(busy)} onClick={()=>void apply(link.sourceId,link.targetId,link.relation,'remove')}/>
    </div>)}</div>:<p className="relation-placeholder">尚未建立显式关系。可以在下方搜索文档并关联。</p>}
    <div className="relation-group-heading"><Sparkles size={14}/>语义相似 <span>{data?.suggestions.length??0}</span></div>
    <p className="muted relation-hint">{semanticMessage(data?.semanticStatus??'disabled')}</p>
    {Boolean(data?.suggestions.length)&&<div className="relation-items">{data?.suggestions.map(s=><div className="relation-row relation-suggestion" key={s.id}>
     <Sparkles size={15}/>
     <div className="relation-copy">
      <Link to="/records/$recordId" params={{recordId:s.other.id}} onClick={onNavigate} className="relation-name">{s.other.name}</Link>
      <small className="muted">{Math.round((s.score??0)*100)}% 相似度{(s.support??0)>1?' · 多段匹配':''}</small>
      {s.snippet&&<p className="relation-excerpt" title={s.snippet}>{s.snippet}</p>}
     </div>
     <Button size="sm" variant="secondary" label="建立关联" isDisabled={Boolean(busy)||existing.has(s.other.id+':related')}
      onClick={()=>void apply(recordId,s.other.id,'related','add')}/>
    </div>)}</div>}
    <div className="relation-add">
     <h4>添加关联</h4>
     <Selector label="关系类型" size="sm" width="100%" value={relation} options={choices} onChange={setRelation}/>
     <TextInput label="查找文档" size="sm" width="100%" value={query} onChange={setQuery}
      placeholder="输入文档名称，至少两个字"/>
     {search.isFetching&&<p className="muted small" role="status">正在搜索…</p>}
     {search.isError&&<p className="muted small">文档搜索暂不可用</p>}
     {query.trim().length>=2&&<div className="relation-search-results">
      {search.data?.items.filter(item=>item.id!==recordId&&!existing.has(item.id+':'+relation)).map(item=><div className="relation-search-item" key={item.id}>
       <span className="truncate">{item.name}</span>
       <Button variant="secondary" size="sm" label="关联" isDisabled={Boolean(busy)}
        onClick={()=>void apply(recordId,item.id,relation,'add')}/>
      </div>)}
      {search.data?.items.length===0&&!search.isFetching&&<p className="muted small">没有找到匹配记录</p>}
     </div>}
    </div>
   </>}
 </section>;
}
