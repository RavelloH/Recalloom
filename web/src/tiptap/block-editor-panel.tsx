import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Button} from '@astryxdesign/core/Button';
import {IconX,IconCode,IconEye} from '@tabler/icons-react';
import {parseRmdVisual} from '../rmd-visual';
import {serializeRmdBlock} from '../rmd-serialize';
import {topLevelBlockAt} from './editor-block-actions';
import './block-editor-panel.css';

const Preview=React.lazy(()=>import('../markdown-preview'));
const safeTitle=(s:string)=>s.replace(/[\r\n]/g,' ').slice(0,180);
export function BlockEditorPanel({editor,pos,onClose,recordId,mobile=false}:{
 editor:Editor;pos:number;onClose:()=>void;recordId?:string;mobile?:boolean;
}){
 const [version,setVersion]=useState(0);
 const [draft,setDraft]=useState(()=>serializeRmdBlock(topLevelBlockAt(editor,pos)?.node.toJSON()??{type:'paragraph'}));
 const [error,setError]=useState('');
 const canonicalRef=useRef(draft);
 useEffect(()=>{
  const source=serializeRmdBlock(topLevelBlockAt(editor,pos)?.node.toJSON()??{type:'paragraph'});
  canonicalRef.current=source;setDraft(source);setError('');
 },[editor,pos]);
 useEffect(()=>{
  const update=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(!transaction.docChanged)return;
   setVersion(value=>value+1);
   const mapped=transaction.mapping.mapResult(pos,1);
   const current=topLevelBlockAt(editor,mapped.pos);
   if(!current)return;
   const canonical=serializeRmdBlock(current.node.toJSON());
   if(canonical!==canonicalRef.current){
    canonicalRef.current=canonical;
    // An external direct edit of the selected block updates the sidebar.
    // Editing the sidebar itself must not overwrite incomplete text inputs.
    if(transaction.getMeta('rk-block-panel-edit')!==true)setDraft(canonical);
   }
  };
  editor.on('transaction',update);
  return()=>{editor.off('transaction',update);};
 },[editor,pos]);
 useEffect(()=>{
  if(!mobile)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=previous;};
 },[mobile]);
 const block=topLevelBlockAt(editor,pos);
 const current=block?.node;
 const kind=current?.type.name??'';
 const title=kind==='richContainer'?String(current?.attrs.title??''):'';
 const presentation=useMemo(()=>current?serializeRmdBlock(current.toJSON()):'', [current,version]);
 if(!current)return null;
 const attr=(name:string,value:string)=>{
  const node=editor.state.doc.nodeAt(pos);
  if(!node||node.type!==current.type){setError('目标块已变化，请重新打开');return;}
  if(name==='title')value=safeTitle(value);
  if(String(node.attrs[name]??'')===value)return;
  try{
   const tr=editor.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,[name]:value});
   tr.doc.check();
   editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true));
   setDraft(serializeRmdBlock(editor.state.doc.nodeAt(pos)!.toJSON()));
   setError('');
  }catch{setError('当前属性未能写入，请确认内容是否有效');}
 };
 const commitRaw=(value:string)=>{
  setDraft(value);
  try{
   const parsed=parseRmdVisual(value);
   if(parsed.content?.length!==1||parsed.content[0]?.type!==kind)
    throw new Error('每次只能编辑一个同类型块。转换块类型请使用块操作菜单。');
   const candidate=editor.state.schema.nodeFromJSON(parsed.content[0]);
   const existing=editor.state.doc.nodeAt(pos);
   if(!existing||existing.type!==candidate.type)throw new Error('编辑目标已变化，请重新选择块。');
   const tr=editor.state.tr.replaceWith(pos,pos+existing.nodeSize,candidate);
   tr.doc.check();
   if(!existing.eq(candidate))editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true));
   setError('');
  }catch(e){
   setError(e instanceof Error?e.message:'输入尚未构成有效的完整块；修正后会自动生效');
  }
 };
 return <aside className="rk-block-editor-panel" role={mobile?'dialog':'complementary'}
  aria-modal={mobile?true:undefined} aria-label="块编辑面板" data-block-kind={kind}
  onKeyDown={e=>{
   if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.stopPropagation();onClose();}
  }}>
  <header className="rk-block-panel-header">
   <div><strong>编辑块</strong><span>{kind==='richContainer'?String(current.attrs.kind??'容器'):kind}</span></div>
   <Button variant="ghost" size="sm" label="关闭块编辑" icon={<IconX size="var(--rk-icon-sm)"/>} onClick={onClose}/>
  </header>
  <section className="rk-block-panel-preview" aria-label="当前块预览">
   <div className="rk-block-panel-section-heading"><IconEye size="var(--rk-icon-sm)"/><span>实时预览</span></div>
   <div className="rk-block-panel-preview-body">
    <React.Suspense fallback={<div className="muted small">准备预览…</div>}>
     <Preview content={presentation} sourceId={recordId}/>
    </React.Suspense>
   </div>
  </section>
  <section className="rk-block-panel-fields">
   <p className="rk-block-panel-desc">有效修改立即同步文档；保存仍使用页面顶部的「保存」操作。</p>
   {kind==='richContainer'&&
    <TextInput label="块标题" width="100%" value={title} onChange={v=>attr('title',v)}/>}
   {kind==='richContainer'&&current.attrs.kind==='message'&&
    <TextInput label="消息身份" width="100%" value={String(current.attrs.sender??'assistant')}
     onChange={v=>{if(['user','assistant','system'].includes(v))attr('sender',v);}}
     placeholder="user / assistant / system"/>}
   <div className="rk-block-panel-section-heading"><IconCode size="var(--rk-icon-sm)"/><span>当前块 RMD 正文与属性</span></div>
   <TextArea label="块源码" width="100%" rows={10} value={draft} onChange={commitRaw}
    placeholder="编辑当前块的 Markdown / RMD"/>
   {error&&<p className="rk-block-panel-error" role="alert">{error}</p>}
   <p className="rk-block-panel-help">这里编辑当前块的完整 RMD。普通文字也可以直接在左侧正文中编辑。输入暂时不符合完整块语法时，保留表单内容，不破坏原文。</p>
  </section>
 </aside>;
}
