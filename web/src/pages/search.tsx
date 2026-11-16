import {useEffect,useId,useRef,useState} from 'react';
import {useNavigate,useSearch} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {SegmentedControl,SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Icon} from '../icon';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {SearchResultCard,SearchLoading} from '../search-result-card';
import {searchModes,searchQuery,type SearchMode} from '../queries';
import {PageTitle,ErrorText,Empty,Swap} from './shared';

export function SearchPage(){
 const params=useSearch({strict:false}) as {q?:unknown;mode?:SearchMode};
 const submitted=typeof params.q==='string'||typeof params.q==='number'?String(params.q):'',mode=params.mode??'auto';
 const displayMode=mode==='hybrid'?'auto':mode;
 const navigate=useNavigate(),modeDescriptionId=useId(),navigationId=useRef(0);
 const [term,setTerm]=useState(submitted),[selectedMode,setSelectedMode]=useState<SearchMode>(displayMode);
 const [navigating,setNavigating]=useState(false);
 useEffect(()=>setTerm(submitted),[submitted]);
 useEffect(()=>setSelectedMode(displayMode),[displayMode]);
 const q=useQuery(searchQuery(submitted,mode));
 const go=(next:{q?:string;mode?:SearchMode})=>{
  const nq=(next.q??submitted).trim(),nm=next.mode??mode;
  if(nq===submitted&&nm===mode)return;
  const id=++navigationId.current;
  setNavigating(true);
  void navigate({to:'/search',search:{...(nq?{q:nq}:{}),...(nm!=='auto'?{mode:nm}:{})},replace:true})
   .catch(()=>{if(navigationId.current===id)setSelectedMode(displayMode);})
   .finally(()=>{if(navigationId.current===id)setNavigating(false);});
 };
 const shortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ K':'Ctrl K';
 const items=q.data?.items??[];
 const state=!submitted?'idle':q.data?(items.length?'ready':'empty'):q.isError?'error':'loading';

 return <div className="page search-page">
  <PageTitle title="搜索" description={'搜索文稿和任务。按 '+shortcut+' 可在任意页面打开快速搜索。'}/>
  <div className="search-surface">
   <form className="search-form" onSubmit={event=>{event.preventDefault();go({q:term});}}>
    <div className="search-query-field"><TextInput label="搜索关键字" isLabelHidden width="100%" hasAutoFocus startIcon={<Icon name="search" size="md"/>} placeholder="输入关键词或自然语言问题…" value={term} onChange={setTerm}/></div>
    <Button label="搜索" variant="primary" type="submit" isDisabled={!term.trim()} isLoading={navigating||Boolean(submitted&&q.isFetching)}/>
   </form>
   <div className="search-modes">
    <SegmentedControl label="搜索方式" size="sm" value={selectedMode} onChange={value=>{const next=value as SearchMode;setSelectedMode(next);go({mode:next});}} className="search-mode-control">
     {searchModes.map(item=><SegmentedControlItem key={item.value} value={item.value} label={item.label} aria-describedby={modeDescriptionId+'-'+item.value}/>)}
    </SegmentedControl>
    <AutoResizer><AutoTransition as="span" transitionKey={mode}><span id={modeDescriptionId+'-'+displayMode} className="muted small">{searchModes.find(item=>item.value===displayMode)?.hint}</span></AutoTransition></AutoResizer>
    {searchModes.filter(item=>item.value!==displayMode).map(item=><span key={item.value} id={modeDescriptionId+'-'+item.value} hidden>{item.hint}</span>)}
   </div>
  </div>
  <Swap state={state+':'+submitted+':'+mode}>
   {state==='loading'?<SearchLoading/>:state==='error'?<div className="search-error"><ErrorText error={q.error}/><Button label="重试搜索" variant="secondary" size="sm" onClick={()=>void q.refetch()}/></div>:state==='ready'?<>
    <div className="search-note"><AutoTransition as="span" transitionKey={items.length}><strong>{items.length} 条结果</strong></AutoTransition><span className="muted small">{mode==='semantic'?'按语义相关性排列':'精确匹配已高亮'}</span></div>
    <AutoResizer>{q.data?.degraded?<p className="search-status-note muted small" role="status">语义搜索暂不可用，当前显示关键词结果。</p>:q.data?.indexMayLag?<p className="search-status-note muted small">新内容的语义索引可能略有延迟。</p>:null}</AutoResizer>
    {q.isError&&<div className="search-error"><ErrorText error={q.error}/><Button label="重试搜索" variant="ghost" size="sm" onClick={()=>void q.refetch()}/></div>}
    <div className="search-results">{items.map((result,index)=><SearchResultCard key={result.id+'-'+index} result={result} index={index} query={submitted}/>)}</div>
   </>:state==='empty'?<Empty title="未找到结果" description="尝试其他关键词，或切换到“语义”按含义查找。"/>:<div className="search-initial-hint"><Icon name="search" size="md"/><p>输入关键词或问题开始搜索。“智能”结合关键词与语义，也可以按名称或含义查找。</p></div>}
  </Swap>
 </div>;
}
