import React,{useEffect,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {
 rmdAttrNodeMapping,pmAttrKey,rmdAttributeDefinition,normalizeRmdAttribute
} from './rmd-schema-attrs-model';
import {describeRmdAnchorConflict,findRmdAnchorConflict} from './rmd-anchor-ids';

/** Schema-generated attribute editor embedded in the shared BlockEditorPanel.
 * Inputs are local drafts until valid. Valid values update one PM transaction,
 * never a separate attribute store or an implicit server save.
 */
export function RmdSchemaAttributeFields({editor,pos}:{editor:Editor;pos:number}){
 const node=editor.state.doc.nodeAt(pos);
 const type=node?.type.name??'';
 const mapping=rmdAttrNodeMapping[type];
 const definition=rmdAttributeDefinition(type);
 const fields=definition?Object.keys(definition.attributes):[];
 const [draft,setDraft]=useState<Record<string,string>>(()=>{
  if(!node||!mapping||!definition)return {};
  return Object.fromEntries(fields.map(field=>{
   const value=node.attrs[pmAttrKey(field,mapping)];
   return [field,typeof value==='boolean'?String(value):String(value??'')];
  }));
 });
 const [errors,setErrors]=useState<Record<string,string>>({});
 const canonical=node&&mapping?Object.fromEntries(fields.map(field=>[field,String(node.attrs[pmAttrKey(field,mapping)]??'')])):{};
 const previous=useRef(canonical);
 useEffect(()=>{
  const changed=fields.filter(field=>previous.current[field]!==canonical[field]);
  previous.current=canonical;
  if(!changed.length)return;
  setDraft(values=>({...values,...Object.fromEntries(changed.map(field=>[field,canonical[field]]))}));
  setErrors(values=>({...values,...Object.fromEntries(changed.map(field=>[field,'']))}));
 },[node,type]);
 if(!node||!mapping||!definition)return null;

 const applyField=(field:string,raw:string)=>{
  setDraft(values=>({...values,[field]:raw}));
  const normalized=normalizeRmdAttribute(type,field,raw);
  if(!normalized.ok){setErrors(values=>({...values,[field]:normalized.error}));return;}
  const current=editor.state.doc.nodeAt(pos);
  if(!current||current.type.name!==type){
   setErrors(values=>({...values,[field]:'目标块已变化，请重新打开编辑面板'}));return;
  }
  if(field==='id'&&typeof normalized.value==='string'){
   const conflict=findRmdAnchorConflict(editor.state.doc,normalized.value,{pos,nodeSize:current.nodeSize});
   if(conflict){setErrors(values=>({...values,[field]:describeRmdAnchorConflict(conflict)}));return;}
  }
  setErrors(values=>({...values,[field]:''}));
  const attrName=pmAttrKey(field,mapping);
  if(current.attrs[attrName]===normalized.value)return;
  try{
   const next={...current.attrs,[attrName]:normalized.value};
   const tr=editor.state.tr.setNodeMarkup(pos,undefined,next);
   tr.doc.check();
   editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
  }catch{
   setErrors(values=>({...values,[field]:'当前属性无法应用，请检查内容与节点类型'}));
  }
 };
 return <section className="rk-block-schema-attrs" aria-label={definition.label+' Markdown 属性'}>
  <strong>{definition.label} · Markdown 属性</strong>
  <p className="rk-block-panel-help">合法输入实时作用于文档草稿。无效输入会保留以供修正，但不会覆盖正文。</p>
  {fields.map(field=><div className="rk-block-schema-field" key={field}>
   {definition.attributes[field]==='boolean'?
    <CheckboxInput className="rk-block-schema-toggle" label={definition.fieldLabels[field]??field}
     value={draft[field]==='true'} width="100%" onChange={checked=>applyField(field,String(checked))}/>:
    <TextInput width="100%" label={definition.fieldLabels[field]??field}
     value={draft[field]??''} onChange={value=>applyField(field,value)}
     placeholder={field==='id'?(definition.editorIdPrefix??'my-section'):
      definition.attributes[field]==='integer'?'自动':undefined}/>}
   {errors[field]&&<p className="rk-block-panel-error" role="alert">{errors[field]}</p>}
  </div>)}
 </section>;
}
