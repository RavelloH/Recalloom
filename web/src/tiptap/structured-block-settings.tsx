import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {mapBlockEditorTarget} from './editor-block-actions';
import {CHAT_SENDERS} from './rmd-container-attributes';
import {createStructuredBlockTransaction,createStructuredChildBodyTransaction,structuredChildBody,STRUCTURED_BLOCKS,STRUCTURED_CHILD_LABELS,type StructuredBlockAction} from './structured-block-settings-model';
import './structured-block-settings.css';

function useInspectedNode(editor:Editor,pos:number,node:ProseMirrorNode){
 const position=useRef(pos),[current,setCurrent]=useState(node);
 useLayoutEffect(()=>{position.current=pos;setCurrent(node);},[pos,node]);
 useEffect(()=>{
  const update=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(!transaction.docChanged)return;
   const previous=transaction.before.nodeAt(position.current);
   const target=previous?mapBlockEditorTarget(editor,transaction,position.current,previous):null;
   if(target){position.current=target.pos;setCurrent(target.node);}
  };
  editor.on('transaction',update);return()=>{editor.off('transaction',update);};
 },[editor]);
 return {current,position};
}

type FieldApplyResult={error:string|null;canonicalValue?:string};
/** Retain the author's Markdown spelling across its own parse/serialize writes.
 * A different canonical value (including undo/redo) still replaces the draft.
 */
function SettingsField({label,value,multiline,apply,role=false}:{label:string;value:string;multiline?:boolean;role?:boolean;apply:(value:string)=>FieldApplyResult}){
 const [draft,setDraft]=useState(value),[error,setError]=useState<string|null>(null);
 const previousValue=useRef(value),ownCanonical=useRef<string|undefined>(undefined);
 useLayoutEffect(()=>{
  const changed=previousValue.current!==value;previousValue.current=value;
  if(ownCanonical.current===value){ownCanonical.current=undefined;return;}
  if(changed){ownCanonical.current=undefined;setDraft(value);setError(null);}
 });
 const update=(next:string)=>{
  setDraft(next);
  const result=apply(next);setError(result.error);
  if(!result.error)ownCanonical.current=result.canonicalValue;
 };
 const status=error?{type:'error' as const,message:error}:undefined;
 return role?<Selector label={label} width="100%" value={draft||'assistant'} onChange={update} status={status}
  options={CHAT_SENDERS.map(sender=>({value:sender,label:sender==='assistant'?'Agent / 助手':sender==='user'?'用户':'系统'}))}/>:
  multiline?<TextArea label={label} width="100%" rows={5} value={draft} onChange={update} status={status} description="支持 Markdown 和嵌套 RMD 内容。"/>:
  <TextInput label={label} width="100%" value={draft} onChange={update} status={status}/>;
}

type ChildRow={key:string;node:ProseMirrorNode};
export function StructuredBlockSettings({editor,pos,node}:{editor:Editor;pos:number;node:ProseMirrorNode}){
 const {current,position}=useInspectedNode(editor,pos,node);
 const keys=useRef(new WeakMap<ProseMirrorNode,string>()),serial=useRef(0),previous=useRef<ChildRow[]>([]);
 const [error,setError]=useState('');
 const definition=STRUCTURED_BLOCKS[String(current.attrs.kind)];
 const children:ProseMirrorNode[]=[];current.forEach(child=>children.push(child));
 const used=new Set<string>();
 const rows=children.map((child,index)=>{
  let key=keys.current.get(child);
  if(!key){
   const equivalent=previous.current.find(row=>!used.has(row.key)&&row.node.eq(child));
   const atIndex=previous.current[index];
   const fallback=atIndex&&!used.has(atIndex.key)&&atIndex.node.attrs.kind===child.attrs.kind&&!children.includes(atIndex.node)?atIndex:undefined;
   key=(equivalent??fallback)?.key??'structured-child-'+(++serial.current);
   keys.current.set(child,key);
  }
  used.add(key);return {key,node:child};
 });
 previous.current=rows;
 if(!definition||current.type.name!=='richContainer')return null;
 const apply=(action:StructuredBlockAction,key?:string):FieldApplyResult=>{
  try{
   const targetPos=position.current,parent=editor.state.doc.nodeAt(targetPos);
   if(!parent||parent.type!==current.type||parent.attrs.kind!==current.attrs.kind)throw new Error('目标容器已变化，请重新选择。');
   if(action.type!=='add'&&key){
    let found=-1;parent.forEach((child,_offset,index)=>{if(keys.current.get(child)===key)found=index;});
    if(found<0)throw new Error('目标子块已变化，请重新选择。');
    action={...action,index:found};
   }
   const tr=createStructuredBlockTransaction(editor.state,targetPos,action);
   const changedChild=action.type==='field'?tr.doc.nodeAt(targetPos)!.child(action.index):null;
   if(changedChild&&key)keys.current.set(changedChild,key);
   const canonicalValue=action.type==='field'&&changedChild
    ?action.field==='body'?structuredChildBody(changedChild):String(changedChild.attrs[action.field]??'')
    :undefined;
   if(tr.docChanged)editor.view.dispatch(tr);
   return {error:null,canonicalValue};
  }catch(error){return {error:error instanceof Error?error.message:'当前修改尚未有效，请修正后继续。'};}
 };
 const perform=(action:StructuredBlockAction,key?:string)=>setError(apply(action,key).error??'');
 return <section className="rk-structured-settings" aria-label={definition.label+'设置'}>
  {rows.map(({key,node:child},index)=>{
   const fixed=current.attrs.kind==='flashcard';
   const label=fixed?'闪卡'+(child.attrs.kind==='front'?'正面':'背面'):definition.label+' '+(index+1);
   const titleLabel=label+(child.attrs.kind==='message'?' 发言人名称':child.attrs.kind==='definition'?' 术语名称':' 标题');
   return <section className="rk-structured-child" key={key} aria-label={label+'设置'}>
    <strong>{label}</strong>
    {!fixed&&<SettingsField label={titleLabel} value={String(child.attrs.title??'')} apply={value=>apply({type:'field',index,field:'title',value},key)}/>}
    {child.attrs.kind==='message'&&<SettingsField label={label+' 身份'} role value={String(child.attrs.sender??'assistant')} apply={value=>apply({type:'field',index,field:'sender',value},key)}/>}
    <SettingsField label={label+' 内容（Markdown）'} multiline value={structuredChildBody(child)} apply={value=>apply({type:'field',index,field:'body',value},key)}/>
    {!fixed&&<div className="rk-structured-child-actions" role="group" aria-label={label+'操作'}>
     <Button label="上移" aria-label={label+' 上移'} size="sm" variant="secondary" isDisabled={index===0} onClick={()=>perform({type:'move',index,direction:-1},key)}/>
     <Button label="下移" aria-label={label+' 下移'} size="sm" variant="secondary" isDisabled={index===rows.length-1} onClick={()=>perform({type:'move',index,direction:1},key)}/>
     <Button label="删除" aria-label={label+' 删除'} size="sm" variant="destructive" isDisabled={rows.length<=1} onClick={()=>perform({type:'remove',index},key)}/>
    </div>}
   </section>;
  })}
  {current.attrs.kind!=='flashcard'&&<Button label={'添加'+definition.label} variant="secondary" onClick={()=>perform({type:'add'})}/>}
  {error&&<p className="rk-block-panel-error" role="alert">{error}</p>}
 </section>;
}

export function StructuredChildContentSettings({editor,pos,node}:{editor:Editor;pos:number;node:ProseMirrorNode}){
 const {current,position}=useInspectedNode(editor,pos,node);
 const label=STRUCTURED_CHILD_LABELS[String(current.attrs.kind)];
 if(!label||current.type.name!=='richContainer')return null;
 return <section className="rk-structured-settings" aria-label={label+'正文设置'}>
  <SettingsField label={label+'内容（Markdown）'} multiline value={structuredChildBody(current)} apply={value=>{
   try{
    const target=editor.state.doc.nodeAt(position.current);
    if(!target||target.type!==current.type||target.attrs.kind!==current.attrs.kind)throw new Error('目标子块已变化，请重新选择。');
    const tr=createStructuredChildBodyTransaction(editor.state,position.current,value);
    const canonicalValue=structuredChildBody(tr.doc.nodeAt(position.current)!);
    if(tr.docChanged)editor.view.dispatch(tr);return {error:null,canonicalValue};
   }catch(error){return {error:error instanceof Error?error.message:'当前正文尚未有效，请修正后继续。'};}
  }}/>
 </section>;
}
