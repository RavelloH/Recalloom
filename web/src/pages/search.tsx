import {Icon} from '../icon';
import {useEffect,useState} from 'react';
import {Link,useNavigate,useSearch} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {SearchHighlight} from '../search-highlight';
import {sharedViewTransitionName} from '../shared-view-transition';
import {searchModes,searchQuery,type SearchMode} from '../queries';
import {PageTitle,ErrorText,Loading,Empty,Swap} from './shared';

export function SearchPage(){
 const params=useSearch({strict:false}) as {q?:string;mode?:SearchMode};
 const submitted=params.q??'',mode=params.mode??'auto';
 const navigate=useNavigate();
 const [term,setTerm]=useState(submitted);
 const [navigating,setNavigating]=useState(false);
 useEffect(()=>{setTerm(submitted);},[submitted]);
 const q=useQuery(searchQuery(submitted,mode));
 const go=(next:{q?:string;mode?:SearchMode})=>{
  const nq=(next.q??submitted).trim(),nm=next.mode??mode;
  if(nq===submitted&&nm===mode)return;
  setNavigating(true);
  void navigate({to:'/search',search:{...(nq?{q:nq}:{}),...(nm!=='auto'?{mode:nm}:{})},replace:true})
   .finally(()=>setNavigating(false));
 };
 const shortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ K':'Ctrl K';
 const items=q.data?.items??[];
 const state=!submitted?'idle':q.isPending?'loading':q.isError?'error':items.length?'ready':'empty';
 return <div className="page search-page"><PageTitle title="搜索" description={'搜索标题与正文。在任意页面按 '+shortcut+' 可直接调出同样的搜索。'}/>
 <div className="search-surface"><form className="search-form" onSubmit={e=>{e.preventDefault();go({q:term});}}><div className="search-query-field"><TextInput label="搜索关键字" isLabelHidden width="100%" hasAutoFocus startIcon={<Icon name="search" size="md"/>} placeholder="输入关键词或自然语言问题…" value={term} onChange={setTerm}/></div><Button label="搜索" variant="primary" type="submit" isDisabled={!term.trim()} isLoading={navigating||Boolean(submitted&&q.isPending)}/></form>
  <div className="search-modes" role="group" aria-label="搜索方式"><ButtonGroup label="搜索方式" size="sm">{searchModes.map(m=><Button key={m.value} label={m.label} tooltip={m.hint} variant={mode===m.value?'secondary':'ghost'} onClick={()=>go({mode:m.value})}/>)}</ButtonGroup><span className="muted small">{searchModes.find(m=>m.value===mode)?.hint}</span></div>
 </div>
 <Swap state={state+':'+submitted+':'+mode}>{state==='loading'?<Loading/>:state==='error'?<ErrorText error={q.error}/>:state==='ready'?<><div className="muted small search-note">共 {items.length} 条结果。精确匹配以高亮标记；语义相关结果只展示关联片段。{q.data?.degraded?' 语义搜索暂不可用，当前显示关键词结果。':q.data?.indexMayLag?' 新内容的语义索引可能略有延迟。':''}</div><div className="search-results">{items.map((r,i)=>{const exact=r.source!=='semantic';return <Link key={r.id+'-'+i} to="/records/$recordId" params={{recordId:r.id}} className="search-result"><div className="search-result-heading">{r.kind==='task_list'?<Icon name="taskList" size="md"/>:<Icon name="document" size="md"/>}<strong style={items.findIndex(hit=>hit.id===r.id)===i?{viewTransitionName:sharedViewTransitionName('record',r.id)}:undefined}><SearchHighlight text={r.name} query={submitted} enabled={exact}/></strong><span className="muted small">{r.kind==='task_list'?'任务列表':'文档'}</span>{r.source==='semantic'&&<span className="semantic-label">语义相关</span>}{r.source==='hybrid'&&<span className="semantic-label">关键词＋语义</span>}</div>{r.path&&<p className="muted tiny">{r.path}</p>}{r.description&&<p className="small"><SearchHighlight text={r.description} query={submitted} enabled={exact}/></p>}{r.snippet&&<p className="small search-snippet"><SearchHighlight text={r.snippet} query={submitted} enabled={exact}/></p>}</Link>})}</div></>:state==='empty'?<Empty title="未找到结果" description="尝试其他关键词，或切换到“语义”按含义查找。"/>:<div className="search-initial-hint"><Icon name="command" size="sm"/><p>输入关键词查找文档和任务。“智能”同时使用关键词与语义；需要逐字匹配时选择“关键词”。</p></div>}</Swap></div>;
}
