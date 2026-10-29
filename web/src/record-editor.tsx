import React,{useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Save,History,Code2,Type,AlertTriangle,RotateCcw,Diff} from 'lucide-react';
import {ApiError,api,mutate,versions} from './api';
import {useAppearance} from './theme';
import type {RecordDetail} from './types';

const VisualEditor=React.lazy(()=>import('./visual-editor'));
const SourceEditor=React.lazy(()=>import('./source-editor'));
const MarkdownPreview=React.lazy(()=>import('./markdown-preview'));

export function RecordEditor({item,onSaved,jumpToLine}:{item:RecordDetail;onSaved:()=>void;jumpToLine?:{line:number;token:number}|null}){
 const initialMode=new URLSearchParams(location.search).get('mode');
 const [mode,setMode]=useState<'visual'|'source'|'preview'>(initialMode==='source'||initialMode==='preview'?initialMode:'visual'),[draft,setDraft]=useState(item.content),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[warning,setWarning]=useState(''),[history,setHistory]=useState(false),[diff,setDiff]=useState('');
 const {mode:theme}=useAppearance();
 useEffect(()=>{if(!jumpToLine)return;setMode('source');const url=new URL(location.href);url.searchParams.set('mode','source');historyReplace(url);},[jumpToLine]);
 const changed=draft!==item.content;
 useEffect(()=>{if(!changed)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[changed]);
 const switchMode=(next:'visual'|'source'|'preview')=>{setWarning('');setMode(next);const url=new URL(location.href);url.searchParams.set('mode',next);historyReplace(url);};
 const save=async()=>{setBusy(true);setError(null);try{await mutate('/records/'+item.id+'/content',{expectedRevision:item.revision,content:draft,message:'Web editor update'},'PATCH');onSaved();}catch(e){setError(e);}finally{setBusy(false);}};
 const versionsQuery=useQuery({queryKey:['versions',item.id],queryFn:()=>versions(item.id),enabled:history});
 const showDiff=async(rev:number)=>{try{const value=await api<{diff?:string;patch?:string;changed:boolean}>('/records/'+item.id+'/diff?from='+rev+'&to='+item.revision);setDiff(value.diff||value.patch||JSON.stringify(value,null,2));}catch(e){setError(e);}};
 const restore=async(rev:number)=>{if(changed||!confirm('恢复历史版本会创建新的当前 Revision。确定继续吗？'))return;setBusy(true);try{await mutate('/records/'+item.id+'/restore',{targetRevision:rev,expectedRevision:item.revision});onSaved();}catch(e){setError(e);}finally{setBusy(false);}};
 return <div className="editor-section"><div className="editor-topline"><div className="mode-switch"><button type="button" className={mode==='visual'?'active':''} onClick={()=>switchMode('visual')}><Type size={15}/>可视化</button><button type="button" className={mode==='source'?'active':''} onClick={()=>switchMode('source')}><Code2 size={15}/>Markdown</button><button type="button" className={mode==='preview'?'active':''} onClick={()=>switchMode('preview')}>预览</button></div><div className="row gap"><span className="muted tiny">R{item.revision}{changed?' · 未保存':''}</span><Button label="历史" icon={<History size={15}/>} size="sm" onClick={()=>setHistory(v=>!v)}/><Button label="保存" icon={<Save size={15}/>} variant="primary" size="sm" onClick={save} isDisabled={!changed||busy} isLoading={busy}/></div></div>
 {Boolean(error)&&<div className="error-banner" role="alert"><AlertTriangle size={16}/>{error instanceof ApiError&&error.status===409?'保存失败：记录已被其他客户端修改。请先复制当前编辑内容，再重新加载记录以核对差异。':error instanceof Error?error.message:'保存失败'}{error instanceof ApiError&&error.status===409&&<Button label="重新加载" onClick={onSaved}/>}</div>}
 {warning&&<div className="warning-banner"><AlertTriangle size={16}/>{warning}</div>}
 <div className="editor-body">{mode==='preview'?<React.Suspense fallback={<div className="content-loading">正在生成预览…</div>}><MarkdownPreview content={draft}/></React.Suspense>:mode==='source'?<React.Suspense fallback={<div className="content-loading">加载 Markdown 编辑器…</div>}><SourceEditor value={draft} onChange={setDraft} focusLine={jumpToLine?.line} focusToken={jumpToLine?.token} dark={theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)}/></React.Suspense>:<React.Suspense fallback={<div className="content-loading">加载可视化编辑器…</div>}><VisualEditor value={draft} onChange={setDraft} onUnsafe={()=>{setWarning('此文档包含可视化模式暂不支持或会重排的 Markdown 语法；已安全切换为源码模式。可使用“预览”查看 GFM、公式与安全 HTML，原文未修改。');setMode('source');}}/></React.Suspense>}</div>
 {history&&<div className="history-panel"><div className="panel-heading"><h2>版本历史</h2><button className="icon-button" aria-label="关闭历史" onClick={()=>setHistory(false)}>×</button></div>{versionsQuery.isPending?<p className="muted">加载版本…</p>:versionsQuery.isError?<p className="error-banner">{versionsQuery.error.message}</p>:versionsQuery.data?.items.map(v=><div className="history-row" key={v.revision}><div><strong>Revision {v.revision}</strong><p className="muted small">{v.message||'修改'} · {v.actor||''}</p></div><div className="row gap"><Button label="比较" size="sm" icon={<Diff size={14}/>} onClick={()=>showDiff(v.revision)} isDisabled={v.revision===item.revision}/><Button label="恢复" size="sm" icon={<RotateCcw size={14}/>} isDisabled={changed||v.revision===item.revision||busy} onClick={()=>restore(v.revision)}/></div></div>)}{diff&&<pre className="diff-output">{diff}</pre>}</div>}
 </div>;
}
function historyReplace(url:URL){window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
