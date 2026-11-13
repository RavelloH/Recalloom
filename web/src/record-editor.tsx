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
import {readSessionDraft,writeSessionDraft,clearSessionDraft,isLogoutNavigationApproved,setActiveEditorDirty} from './session-drafts';
import {useConfirmDialog} from './confirm-dialog';
import type {RecordDetail} from './types';
import {VisualEditorChunk as VisualEditor,SourceEditorChunk as SourceEditor,PreviewEditorChunk as PreviewEditor,type EditorMode} from './editor-chunks';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {observeMathHorizontalOverflow} from './math-scroll';
import {markdownCharacterCount} from './document-heading';
import type {DocumentPresentation} from './record-workbench';


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
  if(busy)return;
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
 return <div ref={editorSectionRef} data-base-revision={base.revision}
  data-remote-revision={item.revision} className="editor-section">{confirmation}
  <PageActions className="editor-topline" pinned={<>
   <AutoResizer animateWidth animateHeight={false} className="save-status-box"><AutoTransition as="span" mode="sync" transitionKey={busy?'busy':changed?'dirty':remoteAhead?'remote':'clean'} duration={.14}><span className={'save-status'+(changed||remoteAhead?' is-dirty':'')} title={changed?'按 Ctrl/⌘ + S 保存':remoteAhead?'服务器已有 R'+item.revision+'，当前仍为 R'+base.revision:'所有更改已保存'}>{busy?'保存中…':changed?'未保存':remoteAhead?'有新版':'已保存'}</span></AutoTransition></AutoResizer>
   <Button label="保存" icon={<Icon name="save"/>} variant={changed?'primary':'ghost'} size="sm" onClick={save} isDisabled={!changed||busy} isLoading={busy}/>
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
   endContent={<Button label={changed?'放弃本地修改并加载新版':'加载新版'} size="sm"
    variant="secondary" isDisabled={busy} onClick={()=>void loadRemote()}/>}/>}
  {recoveryNotice&&usableRecovery&&<Banner status="info" container="section" title="已恢复本标签页未保存的草稿" description="草稿属于当前 Revision，保存后才会写入知识库。" endContent={<Button label="丢弃恢复的草稿" variant="secondary" size="sm" onClick={discardRecovered}/>}/>}
  {recoveryNotice&&staleRecovery&&<Banner status="warning" container="section" title="发现旧版本的未保存草稿" description={"草稿来自 R"+stored.revision+"，当前编辑基线是 R"+base.revision+"。为避免覆盖其他客户端的更新，未自动恢复。"} endContent={<div className="row gap"><Button label="复制旧草稿" size="sm" onClick={()=>navigator.clipboard.writeText(stored.content)}/><Button label="丢弃旧草稿" size="sm" variant="secondary" onClick={()=>{clearSessionDraft(sessionId,item.id);setRecoveryNotice(false);}}/></div>}/>}
  {Boolean(error)&&<Banner status="error" container="section" title="保存失败" description={error instanceof ApiError&&error.status===409?'记录已被其他客户端修改。本地草稿和编辑历史仍保留，请先核对版本并决定如何处理。':error instanceof Error?error.message:'请稍后重试'} endContent={error instanceof ApiError&&error.status===409?<Button label="检查最新版本" onClick={()=>void qc.invalidateQueries({queryKey:['record',item.id]})}/>:undefined}/>}
  {warning&&<Banner status="warning" container="section" title="编辑提醒" description={warning}/>}
  </div></AutoResizer>
  <AutoTransition transitionKey={mode+':'+editorKey} duration={.16}><div className="editor-body editor-view" data-mode={mode} aria-busy={busy}><React.Suspense fallback={<div className="editor-pending" aria-busy="true"/>}>{mode==='source'?<SourceEditor value={visibleDraft} onChange={changeVisibleDraft} focusLine={visibleFocusLine} focusToken={jumpToLine?.token}/>:mode==='preview'?<PreviewEditor content={visibleDraft} sourceId={item.id}/>:<VisualEditor ref={visualRef} value={visibleDraft} recordId={item.id} onChange={changeVisibleDraft}/>}</React.Suspense></div></AutoTransition>
  {historyTarget&&createPortal(<div className="history-panel"><h3 className="workbench-history-title">版本历史</h3>{versionsQuery.isPending?<p className="muted">加载版本…</p>:versionsQuery.isError?<Banner status="error" container="section" title="历史版本加载失败" description={versionsQuery.error.message}/>:versionsQuery.data?.items.map(v=><div className="history-row" key={v.revision}><div><strong>Revision {v.revision}</strong><p className="muted small">{v.message||'修改'} · {v.actor||''}</p></div><div className="row gap"><Button label="比较" size="sm" icon={<Icon name="arrowsDiff" size="sm"/>} onClick={()=>showDiff(v.revision)} isDisabled={v.revision===item.revision}/><Button label="恢复" size="sm" icon={<Icon name="restore" size="sm"/>} isDisabled={changed||remoteAhead||v.revision===base.revision||busy} onClick={()=>restore(v.revision)}/></div></div>)}{diff&&<pre className="diff-output">{diff}</pre>}</div>,historyTarget)}
  <Dialog isOpen={blocker.status==='blocked'} onOpenChange={open=>{if(!open)closeBlocker();}} width={440} padding={4} purpose="info" aria-label="未保存的编辑内容">
   <div className="draft-leave-dialog"><h2>还有未保存的编辑内容</h2><p>离开后当前编辑器将关闭。可以先保留本标签页草稿，下次进入此文档时自动恢复；也可以明确丢弃。</p><div className="draft-leave-actions"><Button label="留在编辑器" variant="primary" onClick={closeBlocker}/><Button label="保留草稿并离开" variant="secondary" isDisabled={busy} onClick={keepAndLeave}/><Button label="丢弃更改并离开" variant="destructive" isDisabled={busy} onClick={discardAndLeave}/></div></div>
  </Dialog>
 </div>;
}
function historyReplace(url:URL){window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
