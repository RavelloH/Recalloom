import React,{useEffect,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {RMD_REGISTRY,isRmdId,isValidRmdValue,type RmdValueType} from '../rmd-schema';

/** Only ProseMirror attribute names differ from the user-visible RMD schema.
 * The actual field list, types and labels come from the single registry.
 */
const nodeMapping:Readonly<Record<string,{node:string;id:string}>>={
 heading:{node:'heading',id:'id'},
 paragraph:{node:'paragraph',id:'blockId'},
 blockMath:{node:'math',id:'equationId'},
 table:{node:'table',id:'tableId'},
 codeBlock:{node:'code',id:'id'},
 image:{node:'image',id:'figureId'}
};
const pmKey=(field:string,mapping:{id:string})=>field==='id'?mapping.id:field==='file'?'filename':field;
export const isRmdAttrsEditable=(type:string)=>Boolean(nodeMapping[type]&&
 RMD_REGISTRY.nodes.some(n=>n.node===nodeMapping[type]!.node));

/** No operation is dispatched until explicit confirmation. */
export default function RmdAttrsEditor({editor,pos,onClose}:{editor:Editor;pos:number;onClose:()=>void}){
 const initial=editor.state.doc.nodeAt(pos);
 const kind=initial?.type.name??'';
 const mapping=nodeMapping[kind];
 const definition=RMD_REGISTRY.nodes.find(x=>x.node===mapping?.node) as
  {node:string;label:string;attributes:Record<string,RmdValueType>;fieldLabels:Record<string,string>;editorIdPrefix?:string}|undefined;
 const fields=definition?Object.keys(definition.attributes).filter(field=>field!=='id'):[];
 const labels=definition?.fieldLabels??{} as Record<string,string>;
 const [draft,setDraft]=useState<Record<string,string>>(()=>{
  if(!initial||!mapping||!definition)return {};
  return Object.fromEntries(Object.keys(definition.attributes).map(field=>{
   const current=initial.attrs[pmKey(field,mapping)];
   return [field,typeof current==='boolean'?String(current):String(current??'')];
  }));
 });
 const [error,setError]=useState('');
 useEffect(()=>{const listener=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[onClose]);
 if(!initial||!mapping||!definition)return null;
 const set=(field:string,value:string)=>{setDraft(s=>({...s,[field]:value}));setError('');};
 const apply=()=>{
  const current=editor.state.doc.nodeAt(pos);
  if(!current||current.type.name!==kind){setError('目标块已变化，请重新打开');return;}
  const id=(draft.id??'').trim().toLowerCase();
  if(id&&!isRmdId(id)){setError('ID 必须以英文字母开头，只能使用字母、数字、连字符，最长 '+RMD_REGISTRY.constraints.idMaximumLength+' 字符');return;}
  const prefix=definition.editorIdPrefix??'';
  if(id&&prefix&&!id.startsWith(prefix)){setError('当前类型的 ID 必须以 '+prefix+' 开头');return;}
  const next:Record<string,unknown>={...current.attrs,[mapping.id]:id||null};
  for(const field of fields){
   const kindOfValue=definition.attributes[field] as RmdValueType;
   const input=(draft[field]??'').trim();
   const attr=pmKey(field,mapping);
   if(kindOfValue==='boolean'){next[attr]=input==='true';continue;}
   if(kindOfValue==='integer'){
    if(input&&!isValidRmdValue(kindOfValue,input)){setError((labels[field]??field)+'必须为 '+RMD_REGISTRY.constraints.integerMinimum+'–'+RMD_REGISTRY.constraints.integerMaximum+' 的整数');return;}
    next[attr]=input?Number(input):null;continue;
   }
   if(input.length>RMD_REGISTRY.constraints.stringEditorMaximumLength){setError((labels[field]??field)+'不能超过 '+RMD_REGISTRY.constraints.stringEditorMaximumLength+' 个字符');return;}
   if(/[\r\n]/.test(input)){setError((labels[field]??field)+'不能包含换行符');return;}
   next[attr]=input;
  }
  if(Object.keys(next).some(key=>next[key]!==current.attrs[key]))
   editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,next));
  onClose();
 };
 return <div className="rk-rmd-attrs-editor" role="dialog" aria-modal="false" aria-label={'编辑'+definition.label+' Markdown 属性'}
  onMouseDown={e=>e.stopPropagation()}>
  <div className="rk-rmd-attrs-editor-heading"><strong>{definition.label} · Markdown 属性</strong><span>只修改当前块</span></div>
  <TextInput label="稳定 ID（可选）" value={draft.id??''} onChange={v=>set('id',v)} placeholder="my-section"/>
  {fields.map(field=>definition.attributes[field]==='boolean'
   ?<label className="rk-rmd-attrs-toggle" key={field}><input type="checkbox" checked={draft[field]==='true'} onChange={e=>set(field,String(e.target.checked))}/>{(labels[field]??field)}</label>
   :<TextInput key={field} label={(labels[field]??field)} value={draft[field]??''} onChange={v=>set(field,v)}
     placeholder={definition.attributes[field]==='integer'?'自动':undefined}/>)}
  {error&&<p role="alert" className="rk-rmd-attrs-error">{error}</p>}
  <div className="rk-rmd-attrs-editor-actions">
   <Button label="取消属性编辑" variant="ghost" size="sm" onClick={onClose}>取消</Button>
   <Button label="保存属性" size="sm" onClick={apply}>保存属性</Button>
  </div>
 </div>;
}
