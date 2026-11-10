import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Button} from '@astryxdesign/core/Button';
import {IconX,IconCode,IconEye} from '@tabler/icons-react';
import {parseRmdVisual} from '../rmd-visual';
import {serializeRmdBlock} from '../rmd-serialize';
import {editableBlockAt} from './editor-block-actions';
import {RmdSchemaAttributeFields} from './rmd-schema-attrs-fields';
import {RmdContainerAttributeFields} from './rmd-container-fields';
import {RmdLeafAttributeFields} from './rmd-leaf-fields';
import type {RichContainerField} from './rmd-container-attributes';
import {isRmdAttrsEditable} from './rmd-schema-attrs-model';
import {describeRmdAnchorConflict,findRmdAnchorConflictForNode} from './rmd-anchor-ids';
import './block-editor-panel.css';

const Preview=React.lazy(()=>import('../markdown-preview'));
const safeTitle=(s:string)=>s.replace(/[\r\n]/g,' ').slice(0,180);
export function BlockEditorPanel({editor,pos,attributePos,onClose,recordId,mobile=false}:{
 editor:Editor;pos:number;attributePos?:number|null;onClose:()=>void;recordId?:string;mobile?:boolean;
}){
 const [version,setVersion]=useState(0);
 const [closing,setClosing]=useState(false);
 const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const requestClose=()=>{
  if(closing)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}
  setClosing(true);
  closeTimer.current=setTimeout(onClose,240);
 };
 useEffect(()=>()=>{if(closeTimer.current!==null)clearTimeout(closeTimer.current);},[]);
 const [draft,setDraft]=useState(()=>serializeRmdBlock(editableBlockAt(editor,pos)?.node.toJSON()??{type:'paragraph'}));
 const [error,setError]=useState('');
 const canonicalRef=useRef(draft);
 useEffect(()=>{
  const source=serializeRmdBlock(editableBlockAt(editor,pos)?.node.toJSON()??{type:'paragraph'});
  canonicalRef.current=source;setDraft(source);setError('');
 },[editor,pos]);
 useEffect(()=>{
  const update=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(!transaction.docChanged)return;
   setVersion(value=>value+1);
   const mapped=transaction.mapping.mapResult(pos,1);
   const current=editableBlockAt(editor,mapped.pos);
   if(!current)return;
   const canonical=serializeRmdBlock(current.node.toJSON());
   if(canonical!==canonicalRef.current){
    canonicalRef.current=canonical;
    // An external direct edit of the selected block updates the sidebar.
    // Editing the sidebar itself must not overwrite incomplete text inputs.
    if(transaction.getMeta('rk-block-panel-edit')!==true||transaction.getMeta('rk-block-panel-field-edit')===true)setDraft(canonical);
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
 const block=editableBlockAt(editor,pos);
 const current=block?.node;
 const kind=current?.type.name??'';
 const subkind=kind==='richContainer'?String(current?.attrs.kind??''):'';
 const parentKind=block?.parentKind??null;
 const nestedSource=(source:string)=>{
  if(!parentKind)return source;
  if(parentKind==='flashcard'&&block&&block.parentPos!==null){
   const parent=editor.state.doc.nodeAt(block.parentPos);
   if(parent){
    const siblings:string[]=[];
    parent.forEach((node,_offset,index)=>siblings.push(index===block.index?source:serializeRmdBlock(node.toJSON())));
    return ':::: flashcard\n\n'+siblings.join('\n\n')+'\n\n::::';
   }
  }
  return ':::: '+parentKind+'\n\n'+source+'\n\n::::';
 };
 const presentation=useMemo(()=>current?nestedSource(serializeRmdBlock(current.toJSON())):'', [current,version,parentKind]);
 if(!current)return null;
 const attr=(name:RichContainerField,value:string|number|null)=>{
  const node=editor.state.doc.nodeAt(pos);
  if(!node||node.type!==current.type){setError('目标块已变化，请重新打开');return;}
  if(name==='title'&&typeof value==='string')value=safeTitle(value);
  if(node.attrs[name]===value)return;
  try{
   const tr=editor.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,[name]:value});
   tr.doc.check();
   editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
   setDraft(serializeRmdBlock(editor.state.doc.nodeAt(pos)!.toJSON()));
   setError('');
  }catch{setError('当前属性未能写入，请确认内容是否有效');}
 };
 const applyLeaf=(attrs:Record<string,string|null>)=>{
  const node=editor.state.doc.nodeAt(pos);
  if(!node||node.type!==current.type){setError('目标块已变化，请重新打开');return;}
  if(Object.entries(attrs).every(([name,value])=>node.attrs[name]===value))return;
  try{
   const tr=editor.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,...attrs});
   tr.doc.check();
   editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
   setDraft(serializeRmdBlock(editor.state.doc.nodeAt(pos)!.toJSON()));
   setError('');
  }catch{setError('当前属性未能写入，请确认格式');}
 };
 const commitRaw=(value:string)=>{
  setDraft(value);
  try{
   const parsed=parseRmdVisual(nestedSource(value));
   let parsedBlock=parsed.content?.[0];
   if(parentKind){
    const siblings=parsedBlock?.content??[],parent=block&&block.parentPos!==null?editor.state.doc.nodeAt(block.parentPos):null;
    const expected=parentKind==='flashcard'?parent?.childCount:1;
    if(parsed.content?.length!==1||parsedBlock?.type!=='richContainer'||parsedBlock.attrs?.kind!==parentKind||
     siblings.length!==expected)throw new Error('必须保留在原父容器中，且只能包含合法的子块。');
    const index=parentKind==='flashcard'?block?.index??0:0;
    // Front/back must remain a complete pair. Never mutate its sibling when
    // the author edits just one side of a flashcard.
    if(parentKind==='flashcard'&&siblings.some((s,i)=>i!==index&&serializeRmdBlock(s)!==serializeRmdBlock(parent!.child(i).toJSON())))
     throw new Error('不可修改另一侧闪卡内容，请分别编辑正面与背面。');
    parsedBlock=siblings[index];
   }
   if(parsedBlock?.type!==kind||kind==='richContainer'&&parsedBlock.attrs?.kind!==subkind)
    throw new Error('每次只能编辑一个同类型块。转换块类型请使用块操作菜单。');
   const candidate=editor.state.schema.nodeFromJSON(parsedBlock);
   const anchorConflict=findRmdAnchorConflictForNode(editor.state.doc,candidate,pos);
   if(anchorConflict)throw new Error(describeRmdAnchorConflict(anchorConflict));
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
  data-closing={closing?'true':undefined}
  aria-modal={mobile?true:undefined} aria-label="块编辑面板" data-block-kind={kind}
  onKeyDown={e=>{
   if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.stopPropagation();requestClose();}
  }}>
  <header className="rk-block-panel-header">
   <div><strong>{parentKind?'编辑子块':'编辑块'}</strong><span>{kind==='richContainer'?String(current.attrs.kind??'容器'):kind}</span></div>
   <Button variant="ghost" size="sm" label="关闭块编辑" icon={<IconX size="var(--rk-icon-sm)"/>} onClick={requestClose}/>
  </header>
  <section className="rk-block-panel-preview" aria-label="当前块预览">
   <div className="rk-block-panel-section-heading"><IconEye size="var(--rk-icon-sm)"/><span>实时预览</span></div>
   <div className="rk-block-panel-preview-body record-main">
    <React.Suspense fallback={<div className="muted small">准备预览…</div>}>
     <Preview content={presentation} sourceId={recordId}/>
    </React.Suspense>
   </div>
  </section>
  <section className="rk-block-panel-fields">
   <p className="rk-block-panel-desc">有效修改立即同步文档；保存仍使用页面顶部的「保存」操作。</p>
   {kind==='richContainer'&&<RmdContainerAttributeFields key={'container-'+pos+'-'+String(current.attrs.kind)}
     editor={editor} pos={pos} node={current} onApply={attr}/>}
   {(kind==='richLinkCard'||kind==='wikiEmbed')&&<RmdLeafAttributeFields key={kind+'-'+pos} node={current} onApply={applyLeaf}/>}
   {attributePos!==undefined&&attributePos!==null&&isRmdAttrsEditable(editor.state.doc.nodeAt(attributePos)?.type.name??'')&&
    <RmdSchemaAttributeFields key={attributePos} editor={editor} pos={attributePos}/>}
   <div className="rk-block-panel-section-heading"><IconCode size="var(--rk-icon-sm)"/><span>当前块 RMD 正文与属性</span></div>
   <TextArea label="块源码" width="100%" rows={10} value={draft} onChange={commitRaw}
    placeholder="编辑当前块的 Markdown / RMD"/>
   {error&&<p className="rk-block-panel-error" role="alert">{error}</p>}
   <p className="rk-block-panel-help">这里编辑当前块的完整 RMD。普通文字也可以直接在左侧正文中编辑。输入暂时不符合完整块语法时，保留表单内容，不破坏原文。</p>
  </section>
 </aside>;
}
