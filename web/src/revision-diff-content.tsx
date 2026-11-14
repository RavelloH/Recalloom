import React,{memo,useEffect,useId,useMemo,useRef,useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from './icon';
import MarkdownPreview from './markdown-preview';
import {buildRevisionDiff,revisionSourcePage,type RevisionDiffRow,type RevisionSourceRow} from './revision-diff';
import {collectRmdPreviewRefs} from './rmd-cross-reference';
import {projectRmdPreview} from './rmd-preview';

type View='preview'|'source';
type Entry<T>={type:'row';row:T;index:number}|{type:'context';start:number;end:number};

/** Context is folded between whole syntax blocks, never through a fence/table. */
function withContext<T extends {kind:string}>(rows:T[],context:number,expanded:Set<string>,view:View):Entry<T>[] {
 const entries:Entry<T>[]=[];
 for(let i=0;i<rows.length;){
  if(rows[i]!.kind!=='unchanged'){entries.push({type:'row',row:rows[i]!,index:i++});continue;}
  let end=i+1;while(end<rows.length&&rows[end]!.kind==='unchanged')end++;
  const first=i===0?i:Math.min(i+context,end),last=end===rows.length?end:Math.max(first,end-context);
  const isExpanded=expanded.has(view+':'+i);
  for(let j=i;j<first;j++)entries.push({type:'row',row:rows[j]!,index:j});
  if(last>first){
   if(isExpanded)for(let j=first;j<last;j++)entries.push({type:'row',row:rows[j]!,index:j});
   else entries.push({type:'context',start:first,end:last});
  }
  for(let j=last;j<end;j++)entries.push({type:'row',row:rows[j]!,index:j});
  i=end;
 }
 return entries;
}

export default function RevisionDiffContent({before,after,sourceId}:{before:string;after:string;sourceId:string}){
 const diff=useMemo(()=>buildRevisionDiff(before,after),[before,after]);
 const inlineRows=useMemo(()=>{
  const enabled=new Set<number>();let budget=24_000;
  diff.rows.forEach((row,index)=>{
   const size=row.block.content.length+(row.compareContent?.length??0);
   if(row.compareContent&&['paragraph','heading','table','list','blockquote'].includes(row.block.kind)&&size<=budget){
    enabled.add(index);budget-=size;
   }
  });
  return enabled;
 },[diff]);
 const [view,setView]=useState<View>(diff.limited?'source':'preview');
 const [expanded,setExpanded]=useState(()=>new Set<string>());
 const [start,setStart]=useState(0);
 const [limit,setLimit]=useState(diff.limited?300:40);
 const [change,setChange]=useState(-1);
 const [pendingJump,setPendingJump]=useState<number|null>(null);
 const scrollRef=useRef<HTMLDivElement>(null);
 const beforeRefs=useMemo(()=>diff.limited?undefined:collectRmdPreviewRefs(before,diff.analysisBefore),[before,diff]);
 const afterRefs=useMemo(()=>diff.limited?undefined:collectRmdPreviewRefs(after,diff.analysisAfter),[after,diff]);
 const rows=view==='preview'?diff.rows:diff.sourceRows;
 const entries=useMemo(()=>withContext<RevisionDiffRow|RevisionSourceRow>(rows,view==='preview'?1:3,expanded,view),[rows,view,expanded]);
 const changes=useMemo(()=>rows.flatMap((row,index)=>row.kind!=='unchanged'&&(index===0||rows[index-1]!.kind==='unchanged')?[index]:[]),[rows]);
 const visible=entries.slice(start,limit);
 const switchView=(next:View)=>{
  setView(next);setStart(0);setLimit(next==='source'?300:40);setChange(-1);setPendingJump(null);
  scrollRef.current?.scrollTo({top:0});
 };
 const jump=(direction:number)=>{
  if(!changes.length)return;
  const next=change<0?(direction>0?0:changes.length-1):(change+direction+changes.length)%changes.length,target=changes[next]!;
  const entry=entries.findIndex(value=>value.type==='row'&&value.index===target);
  if(entry<start||entry>=limit){
   const size=view==='source'?300:40,nextStart=Math.max(0,entry-Math.floor(size/4));
   setStart(nextStart);setLimit(nextStart+size);
  }
  setChange(next);setPendingJump(target);
 };
 useEffect(()=>{
  if(pendingJump===null)return;
  const target=scrollRef.current?.querySelector<HTMLElement>('[data-diff-index="'+pendingJump+'"]');
  target?.scrollIntoView({block:'start',behavior:'instant'});
  target?.focus({preventScroll:true});
  setPendingJump(null);
 },[pendingJump,limit]);
 const richChanges=diff.rows.some(row=>row.kind!=='unchanged');
 const lineEnding=(value:string)=>/\r\n/.test(value)?/(?<!\r)\n/.test(value)?'混合 CRLF / LF':'CRLF':'LF';
 const endingChanged=lineEnding(before)!==lineEnding(after);

 return <div className="revision-diff-content">
  <div className="revision-diff-toolbar">
   <ButtonGroup label="对比视图" size="sm">
    <Button label="预览" icon={<Icon name="eye" size="sm"/>} variant={view==='preview'?'secondary':'ghost'}
     isDisabled={diff.limited} aria-pressed={view==='preview'} onClick={()=>switchView('preview')}/>
    <Button label="源码" icon={<Icon name="code" size="sm"/>} variant={view==='source'?'secondary':'ghost'}
     aria-pressed={view==='source'} onClick={()=>switchView('source')}/>
   </ButtonGroup>
   <div className="revision-diff-counts" aria-label={'新增 '+diff.addedLines+' 行，删除 '+diff.removedLines+' 行'}>
    <span data-kind="added">+{diff.addedLines}</span><span data-kind="removed">−{diff.removedLines}</span>
   </div>
   <div className="revision-diff-navigation">
    <span aria-live="polite">{change<0?changes.length+' 处修改':(change+1)+' / '+changes.length}</span>
    <IconButton label="上一个差异" size="sm" variant="ghost" icon={<Icon name="arrowUp" size="sm"/>}
     isDisabled={!changes.length} onClick={()=>jump(-1)}/>
    <IconButton label="下一个差异" size="sm" variant="ghost" icon={<Icon name="arrowDown" size="sm"/>}
     isDisabled={!changes.length} onClick={()=>jump(1)}/>
   </div>
  </div>
  <div className="revision-diff-scroll" ref={scrollRef} tabIndex={0} aria-label="版本差异内容">
   {!diff.changed?<div className="revision-diff-empty"><Icon name="check" size="lg"/><h3>两个版本的内容相同</h3><p>此次修订没有文稿内容变化。</p></div>
    :<>
     {diff.limited&&<p className="revision-diff-note">文档较大或差异较多，使用源码对比并分批展示。内容完整保留。</p>}
     {endingChanged&&<p className="revision-diff-note">换行格式：{lineEnding(before)} → {lineEnding(after)}</p>}
     {view==='preview'&&!richChanges&&<p className="revision-diff-note">空白或换行发生了变化，请切换源码核对。</p>}
     <div className={'revision-diff-file is-'+view}>
      <div className="revision-diff-file-heading"><Icon name="document" size="sm"/><span>{view==='preview'?'文档差异':'Markdown 源码'}</span><span>只读</span></div>
      {start>0&&<button type="button" className="revision-diff-context" onClick={()=>setStart(value=>Math.max(0,value-(view==='source'?300:40)))}><Icon name="arrowUp" size="sm"/>显示更早内容</button>}
      {visible.map(entry=>entry.type==='context'?<button type="button" key={'context:'+entry.start}
       className="revision-diff-context" onClick={()=>setExpanded(previous=>{
        const next=new Set(previous);
        // The run begins before its retained leading context.
        let start=entry.start;while(start>0&&rows[start-1]!.kind==='unchanged')start--;
        next.add(view+':'+start);return next;
       })}><Icon name="arrowsSort" size="sm"/><span>展开 {entry.end-entry.start} {view==='preview'?'段':'行'}未修改内容</span></button>
       :view==='source'?diff.limited&&(entry.row as RevisionSourceRow).ending===undefined
        ?<ChunkedSource row={entry.row as RevisionSourceRow} index={entry.index} key={entry.index}/>
        :<SourceRow row={entry.row as RevisionSourceRow} index={entry.index} key={entry.index}/>
       :<PreviewRow row={entry.row as RevisionDiffRow} index={entry.index} key={entry.index} sourceId={sourceId}
         highlight={inlineRows.has(entry.index)}
         definitions={(entry.row.kind==='removed'?diff.definitionsBefore:diff.definitionsAfter)}
         otherDefinitions={(entry.row.kind==='removed'?diff.definitionsAfter:diff.definitionsBefore)}
         referenceIndex={entry.row.kind==='removed'?beforeRefs:afterRefs}/>) }
     </div>
     {limit<entries.length&&<div className="revision-diff-more"><Button label={'继续显示'+(view==='source'?' 300 行':' 40 段')}
      variant="secondary" onClick={()=>setLimit(value=>value+(view==='source'?300:40))}/><span>还有 {entries.length-limit} 项</span></div>}
     {view==='preview'&&richChanges&&<p className="revision-diff-footnote">红色为删除，绿色为新增。格式、链接地址及隐藏内容可在源码中核对。</p>}
    </>}
  </div>
 </div>;
}

const PreviewRow=memo(function PreviewRow({row,index,sourceId,definitions,otherDefinitions,referenceIndex,highlight}:{
 row:RevisionDiffRow;index:number;sourceId:string;definitions:string;otherDefinitions:string;highlight:boolean;
 referenceIndex?:ReturnType<typeof collectRmdPreviewRefs>
}){
 const {block,kind}=row;
 const scope=useId();
 const raw=block.kind==='definition'||block.kind==='footnoteDefinition';
 const hidden=!projectRmdPreview(block.content).trim();
 const content=block.content+(raw?'':'\n\n'+definitions);
 const comparison=useMemo(()=>highlight&&row.compareContent&&kind!=='unchanged'
  ?{content:row.compareContent+'\n\n'+otherDefinitions,side:kind}:undefined,[highlight,row.compareContent,kind,otherDefinitions]);
 return <section className="revision-diff-block" data-kind={kind} data-diff-index={index} tabIndex={-1}
  aria-label={(kind==='removed'?'删除':kind==='added'?'新增':'未修改')+'，第 '+block.startLine+' 行'}>
  <div className="revision-diff-gutter" aria-hidden="true">{kind==='removed'?'−':kind==='added'?'+':''}</div>
  <div className="revision-diff-block-body">
   <div className="revision-diff-block-location">L{block.startLine}{block.endLine>block.startLine?'–'+block.endLine:''}</div>
   {raw?<pre className="revision-diff-raw">{block.content}</pre>:hidden?<p className="revision-diff-hidden">{kind==='unchanged'?'此段内容在预览中隐藏。':'隐藏内容发生变化，请在源码中查看。'}</p>
    :<MarkdownPreview content={content} sourceId={sourceId} referenceIndex={referenceIndex} comparison={comparison}
      isRevisionPreview idScope={'revision-'+scope+'-'}/>}
  </div>
 </section>;
});

const SourceRow=memo(function SourceRow({row,index}:{row:RevisionSourceRow;index?:number}){
 return <div className="revision-source-row" data-kind={row.kind} data-diff-index={index} tabIndex={-1}>
  <span className="revision-source-old-line" aria-label="旧行号">{row.oldLine??''}</span>
  <span className="revision-source-new-line" aria-label="新行号">{row.newLine??''}</span>
  <span className="revision-source-sign" aria-label={row.kind==='added'?'新增':row.kind==='removed'?'删除':'未修改'}>{row.kind==='added'?'+':row.kind==='removed'?'−':' '}</span>
  <code className="revision-source-text">{row.text||'\u00a0'}{row.ending&&(row.endingChanged||row.ending==='none')&&<span className="revision-source-ending">{row.ending==='none'?'无文末换行':row.ending}</span>}</code>
 </div>;
});

/** Oversized/complex comparisons retain all source but only mount a page per side. */
function ChunkedSource({row,index}:{row:RevisionSourceRow;index:number}){
 const [limit,setLimit]=useState(300);
 const lines=useMemo(()=>revisionSourcePage(row,limit),[row,limit]);
 return <section data-diff-index={index} tabIndex={-1} className="revision-diff-source-section">
  <div className="revision-diff-file-heading">{row.kind==='removed'?'旧版本':'新版本'}</div>
  {lines.values.map((line,i)=><SourceRow key={i} row={line}/>)}
  {lines.hasMore&&<div className="revision-diff-more"><Button label="继续显示 300 行" size="sm"
   onClick={()=>setLimit(value=>value+300)}/><span>已显示 {lines.values.length} 行</span></div>}
 </section>;
}
