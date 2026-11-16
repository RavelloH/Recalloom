import {lazy,Suspense,useId,useLayoutEffect,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {motion,useReducedMotion} from 'motion/react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Icon} from './icon';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {SearchHighlight} from './search-highlight';
import {sharedSourceAttributes,markSharedNavigationSource} from './shared-view-transition';
import {documentDisplayName} from './document-filename';
import type {SearchHit} from './queries';

const SearchSnippet=lazy(()=>import('./search-snippet'));

export function SearchResultCard({result,index,query}:{result:SearchHit;index:number;query:string}){
 const titleId=useId(),excerptId=useId(),viewport=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 const [expanded,setExpanded]=useState(false),[overflow,setOverflow]=useState(false);
 const reduced=useReducedMotion(),exact=result.source!=='semantic';
 const name=result.kind==='task_list'?result.name:documentDisplayName(result.name);
 const source='search:'+result.id+':'+index;
 useLayoutEffect(()=>{
  const host=viewport.current,body=content.current;
  if(!host||!body)return;
  const measure=()=>{
   const limit=parseFloat(getComputedStyle(host).getPropertyValue('--search-preview-height'))||176;
   const next=body.getBoundingClientRect().height>limit+1;
   setOverflow(previous=>previous===next?previous:next);
  };
  const observer=new ResizeObserver(measure);
  observer.observe(body);observer.observe(host);measure();
  return()=>observer.disconnect();
 },[result.snippet,result.description]);

 return <Card className="search-result-card" padding={0}>
  <Link to="/records/$recordId" params={{recordId:result.id}} className="search-result" aria-labelledby={titleId} onClick={()=>markSharedNavigationSource(source)}>
   <div className="search-result-heading">
    <Icon name={result.kind==='task_list'?'taskList':'document'} size="md"/>
    <strong className="rk-search-filename" id={titleId}><span className="rk-shared-text" {...sharedSourceAttributes('record',result.id,source)}><SearchHighlight text={name} query={query} enabled={exact}/></span>{result.kind!=='task_list'&&/\.md$/i.test(result.name)&&<span className="rk-shared-extension">{result.name.slice(-3)}</span>}</strong>
   </div>
   <div className="search-result-meta muted small">
    <span>{result.kind==='task_list'?'任务列表':'文稿'}</span>
    {result.source==='semantic'&&<span className="semantic-label">语义相关</span>}
    {result.source==='hybrid'&&<span className="semantic-label">关键词＋语义</span>}
    {result.path&&<span className="search-result-path" title={result.path}>{result.path}</span>}
   </div>
   {(result.description||result.snippet)&&<AutoResizer><div ref={viewport} id={excerptId} className="search-snippet small" data-truncated={overflow&&!expanded||undefined} data-expanded={expanded||undefined}>
    <div ref={content} className="search-excerpt-content">
     {result.description&&<p className="search-result-description"><SearchHighlight text={result.description} query={query} enabled={exact}/></p>}
     {result.snippet&&<Suspense fallback={<SearchSnippetSkeleton/>}><SearchSnippet text={result.snippet} format={result.snippetFormat} query={query} enabled={exact}/></Suspense>}
    </div>
   </div></AutoResizer>}
  </Link>
  <AutoResizer><AutoTransition transitionKey={overflow?'controls':'none'} duration={.14}>{overflow&&<div className="search-result-footer">
   <Button label={expanded?'收起片段':'展开片段'} variant="ghost" size="sm" aria-controls={excerptId} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)} endContent={<motion.span className="search-expand-icon" animate={{rotate:expanded?180:0}} transition={{duration:reduced?0:.18}}><Icon name="chevronDown" size="sm"/></motion.span>}>
    <AutoTransition as="span" transitionKey={expanded?'expanded':'collapsed'} duration={.12}>{expanded?'收起片段':'展开片段'}</AutoTransition>
   </Button>
  </div>}</AutoTransition></AutoResizer>
 </Card>;
}

function SearchSnippetSkeleton(){
 return <div className="search-snippet-skeleton" role="status" aria-label="正在渲染片段"><Skeleton width="94%" height={14}/><Skeleton width="82%" height={14}/><Skeleton width="65%" height={14}/></div>;
}

export function SearchLoading(){
 return <div className="search-results" role="status" aria-label="正在搜索…">
  {[0,1,2].map(index=><Card key={index} padding={4} className="search-loading-card"><Skeleton width={index===1?'55%':'70%'} height={18}/><Skeleton width="38%" height={12}/><SearchSnippetSkeleton/></Card>)}
 </div>;
}
