import React,{useEffect,useRef,useState} from 'react';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {TextInput} from '@astryxdesign/core/TextInput';
import {normalizeLeafFields,type LeafEditKind} from './rmd-leaf-attributes';

export function RmdLeafAttributeFields({node,onApply}:{
 node:ProseMirrorNode;onApply:(attrs:Record<string,string|null>)=>void;
}){
 const kind=node.type.name as LeafEditKind;
 const fields=kind==='richLinkCard'?['url','title'] as const:['target'] as const;
 const initial=()=>{
  const value:Record<string,string>={};
  for(const field of fields){
   value[field]=field==='target'?String(node.attrs.target??'')+(node.attrs.anchor?'#'+node.attrs.anchor:''):String(node.attrs[field]??'');
  }
  return value;
 };
 const [inputs,setInputs]=useState<Record<string,string>>(initial);
 const [errors,setErrors]=useState<Record<string,string>>({});
 const prior=useRef(initial());
 const canonical=initial();
 useEffect(()=>{
  const changed=Object.fromEntries(fields.filter(field=>canonical[field]!==prior.current[field]).map(field=>[field,canonical[field]]));
  prior.current=canonical;
  if(Object.keys(changed).length)setInputs(old=>({...old,...changed}));
 },[node]);
 const apply=(field:'url'|'title'|'target',value:string)=>{
  setInputs(old=>({...old,[field]:value}));
  const result=normalizeLeafFields(kind,field,value);
  setErrors(old=>({...old,[field]:result.ok?'':result.error}));
  if(result.ok)onApply(result.attrs);
 };
 return <section className="rk-block-schema-attrs" aria-label={kind==='richLinkCard'?'链接卡片属性':'引用文档属性'}>
  <strong>{kind==='richLinkCard'?'链接卡片':'引用文档'}</strong>
  <p className="rk-block-panel-help">输入合法值后，当前草稿和预览立即更新；仍需使用文档「保存」才会提交到服务端。</p>
  {fields.map(field=><div className="rk-block-schema-field" key={field}>
   <TextInput width="100%" label={field==='url'?'页面 URL':field==='title'?'卡片标题':'引用目标（UUID 或绝对路径）'}
    value={inputs[field]??''} onChange={value=>apply(field,value)}
    placeholder={field==='target'?'id:UUID#anchor 或 /路径/文档.md':field==='url'?'https://example.com':'可留空，使用页面标题'}/>
   {errors[field]&&<p className="rk-block-panel-error" role="alert">{errors[field]}</p>}
  </div>)}
 </section>;
}