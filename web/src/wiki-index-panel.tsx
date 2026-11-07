import React,{useEffect,useRef,useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Database,RefreshCw,Square} from 'lucide-react';
import {api} from './api';
import {useQueryClient} from '@tanstack/react-query';

type Page={scanned:number;matched:number;inserted:number;hasMore:boolean;nextCursor:string|null};
type Progress={scanned:number;matched:number;inserted:number;cursor:string|null;finished:boolean};
const initial:Progress={scanned:0,matched:0,inserted:0,cursor:null,finished:false};

/** Explicitly run the legacy Markdown backfill. Server work is bounded to
 * eight documents/request and guarded by their authoritative revisions.
 * Re-running a batch is safe; only missing derived rows are inserted. */
export function WikiIndexPanel(){
 const [state,setState]=useState<Progress>(initial);
 const [running,setRunning]=useState(false);
 const [error,setError]=useState('');
 const controller=useRef<AbortController|null>(null);
 const progress=useRef(state);progress.current=state;
 const qc=useQueryClient();
 useEffect(()=>()=>controller.current?.abort(),[]);
 const stop=()=>controller.current?.abort();
 const run=async()=>{
  if(running||state.finished)return;
  setError('');
  setRunning(true);
  const abort=new AbortController();
  controller.current=abort;
  let current=progress.current;
  try{
   // Avoid holding a single expensive request open for an entire library.
   // Large libraries can continue in subsequent batches without resetting.
   for(let batch=0;batch<100&&!abort.signal.aborted;batch++){
    const result=await api<Page>('/wiki/reindex',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({cursor:current.cursor??undefined,limit:8}),
     signal:abort.signal
    });
    current={scanned:current.scanned+result.scanned,
     matched:current.matched+result.matched,
     inserted:current.inserted+result.inserted,
     cursor:result.nextCursor,finished:!result.hasMore};
    progress.current=current;
    setState(current);
    if(current.finished)break;
   }
   await Promise.all([
    qc.invalidateQueries({queryKey:['relations']}),
    qc.invalidateQueries({queryKey:['knowledge-graph']})
   ]);
  }catch(e){
   if(!abort.signal.aborted)setError(e instanceof Error?e.message:'知识引用索引补建失败');
  }finally{
   controller.current=null;
   setRunning(false);
  }
 };
 return <Card className="settings-panel" padding={5}>
  <h2><Database size={17} style={{verticalAlign:'text-bottom',marginRight:8}}/>Wiki 引用索引</h2>
  <p className="muted small">新建或编辑文档时，正文中的 <code>[[id:UUID]]</code>、<code>[[/路径]]</code> 与 <code>{'{{embed:…}}'}</code> 会自动建立双向引用。
   对于升级前就存在的 Markdown，可以执行一次补建，识别已有语法。</p>
  <p className="muted small">仅补建自动引用关系，不会修改正文、版本历史、手动关系或向量索引；遇到其他 Agent 正在修改的文档会跳过过期结果。支持中途停止并继续。</p>
  <div className="row gap">
   <Button label={state.finished?'补建完成':state.cursor?'继续补建':'扫描旧文档'}
    variant="secondary" icon={<RefreshCw size={15}/>} isDisabled={running||state.finished}
    isLoading={running} onClick={()=>void run()}/>
   {running&&<Button label="停止" variant="ghost" icon={<Square size={14}/>} onClick={stop}/>}
   {state.finished&&<Button label="重新扫描" variant="ghost" size="sm"
    onClick={()=>{progress.current=initial;setState(initial);setError('');}}/>}
  </div>
  {(state.scanned>0||running)&&<p className="muted small" role="status">
   已扫描 {state.scanned} 篇文档，发现 Wiki 语法 {state.matched} 篇，补建 {state.inserted} 条引用。
   {state.finished?' 全库扫描完成。':running?' 正在扫描…':' 可继续下一批。'}
  </p>}
  {error&&<Banner status="error" container="section" title="Wiki 索引补建失败" description={error}/>}
 </Card>;
}
