import {lazy,Suspense,useId,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
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
const SearchTaskPreview=lazy(()=>import('./search-task-preview'));

export function SearchResultCard({result,index,query}:{result:SearchHit;index:number;query:string}){
 const titleId=useId(),excerptId=useId(),viewport=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 const [expanded,setExpanded]=useState(false),[preview,setPreview]=useState({overflow:false,offset:0});
 const reduced=useReducedMotion(),exact=result.source!=='semantic';
 const name=result.kind==='task_list'?result.name:documentDisplayName(result.name);
 const folder=result.path?.slice(0,result.path.lastIndexOf('/'))||result.folderName||(result.folderName===null?'知识库根目录':null);
 const source='search:'+result.id+':'+index;
 useLayoutEffect(()=>{
  const host=viewport.current,body=content.current;
  if(!host||!body)return;
  const measure=()=>{
   const limit=parseFloat(getComputedStyle(host).getPropertyValue('--search-preview-height'))||176;
   const bounds=body.getBoundingClientRect(),overflow=bounds.height>limit+1;
   const mark=overflow&&result.kind!=='task_list'?body.querySelector('.search-highlight:not(:is(h1,h2,h3,h4,h5,h6) *)'):null;
   const hit=mark?mark.getBoundingClientRect().top-bounds.top:0;
   const offset=hit>limit-64?Math.max(0,Math.round(hit-44)):0;
   setPreview(previous=>previous.overflow===overflow&&previous.offset===offset?previous:{overflow,offset});
  };
  const observer=new ResizeObserver(measure);
  observer.observe(body);observer.observe(host);measure();
  return()=>observer.disconnect();
 },[result.kind,result.snippet,result.description,query]);
 const {overflow,offset}=preview;
 const cropped=!expanded&&offset>0;

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
    {folder&&<span className="search-result-path" title={result.path??folder}>{folder}</span>}
   </div>
  </Link>
  {(result.description||result.snippet||result.kind==='task_list')&&<div className="search-preview">
   <AutoResizer><div ref={viewport} id={excerptId} className="search-snippet" data-truncated={overflow&&!expanded||undefined} data-expanded={expanded||undefined}
    data-offset={cropped||undefined} style={{'--search-preview-offset':cropped?offset+'px':undefined} as CSSProperties}>
    <div ref={content} className="search-excerpt-content">
     {result.description&&<p className="search-result-description"><SearchHighlight text={result.description} query={query} enabled={exact}/></p>}
     <Suspense fallback={<SearchSnippetSkeleton/>}>{result.kind==='task_list'
      ?<SearchTaskPreview recordId={result.id} revision={result.revision} query={query} exact={exact}/>
      :result.snippet&&<SearchSnippet text={result.snippet} format={result.snippetFormat} query={query} enabled={exact} sourceId={result.id}/>}</Suspense>
    </div>
   </div></AutoResizer>
  <AutoTransition transitionKey={overflow?'controls':'none'} duration={.14}>{overflow&&<div className="search-result-footer">
   <Button label={expanded?'收起片段':'展开片段'} variant="secondary" size="sm" aria-controls={excerptId} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)} endContent={<motion.span className="search-expand-icon" animate={{rotate:expanded?180:0}} transition={{duration:reduced?0:.18}}><Icon name="chevronDown" size="sm"/></motion.span>}>
    <AutoTransition as="span" transitionKey={expanded?'expanded':'collapsed'} duration={.12}>{expanded?'收起片段':'展开片段'}</AutoTransition>
   </Button>
  </div>}</AutoTransition>
  </div>}
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
