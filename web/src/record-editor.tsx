import React,{useEffect,useRef,useState} from 'react';
import type {VisualEditorHandle} from './visual-editor';
import {useBlocker} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {Dialog} from '@astryxdesign/core/Dialog';
import {Save,History,Code2,Type,AlertTriangle,RotateCcw,Diff} from 'lucide-react';
import {ApiError,api,mutate,versions} from './api';
import {useAppearance} from './theme';
import {ContextPanel} from './context-panel';
import {readSessionDraft,writeSessionDraft,clearSessionDraft,isLogoutNavigationApproved,setActiveEditorDirty} from './session-drafts';
import type {RecordDetail} from './types';

const VisualEditor=React.lazy(()=>import('./visual-editor'));
const SourceEditor=React.lazy(()=>import('./source-editor'));
const MarkdownPreview=React.lazy(()=>import('./markdown-preview'));

export function RecordEditor({item,onSaved,jumpToLine}:{item:RecordDetail;onSaved:()=>void;jumpToLine?:{line:number;token:number}|null}){
 const initialMode=new URLSearchParams(location.search).get('mode');
 const visualRef=useRef<VisualEditorHandle>(null);
 const qc=useQueryClient();
 const sessionId=qc.getQueryData<{session?:{id:string}}>(['auth-session'])?.session?.id??'';
 const [stored]=useState(()=>readSessionDraft(sessionId,item.id));
 const usableRecovery=stored&&stored.content!==item.content&&stored.revision===item.revision;
 const staleRecovery=stored&&stored.content!==item.content&&stored.revision!==item.revision;
 const [recoveryNotice,setRecoveryNotice]=useState(Boolean(usableRecovery||staleRecovery));
 const [mode,setMode]=useState<'visual'|'source'|'preview'>(initialMode==='source'||initialMode==='preview'?initialMode:'visual');
 const [draft,setDraft]=useState(usableRecovery?stored.content:item.content);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[warning,setWarning]=useState(''),[history,setHistory]=useState(false),[diff,setDiff]=useState('');
 const [editorKey,setEditorKey]=useState(0);
 const latestDraft=useRef(draft);
 const {mode:theme}=useAppearance();
 const changed=draft!==item.content;
 useEffect(()=>{setActiveEditorDirty(changed||busy);return()=>setActiveEditorDirty(false);},[changed,busy]);
 const changeDraft=(value:string)=>{
  latestDraft.current=value;
  setDraft(value);
  // Editing the current document constitutes an explicit choice to use the
  // current revision instead of the older recovery candidate.
  if(staleRecovery)setRecoveryNotice(false);
 };
 useEffect(()=>{if(!jumpToLine)return;setMode('source');const url=new URL(location.href);url.searchParams.set('mode','source');historyReplace(url);},[jumpToLine]);
 useEffect(()=>{
  if(changed&&!busy)writeSessionDraft(sessionId,item.id,item.revision,draft);
 },[changed,busy,draft,sessionId,item.id,item.revision]);
 const blocker=useBlocker({
  shouldBlockFn:({current,next})=>!isLogoutNavigationApproved()&&(changed||busy)&&current.pathname!==next.pathname,
  enableBeforeUnload:()=>!isLogoutNavigationApproved()&&(changed||busy),
  disabled:!changed&&!busy,
  withResolver:true
 });
 const closeBlocker=()=>{if(blocker.status==='blocked')blocker.reset();};
 const keepAndLeave=()=>{
  if(blocker.status!=='blocked'||busy)return;
  const latest=mode==='visual'?visualRef.current?.flushEditedMarkdown()??latestDraft.current:latestDraft.current;
  if(latest!==item.content&&!writeSessionDraft(sessionId,item.id,item.revision,latest)){setError(new Error('浏览器无法暂存草稿。内容仍保留在当前编辑器，请先复制或保存后再离开。'));blocker.reset();return;}
  blocker.proceed();
 };
 const discardAndLeave=()=>{
  if(blocker.status!=='blocked'||busy)return;
  clearSessionDraft(sessionId,item.id);
  blocker.proceed();
 };
 const settleVisualInput=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 const switchMode=async(next:'visual'|'source'|'preview')=>{
  if(next===mode)return;
  if(mode==='visual'){
   await settleVisualInput();
   const latest=visualRef.current?.flushEditedMarkdown();
   if(latest!==null&&latest!==undefined)changeDraft(latest);
  }
  setWarning('');setMode(next);
  const url=new URL(location.href);url.searchParams.set('mode',next);historyReplace(url);
 };
 const save=async()=>{
  if(busy)return;
  if(mode==='visual')await settleVisualInput();
  const latest=mode==='visual'?visualRef.current?.flushEditedMarkdown()??latestDraft.current:latestDraft.current;
  if(latest===item.content)return;
  changeDraft(latest);setBusy(true);setError(null);
  try{
   await mutate('/records/'+item.id+'/content',{expectedRevision:item.revision,content:latest,message:'Web editor update'},'PATCH');
   if(latestDraft.current===latest){
    clearSessionDraft(sessionId,item.id);
   }else{
    // Further edits made during save must survive the record query refresh.
    writeSessionDraft(sessionId,item.id,item.revision,latestDraft.current);
   }
   onSaved();
  }catch(e){setError(e);}
  finally{setBusy(false);}
 };
 const versionsQuery=useQuery({queryKey:['versions',item.id],queryFn:()=>versions(item.id),enabled:history});
 const showDiff=async(rev:number)=>{try{const value=await api<{diff?:string;patch?:string;changed:boolean}>('/records/'+item.id+'/diff?from='+rev+'&to='+item.revision);setDiff(value.diff||value.patch||JSON.stringify(value,null,2));}catch(e){setError(e);}};
 const restore=async(rev:number)=>{if(changed||!confirm('恢复历史版本会创建新的当前 Revision。确定继续吗？'))return;setBusy(true);try{await mutate('/records/'+item.id+'/restore',{targetRevision:rev,expectedRevision:item.revision});onSaved();}catch(e){setError(e);}finally{setBusy(false);}};
 const discardRecovered=()=>{
  clearSessionDraft(sessionId,item.id);latestDraft.current=item.content;setDraft(item.content);setEditorKey(key=>key+1);setRecoveryNotice(false);
 };
 return <div className="editor-section">
  <div className="editor-topline"><ButtonGroup label="编辑模式" size="sm"><Button label="可视化" icon={<Type size={15}/>} variant={mode==='visual'?'primary':'ghost'} onClick={()=>switchMode('visual')}/><Button label="Markdown" icon={<Code2 size={15}/>} variant={mode==='source'?'primary':'ghost'} onClick={()=>switchMode('source')}/><Button label="预览" variant={mode==='preview'?'primary':'ghost'} onClick={()=>switchMode('preview')}/></ButtonGroup><div className="row gap"><span className="muted tiny">R{item.revision}{changed?' · 未保存':''}</span><Button label="历史" icon={<History size={15}/>} size="sm" onClick={()=>setHistory(v=>!v)}/><Button label="保存" icon={<Save size={15}/>} variant="primary" size="sm" onClick={save} isDisabled={!changed||busy} isLoading={busy}/></div></div>
  {recoveryNotice&&usableRecovery&&<div className="draft-recovery-banner" role="status"><div><strong>已恢复本标签页未保存的草稿</strong><p>草稿属于当前 Revision，保存后才会写入知识库。</p></div><Button label="丢弃恢复的草稿" variant="secondary" size="sm" onClick={discardRecovered}/></div>}
  {recoveryNotice&&staleRecovery&&<div className="draft-recovery-banner" role="status"><div><strong>发现旧版本的未保存草稿</strong><p>草稿来自 R{stored.revision}，当前是 R{item.revision}。为避免覆盖 Agent 或其他设备的更新，未自动恢复。</p></div><div className="row gap"><Button label="复制旧草稿" size="sm" onClick={()=>navigator.clipboard.writeText(stored.content)}/><Button label="丢弃旧草稿" size="sm" variant="secondary" onClick={()=>{clearSessionDraft(sessionId,item.id);setRecoveryNotice(false);}}/></div></div>}
  {Boolean(error)&&<div className="error-banner" role="alert"><AlertTriangle size={16}/>{error instanceof ApiError&&error.status===409?'保存失败：记录已被其他客户端修改。草稿已保留，请重新载入并核对差异后手动合并。':error instanceof Error?error.message:'保存失败'}{error instanceof ApiError&&error.status===409&&<Button label="重新加载" onClick={onSaved}/>}</div>}
  {warning&&<div className="warning-banner"><AlertTriangle size={16}/>{warning}</div>}
  <div className="editor-body editor-view" key={mode+':'+editorKey} aria-busy={busy}>{mode==='preview'?<React.Suspense fallback={<div className="content-loading">正在生成预览…</div>}><MarkdownPreview content={draft}/></React.Suspense>:mode==='source'?<React.Suspense fallback={<div className="content-loading">加载 Markdown 编辑器…</div>}><SourceEditor value={draft} onChange={changeDraft} focusLine={jumpToLine?.line} focusToken={jumpToLine?.token} dark={theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)}/></React.Suspense>:<React.Suspense fallback={<div className="content-loading">加载可视化编辑器…</div>}><VisualEditor ref={visualRef} value={draft} onChange={changeDraft} onUnsafe={()=>{setWarning('此文档包含可视化模式暂不支持或会重排的 Markdown 语法；已安全切换为源码模式。可使用“预览”查看 GFM、公式与安全 HTML，原文未修改。');setMode('source');}}/></React.Suspense>}</div>
  <ContextPanel open={history} onOpenChange={setHistory} label="版本历史"><div className="history-panel"><div className="panel-heading"><h2>版本历史</h2><IconButton variant="ghost" label="关闭历史" icon={<span aria-hidden="true">×</span>} onClick={()=>setHistory(false)}/></div>{versionsQuery.isPending?<p className="muted">加载版本…</p>:versionsQuery.isError?<p className="error-banner">{versionsQuery.error.message}</p>:versionsQuery.data?.items.map(v=><div className="history-row" key={v.revision}><div><strong>Revision {v.revision}</strong><p className="muted small">{v.message||'修改'} · {v.actor||''}</p></div><div className="row gap"><Button label="比较" size="sm" icon={<Diff size={14}/>} onClick={()=>showDiff(v.revision)} isDisabled={v.revision===item.revision}/><Button label="恢复" size="sm" icon={<RotateCcw size={14}/>} isDisabled={changed||v.revision===item.revision||busy} onClick={()=>restore(v.revision)}/></div></div>)}{diff&&<pre className="diff-output">{diff}</pre>}</div></ContextPanel>
  <Dialog isOpen={blocker.status==='blocked'} onOpenChange={open=>{if(!open)closeBlocker();}} width={440} padding={4} purpose="info" aria-label="未保存的编辑内容">
   <div className="draft-leave-dialog"><h2>还有未保存的编辑内容</h2><p>离开后当前编辑器将关闭。可以先保留本标签页草稿，下次进入此文档时自动恢复；也可以明确丢弃。</p><div className="draft-leave-actions"><Button label="留在编辑器" variant="primary" onClick={closeBlocker}/><Button label="保留草稿并离开" variant="secondary" isDisabled={busy} onClick={keepAndLeave}/><Button label="丢弃更改并离开" variant="destructive" isDisabled={busy} onClick={discardAndLeave}/></div></div>
  </Dialog>
 </div>;
}
function historyReplace(url:URL){window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
