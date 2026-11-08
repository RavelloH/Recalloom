import React,{useEffect,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {isRmdId,isValidRmdValue} from '../rmd-schema';

const kinds:Record<string,{label:string;id:string;fields:readonly string[]}>={
 heading:{label:'标题',id:'id',fields:[]},
 paragraph:{label:'段落',id:'blockId',fields:[]},
 blockMath:{label:'块公式',id:'equationId',fields:[]},
 table:{label:'表格',id:'tableId',fields:['caption']},
 codeBlock:{label:'代码块',id:'id',fields:['filename','wrap','expand']},
 image:{label:'图片',id:'figureId',fields:['width','height','caption']}
};
const labels:Record<string,string>={caption:'图注',filename:'文件名',width:'宽度 px',height:'高度 px',wrap:'自动换行',expand:'默认展开'};
export const isRmdAttrsEditable=(type:string)=>Object.hasOwn(kinds,type);
/** Attributes are ProseMirror node metadata, never embedded into contentDOM.
 * This panel only makes a transaction when the user explicitly saves it.
 */
export default function RmdAttrsEditor({editor,pos,onClose}:{editor:Editor;pos:number;onClose:()=>void}){
 const initial=editor.state.doc.nodeAt(pos);
 const name=initial?.type.name??'';
 const config=kinds[name];
 const [draft,setDraft]=useState<Record<string,string>>(()=>{
  if(!initial||!config)return {};
  return Object.fromEntries([config.id,...config.fields].map(field=>[field,
   typeof initial.attrs[field]==='boolean'?String(initial.attrs[field]):String(initial.attrs[field]??'')]));
 });
 const [error,setError]=useState('');
 useEffect(()=>{const listener=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[onClose]);
 if(!initial||!config)return null;
 const set=(field:string,value:string)=>{setDraft(s=>({...s,[field]:value}));setError('');};
 const apply=()=>{
  const current=editor.state.doc.nodeAt(pos);
  if(!current||current.type.name!==name){setError('目标块已变化，请重新打开');return;}
  const id=draft[config.id]?.trim().toLowerCase()??'';
  if(id&&!isRmdId(id)){setError('ID 必须以英文字母开头，只能使用字母、数字、连字符，最长 80 字符');return;}
  const requiredPrefix=name==='table'?'tbl-':name==='image'?'fig-':name==='blockMath'?'eq-':'';
  if(id&&requiredPrefix&&!id.startsWith(requiredPrefix)){setError('当前类型的 ID 必须以 '+requiredPrefix+' 开头');return;}
  const next:Record<string,unknown>={...current.attrs,[config.id]:id||null};
  for(const field of config.fields){
   const input=(draft[field]??'').trim();
   if(field==='wrap'||field==='expand'){next[field]=input==='true';continue;}
   if(field==='width'||field==='height'){
    if(input&&!isValidRmdValue('integer',input)){setError(labels[field]+'必须为 40–1800 的整数');return;}
    next[field]=input?Number(input):null;continue;
   }
   if(input.length>(field==='caption'?240:240)){setError(labels[field]+'不能超过 240 个字符');return;}
   if(/[\r\n]/.test(input)){setError(labels[field]+'不能包含换行符');return;}
   next[field]=input;
  }
  const changed=Object.keys(next).some(key=>next[key]!==current.attrs[key]);
  if(changed){
   editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,next));
  }
  onClose();
 };
 return <div className="rk-rmd-attrs-editor" role="dialog" aria-modal="false" aria-label={'编辑'+config.label+' Markdown 属性'}
  onMouseDown={e=>e.stopPropagation()}>
  <div className="rk-rmd-attrs-editor-heading"><strong>{config.label} · Markdown 属性</strong><span>只修改当前块</span></div>
  <TextInput label="稳定 ID（可选）" value={draft[config.id]??''} onChange={v=>set(config.id,v)} placeholder="my-section"/>
  {config.fields.map(field=>field==='wrap'||field==='expand'
   ?<label className="rk-rmd-attrs-toggle" key={field}><input type="checkbox" checked={draft[field]==='true'} onChange={e=>set(field,String(e.target.checked))}/>{labels[field]}</label>
   :<TextInput key={field} label={labels[field]} value={draft[field]??''} onChange={v=>set(field,v)}
     placeholder={field==='width'||field==='height'?'自动':undefined}/>)}
  {error&&<p role="alert" className="rk-rmd-attrs-error">{error}</p>}
  <div className="rk-rmd-attrs-editor-actions">
   <Button label="取消属性编辑" variant="ghost" size="sm" onClick={onClose}>取消</Button>
   <Button label="保存属性" size="sm" onClick={apply}>保存属性</Button>
  </div>
 </div>;
}
