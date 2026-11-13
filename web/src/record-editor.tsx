import './styles/features/rmd.css';
import './styles/features/editor-chrome.css';
import {Icon} from './icon';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {VisualEditorHandle} from './visual-editor';
import {useBlocker} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {Dialog} from '@astryxdesign/core/Dialog';
import {Banner} from '@astryxdesign/core/Banner';

import {ApiError,api,mutate,versions} from './api';
import {PageActions} from './page-chrome';
import {readSessionDraft,writeSessionDraft,clearSessionDraft,readSessionMergeBackup,writeSessionMergeBackup,clearSessionMergeBackup,isLogoutNavigationApproved,setActiveEditorDirty} from './session-drafts';
import {useConfirmDialog} from './confirm-dialog';
import type {RecordDetail} from './types';
import {VisualEditorChunk as VisualEditor,SourceEditorChunk as SourceEditor,PreviewEditorChunk as PreviewEditor,type EditorMode} from './editor-chunks';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {observeMathHorizontalOverflow} from './math-scroll';
import {markdownCharacterCount} from './document-heading';
import type {DocumentPresentation} from './record-workbench';
import {planThreeWayMerge,resolveThreeWayMerge,preserveUnchangedVisualTerminator,type MergeChoice} from './three-way-merge';
import {checkMergeStructure} from './merge-structure-check';
import type {MergeReview} from './editor-merge-review';

const EditorMergeReview=React.lazy(()=>import('./editor-merge-review')
 .then(mod=>({default:mod.EditorMergeReview})));


export function RecordEditor({item,onSaved,jumpToLine,pageActions,archiveNotice,onOpenHistory,historyTarget,onDocumentPresentation}:{item:RecordDetail;onSaved:(content?:string)=>void;jumpToLine?:{line:number;token:number}|null;pageActions?:React.ReactNode;archiveNotice?:React.ReactNode;onOpenHistory:()=>void;historyTarget:HTMLDivElement|null;onDocumentPresentation:(value:DocumentPresentation)=>void}){
 const initialMode=new URLSearchParams(location.search).get('mode');
 const visualRef=useRef<VisualEditorHandle>(null);
 const editorSectionRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const root=editorSectionRef.current;
  return root?observeMathHorizontalOverflow(root):undefined;
 },[]);
 const qc=useQueryClient();
 const sessionId=qc.getQueryData<{session?:{id:string}}>(['auth-session'])?.session?.id??'';
 // The editing base is pinned to the revision opened by this tab.
 // Background record refresh must never replace its local editing state.
 const [base,setBase]=useState<RecordDetail>(()=>item);
 const [stored]=useState(()=>readSessionDraft(sessionId,item.id));
 const usableRecovery=stored&&stored.content!==base.content&&stored.revision===base.revision;
 const staleRecovery=stored&&stored.content!==base.content&&stored.revision!==base.revision;
 const [recoveryNotice,setRecoveryNotice]=useState(Boolean(usableRecovery||staleRecovery));
 const [mode,setMode]=useState<EditorMode>(initialMode==='source'||initialMode==='preview'?initialMode:'visual');
 const {confirm:askConfirm,confirmation}=useConfirmDialog();
 const [draft,setDraft]=useState(usableRecovery?stored.content:base.content);
 const deferredDraft=React.useDeferredValue(draft);
 const characters=React.useMemo(()=>markdownCharacterCount(deferredDraft),[deferredDraft]);
 const visibleDraft=draft;
 const visibleFocusLine=jumpToLine?.line;
 useEffect(()=>onDocumentPresentation({id:item.id,revision:base.revision,characters}),[item.id,base.revision,characters]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[warning,setWarning]=useState(''),[diff,setDiff]=useState('');
 const [mergeBusy,setMergeBusy]=useState(false);
 const [mergeReview,setMergeReview]=useState<MergeReview|null>(null);
 const [mergeBackup,setMergeBackup]=useState(()=>readSessionMergeBackup(sessionId,item.id));
 const [editorKey,setEditorKey]=useState(0);
 const latestDraft=useRef(draft);
 const hasCurrentDraft=useRef(Boolean(usableRecovery));
 const changed=draft!==base.content;
 const remoteAhead=item.revision>base.revision;
 useEffect(()=>{setActiveEditorDirty(changed||busy);return()=>setActiveEditorDirty(false);},[changed,busy]);
 const changeDraft=(value:string)=>{
  latestDraft.current=value;
  setDraft(value);
  // Editing the current document constitutes an explicit choice to use the
  // current revision instead of the older recovery candidate.
  if(staleRecovery)setRecoveryNotice(false);
 };
 const changeVisibleDraft=changeDraft;
 const latestVisibleFromEditor=()=>visualRef.current?.flushEditedMarkdown()??latestDraft.current;
 useEffect(()=>{if(!jumpToLine)return;setMode('source');const url=new URL(location.href);url.searchParams.set('mode','source');historyReplace(url);},[jumpToLine]);
 useEffect(()=>{
  if(busy)return;
  if(changed){
   // Track drafts written for this revision, not an unrelated stale copy.
   if(writeSessionDraft(sessionId,item.id,base.revision,draft))hasCurrentDraft.current=true;
  }else if(hasCurrentDraft.current){
   // A full Undo should clear the emergency draft as well as the dirty UI.
   const storedDraft=readSessionDraft(sessionId,item.id);
   if(storedDraft?.revision===base.revision)clearSessionDraft(sessionId,item.id);
   hasCurrentDraft.current=false;
  }
 },[changed,busy,draft,sessionId,item.id,base.revision]);
 const blocker=useBlocker({
  shouldBlockFn:({current,next})=>!isLogoutNavigationApproved()&&(changed||busy)&&current.pathname!==next.pathname,
  enableBeforeUnload:()=>!isLogoutNavigationApproved()&&(changed||busy),
  disabled:!changed&&!busy,
  withResolver:true
 });
 const closeBlocker=()=>{if(blocker.status==='blocked')blocker.reset();};
 const keepAndLeave=()=>{
  if(blocker.status!=='blocked'||busy)return;
  const latest=mode==='visual'?latestVisibleFromEditor():latestDraft.current;
  if(latest!==base.content&&!writeSessionDraft(sessionId,item.id,base.revision,latest)){setError(new Error('浏览器无法暂存草稿。内容仍保留在当前编辑器，请先复制或保存后再离开。'));blocker.reset();return;}
  blocker.proceed();
 };
 const discardAndLeave=()=>{
  if(blocker.status!=='blocked'||busy)return;
  clearSessionDraft(sessionId,item.id);
  blocker.proceed();
 };
 const settleVisualInput=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 const switchMode=async(next:EditorMode)=>{
  if(next===mode)return;
  if(mode==='visual'){
   await settleVisualInput();
   const latest=visualRef.current?.flushEditedMarkdown();
   if(latest!==null&&latest!==undefined)changeVisibleDraft(latest);
  }
  setWarning('');
  // Commit the requested mode to the URL before awaiting the lazy chunk.
  // Preserve this mode in the URL across explicit remote-version adoption.
  const url=new URL(location.href);url.searchParams.set('mode',next);historyReplace(url);
  // Prefer a fully warmed view, but never leave the mode button unresponsive
  // if a cold code chunk takes longer to arrive. Suspense already owns the
  // fallback while that chunk completes downloading.
  const warm=(next==='source'?SourceEditor:next==='preview'?PreviewEditor:VisualEditor).preload().catch(()=>undefined);
  await Promise.race([warm,new Promise<void>(resolve=>setTimeout(resolve,350))]);
  setMode(next);
 };
 const save=async()=>{
  if(busy||mergeBusy||remoteAhead)return;
  if(mode==='visual')await settleVisualInput();
  const latest=mode==='visual'?latestVisibleFromEditor():latestDraft.current;
  if(latest===base.content)return;
  changeDraft(latest);setBusy(true);setError(null);
  try{
   const saved=await mutate<{revision:number}>('/records/'+item.id+'/content',{expectedRevision:base.revision,content:latest,message:'Web editor update'},'PATCH');
   // Move the CAS base forward only after the server accepted this revision.
   // Do not rebuild the editing instance or discard its selection/history.
   setBase(previous=>({...previous,revision:saved.revision,content:latest}));
   if(latestDraft.current===latest){
    clearSessionDraft(sessionId,item.id);
    hasCurrentDraft.current=false;
   }else{
    // Further edits made during save must survive the record query refresh.
    hasCurrentDraft.current=writeSessionDraft(sessionId,item.id,saved.revision,latestDraft.current);
   }
   setRecoveryNotice(false);
   onSaved(latest);
  }catch(e){
   setError(e);
   // On 409, fetch the winning revision for the notice without replacing the
   // pinned editing base or clearing the local draft.
   if(e instanceof ApiError&&e.status===409)void qc.invalidateQueries({queryKey:['record',item.id]});
  }
  finally{setBusy(false);}
 };
 const saveRef=useRef(save);
 saveRef.current=save;
 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{
   if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();void saveRef.current();}
  };
  window.addEventListener('keydown',handler);
  return()=>window.removeEventListener('keydown',handler);
 },[]);
 const versionsQuery=useQuery({queryKey:['versions',item.id],queryFn:()=>versions(item.id),enabled:Boolean(historyTarget)});
 const showDiff=async(rev:number)=>{try{const value=await api<{diff?:string;patch?:string;changed:boolean}>('/records/'+item.id+'/diff?from='+rev+'&to='+item.revision);setDiff(value.diff||value.patch||JSON.stringify(value,null,2));}catch(e){setError(e);}};
 const restore=async(rev:number)=>{
  if(changed||remoteAhead||busy||!(await askConfirm({title:'恢复历史版本？',description:'这会将所选版本的内容创建为一个新的当前 Revision，不会覆盖已有历史。',actionLabel:'恢复该版本'})))return;
  setBusy(true);setError(null);
  try{
   const saved=await mutate<{revision:number}>('/records/'+item.id+'/restore',
    {targetRevision:rev,expectedRevision:base.revision});
   // Restoring is an explicit editor reset, unlike an ordinary query refresh.
   // Read the accepted revision, rather than trusting a later race on latest.
   const restored=await api<RecordDetail>('/records/'+item.id+'?revision='+saved.revision);
   clearSessionDraft(sessionId,item.id);hasCurrentDraft.current=false;
   latestDraft.current=restored.content;
   setBase(restored);setDraft(restored.content);
   setEditorKey(key=>key+1);setRecoveryNotice(false);
   onSaved();
  }catch(e){
   setError(e);
   if(e instanceof ApiError&&e.status===409)void qc.invalidateQueries({queryKey:['record',item.id]});
  }finally{setBusy(false);}
 };
 const discardRecovered=()=>{
  clearSessionDraft(sessionId,item.id);latestDraft.current=base.content;setDraft(base.content);
  setEditorKey(key=>key+1);setRecoveryNotice(false);
 };
 const loadRemote=async()=>{
  if(busy||!remoteAhead)return;
  if(changed&&!(await askConfirm({
   title:'放弃本地修改并加载新版？',
   description:'当前编辑基于 R'+base.revision+'，服务器已有 R'+item.revision+'。这将明确丢弃本标签页的修改与撤销历史，并载入服务器内容。若要保留，请先取消并复制或暂存草稿。',
   actionLabel:'放弃本地修改',destructive:true
  })))return;
  clearSessionDraft(sessionId,item.id);
  hasCurrentDraft.current=false;
  latestDraft.current=item.content;
  setBase(item);setDraft(item.content);
  setEditorKey(key=>key+1);
  setRecoveryNotice(false);setError(null);setWarning('');
 };
 const openMerge=async()=>{
  if(busy||mergeBusy||!remoteAhead||!changed)return;
  if(mode==='visual')await settleVisualInput();
  const local=mode==='visual'?latestVisibleFromEditor():latestDraft.current;
  if(local===base.content)return;
  setMergeBusy(true);setError(null);
  // Warm the review UI concurrently with the authoritative content fetch.
  void import('./editor-merge-review');
  try{
   // Read authoritative remote content, never trust a potentially stale
   // React Query cache or the earlier 409 response for this merge preview.
   const remote=await api<RecordDetail>('/records/'+item.id);
   if(remote.revision<=base.revision){
    setWarning('当前已没有新的远端 Revision。');return;
   }
   setMergeReview({fromRevision:base.revision,remoteRevision:remote.revision,
    remote:remote.content,local,
    plan:planThreeWayMerge(base.content,mode==='visual'
     ?preserveUnchangedVisualTerminator(base.content,local):local,remote.content),
    choices:{},custom:{}});
  }catch(e){setError(e);}
  finally{setMergeBusy(false);}
 };
 const chooseMerge=(id:number,choice:MergeChoice)=>setMergeReview(previous=>previous
  ?{...previous,choices:{...previous.choices,[id]:choice}}:null);
 const editMerge=(id:number,value:string)=>setMergeReview(previous=>previous
  ?{...previous,choices:{...previous.choices,[id]:'custom'},
   custom:{...previous.custom,[id]:value}}:null);
 const applyMerge=async(output:string,strategy:'save'|'stage')=>{
  const review=mergeReview;
  if(!review||busy||mergeBusy)return;
  const resolved=resolveThreeWayMerge(review.plan,review.choices,review.custom);
  if(resolved===null||resolved!==output)return;
  if(mode==='visual')await settleVisualInput();
  const local=mode==='visual'?latestVisibleFromEditor():latestDraft.current;
  if(local!==review.local){
   setMergeReview(null);
   setWarning('本地正文已在审查期间改变，请重新生成合并预览。');
   return;
  }
  setMergeBusy(true);setError(null);
  try{
   const remote=await api<RecordDetail>('/records/'+item.id);
   if(remote.revision!==review.remoteRevision||remote.content!==review.remote){
    setMergeReview(null);
    setWarning('审查期间服务器再次更新，原合并预览已失效，请重新比较最新版本。');
    void qc.invalidateQueries({queryKey:['record',item.id]});
    return;
   }
   if(strategy==='stage'){
    // A new conflict must not silently overwrite an earlier merge backup.
    // Resolve or explicitly discard that backup first; leave this editor
    // and its source untouched until the user does so.
    if(readSessionMergeBackup(sessionId,item.id)){
     setMergeReview(null);
     setWarning('已有更早的合并草稿备份。请先恢复或明确删除旧备份，再重新审查本次合并，避免覆盖尚未处理的原稿。');
     return;
    }
    // An explicit resolution of ambiguous or RMD content is never auto-saved.
    // Preserve the unmerged original in an independent tab-scoped backup.
    if(!writeSessionMergeBackup(sessionId,item.id,review.fromRevision,base.content,review.local))
     throw new Error('浏览器无法保存合并前的本地备份，已停止操作。');
    const savedBackup=readSessionMergeBackup(sessionId,item.id);
    if(output!==remote.content&&!writeSessionDraft(sessionId,item.id,remote.revision,output))
     throw new Error('浏览器无法暂存合并结果，已保留原编辑器内容。');
    if(output===remote.content)clearSessionDraft(sessionId,item.id);
    setMergeBackup(savedBackup);
    hasCurrentDraft.current=output!==remote.content;
    latestDraft.current=output;
    setBase(remote);setDraft(output);
    setEditorKey(key=>key+1);
    setMode('source');
    const url=new URL(location.href);url.searchParams.set('mode','source');historyReplace(url);
    setRecoveryNotice(false);setMergeReview(null);
    setWarning('合并结果已载入源码编辑器，尚未保存至服务器。请核对后使用保存按钮；合并前的本地草稿另有备份。');
    return;
   }
   // Only conflict-free, structurally safe plans can write immediately.
   // Even a crafted UI state must not save an invalid structured candidate.
   if(review.plan.conflictCount>0||review.plan.reason==='limit'
    ||checkMergeStructure(output).some(issue=>issue.severity==='error'))return;
   const saved=output===remote.content?{revision:remote.revision}
    :await mutate<{revision:number}>('/records/'+item.id+'/content',
      {expectedRevision:remote.revision,content:output,message:'Web editor three-way merge'},'PATCH');
   latestDraft.current=output;
   setBase({...remote,revision:saved.revision,content:output});
   setDraft(output);setEditorKey(key=>key+1);
   clearSessionDraft(sessionId,item.id);hasCurrentDraft.current=false;
   setRecoveryNotice(false);setMergeReview(null);setWarning('');
   onSaved(output);
  }catch(e){
   setError(e);setMergeReview(null);
   if(e instanceof ApiError&&e.status===409){
    setWarning('合并提交期间服务器再次更新。所有本地修改仍保留，请重新审查。');
    void qc.invalidateQueries({queryKey:['record',item.id]});
   }
  }finally{setMergeBusy(false);}
 };
 const restoreMergeBackup=async()=>{
  if(!mergeBackup||busy||mergeBusy)return;
  if(changed&&!(await askConfirm({title:'恢复合并前的本地内容？',
   description:'这将替换当前未保存的编辑内容；服务器内容不会改变。',
   actionLabel:'恢复原始草稿',destructive:true})))return;
  const original={...base,revision:mergeBackup.baseRevision,content:mergeBackup.baseContent};
  if(!writeSessionDraft(sessionId,item.id,original.revision,mergeBackup.localContent)){
   setError(new Error('无法暂存原始草稿，已停止恢复操作。'));return;
  }
  setBase(original);latestDraft.current=mergeBackup.localContent;
  setDraft(mergeBackup.localContent);setEditorKey(key=>key+1);
  setMode('source');setRecoveryNotice(false);setWarning('');
  const url=new URL(location.href);url.searchParams.set('mode','source');historyReplace(url);
  hasCurrentDraft.current=true;
  clearSessionMergeBackup(sessionId,item.id);setMergeBackup(null);
 };
 return <div ref={editorSectionRef} data-base-revision={base.revision}
  data-remote-revision={item.revision} className="editor-section">{confirmation}
  <PageActions className="editor-topline" pinned={<>
   <AutoResizer animateWidth animateHeight={false} className="save-status-box"><AutoTransition as="span" mode="sync" transitionKey={busy?'busy':changed?'dirty':remoteAhead?'remote':'clean'} duration={.14}><span className={'save-status'+(changed||remoteAhead?' is-dirty':'')} title={changed?'按 Ctrl/⌘ + S 保存':remoteAhead?'服务器已有 R'+item.revision+'，当前仍为 R'+base.revision:'所有更改已保存'}>{busy?'保存中…':changed?'未保存':remoteAhead?'有新版':'已保存'}</span></AutoTransition></AutoResizer>
   <Button label="保存" icon={<Icon name="save"/>} variant={changed&&!remoteAhead?'primary':'ghost'} size="sm" onClick={save} isDisabled={!changed||busy||mergeBusy||remoteAhead} isLoading={busy}/>
  </>}>
   <div className="editor-view-switcher">
    <ButtonGroup label="内容视图" size="sm"><Button label="可视化" icon={<Icon name="typography"/>} variant={mode==='visual'?'secondary':'ghost'} onClick={()=>switchMode('visual')}/><Button label="源码" icon={<Icon name="code"/>} variant={mode==='source'?'secondary':'ghost'} onClick={()=>switchMode('source')}/><Button label="预览" icon={<Icon name="eye"/>} variant={mode==='preview'?'secondary':'ghost'} onClick={()=>switchMode('preview')}/></ButtonGroup>
   </div>
   <div className="editor-view-actions">
    <IconButton variant="ghost" size="sm" label="历史" icon={<Icon name="versionHistory"/>} onClick={onOpenHistory}/>
    {pageActions}
   </div>
  </PageActions>
  <AutoResizer><div className="doc-notice">
  {archiveNotice}
  {remoteAhead&&<Banner status="warning" container="section"
   title={'远端内容已更新 · R'+base.revision+' → R'+item.revision}
   description={changed?'本地修改仍完整保留在当前编辑器，远端版本没有覆盖它。请先复制或暂存草稿；若直接加载新版，需要明确放弃当前修改。':'服务器有新版本，当前页面仍显示原来的编辑内容。可选择载入最新版本。'}
   endContent={<div className="row gap">
    {changed&&<Button label="合并修改" size="sm" variant="primary" isLoading={mergeBusy}
     isDisabled={busy||mergeBusy} onClick={()=>void openMerge()}/>}
    <Button label={changed?'放弃本地修改并加载新版':'加载新版'} size="sm"
     variant="secondary" isDisabled={busy||mergeBusy} onClick={()=>void loadRemote()}/>
   </div>}/>}
  {recoveryNotice&&usableRecovery&&<Banner status="info" container="section" title="已恢复本标签页未保存的草稿" description="草稿属于当前 Revision，保存后才会写入知识库。" endContent={<Button label="丢弃恢复的草稿" variant="secondary" size="sm" onClick={discardRecovered}/>}/>}
  {recoveryNotice&&staleRecovery&&<Banner status="warning" container="section" title="发现旧版本的未保存草稿" description={"草稿来自 R"+stored.revision+"，当前编辑基线是 R"+base.revision+"。为避免覆盖其他客户端的更新，未自动恢复。"} endContent={<div className="row gap"><Button label="复制旧草稿" size="sm" onClick={()=>navigator.clipboard.writeText(stored.content)}/><Button label="丢弃旧草稿" size="sm" variant="secondary" onClick={()=>{clearSessionDraft(sessionId,item.id);setRecoveryNotice(false);}}/></div>}/>}
  {Boolean(error)&&<Banner status="error" container="section" title="保存失败" description={error instanceof ApiError&&error.status===409?'记录已被其他客户端修改。本地草稿和编辑历史仍保留，请先核对版本并决定如何处理。':error instanceof Error?error.message:'请稍后重试'} endContent={error instanceof ApiError&&error.status===409?<Button label="检查最新版本" onClick={()=>void qc.invalidateQueries({queryKey:['record',item.id]})}/>:undefined}/>}
  {mergeBackup&&<Banner status="info" container="section" title="已保留合并前的本地草稿"
   description={'这是 R'+mergeBackup.baseRevision+' 上合并之前的原始修改。恢复它只修改当前编辑器，服务器内容不会变化。'}
   endContent={<div className="row gap">
    <Button label="恢复合并前草稿" variant="secondary" size="sm" onClick={()=>void restoreMergeBackup()}/>
    <Button label="删除合并备份" variant="ghost" size="sm" onClick={()=>{
     clearSessionMergeBackup(sessionId,item.id);setMergeBackup(null);
    }}/>
   </div>}/>}
  {warning&&<Banner status="warning" container="section" title="编辑提醒" description={warning}/>}
  </div></AutoResizer>
  <AutoTransition transitionKey={mode+':'+editorKey} duration={.16}><div className="editor-body editor-view" data-mode={mode} aria-busy={busy}><React.Suspense fallback={<div className="editor-pending" aria-busy="true"/>}>{mode==='source'?<SourceEditor value={visibleDraft} onChange={changeVisibleDraft} focusLine={visibleFocusLine} focusToken={jumpToLine?.token}/>:mode==='preview'?<PreviewEditor content={visibleDraft} sourceId={item.id}/>:<VisualEditor ref={visualRef} value={visibleDraft} recordId={item.id} onChange={changeVisibleDraft}/>}</React.Suspense></div></AutoTransition>
  {historyTarget&&createPortal(<div className="history-panel"><h3 className="workbench-history-title">版本历史</h3>{versionsQuery.isPending?<p className="muted">加载版本…</p>:versionsQuery.isError?<Banner status="error" container="section" title="历史版本加载失败" description={versionsQuery.error.message}/>:versionsQuery.data?.items.map(v=><div className="history-row" key={v.revision}><div><strong>Revision {v.revision}</strong><p className="muted small">{v.message||'修改'} · {v.actor||''}</p></div><div className="row gap"><Button label="比较" size="sm" icon={<Icon name="arrowsDiff" size="sm"/>} onClick={()=>showDiff(v.revision)} isDisabled={v.revision===item.revision}/><Button label="恢复" size="sm" icon={<Icon name="restore" size="sm"/>} isDisabled={changed||remoteAhead||v.revision===base.revision||busy} onClick={()=>restore(v.revision)}/></div></div>)}{diff&&<pre className="diff-output">{diff}</pre>}</div>,historyTarget)}
  <React.Suspense fallback={null}>{mergeReview&&<EditorMergeReview
   review={mergeReview} busy={mergeBusy} onChoose={chooseMerge} onEdit={editMerge}
   onClose={()=>{if(!mergeBusy)setMergeReview(null);}}
   onApply={(output,strategy)=>void applyMerge(output,strategy)}/>}</React.Suspense>
  <Dialog isOpen={blocker.status==='blocked'} onOpenChange={open=>{if(!open)closeBlocker();}} width={440} padding={4} purpose="info" aria-label="未保存的编辑内容">
   <div className="draft-leave-dialog"><h2>还有未保存的编辑内容</h2><p>离开后当前编辑器将关闭。可以先保留本标签页草稿，下次进入此文档时自动恢复；也可以明确丢弃。</p><div className="draft-leave-actions"><Button label="留在编辑器" variant="primary" onClick={closeBlocker}/><Button label="保留草稿并离开" variant="secondary" isDisabled={busy} onClick={keepAndLeave}/><Button label="丢弃更改并离开" variant="destructive" isDisabled={busy} onClick={discardAndLeave}/></div></div>
  </Dialog>
 </div>;
}
function historyReplace(url:URL){window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
