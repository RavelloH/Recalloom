import React,{useEffect,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {describeRmdAnchorConflict,findRmdAnchorConflict} from './rmd-anchor-ids';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {Button} from '@astryxdesign/core/Button';
import {Slider} from '@astryxdesign/core/Slider';
import {RMD_COLORS} from '../rmd-schema';
import {SKETCH_DEFAULT_COLORS,SKETCH_PALETTE,isSketchKind} from '../sketch-geometry';
import {CHAT_SENDERS,normalizeRichContainerField,richContainerFields,type RichContainerField} from './rmd-container-attributes';

/** Same live transaction protocol as the six @ attrs families, but scoped to
 * the valid fields of the current RMD multi-line container. */
export function RmdContainerAttributeFields({editor,pos,node,onApply}:{
 editor:Editor;pos:number;node:ProseMirrorNode;onApply:(field:RichContainerField,value:string|number|null)=>void;
}){
 const kind=String(node.attrs.kind??'');
 const fields=richContainerFields(kind);
 const [inputs,setInputs]=useState<Record<string,string>>(()=>{
  const value:Record<string,string>={};
  for(const field of fields)value[field]=String(node.attrs[field]??'');
  return value;
 });
 const canonical=Object.fromEntries(fields.map(field=>[field,String(node.attrs[field]??'')]));
 const lastCanonical=useRef(canonical);
 const [errors,setErrors]=useState<Record<string,string>>({});
 // Editing raw RMD or using direct text controls can replace the underlying
 // ProseMirror node while the panel remains open. Refresh only fields that
 // actually changed, preserving incomplete/invalid drafts in other fields.
 useEffect(()=>{
  const changed=Object.fromEntries(fields.filter(field=>lastCanonical.current[field]!==canonical[field])
   .map(field=>[field,canonical[field]]));
  lastCanonical.current=canonical;
  if(Object.keys(changed).length){
   setInputs(previous=>({...previous,...changed}));
   setErrors(previous=>({...previous,...Object.fromEntries(Object.keys(changed).map(field=>[field,'']))}));
  }
 },[node,kind]);
 if(!fields.length)return null;
 const set=(field:RichContainerField,raw:string)=>{
  setInputs(previous=>({...previous,[field]:raw}));
  const normalized=normalizeRichContainerField(kind,field,raw);
  if(!normalized.ok){setErrors(previous=>({...previous,[field]:normalized.error}));return;}
  if(field==='id'&&typeof normalized.value==='string'){
   const current=editor.state.doc.nodeAt(pos)??node;
   const conflict=findRmdAnchorConflict(editor.state.doc,normalized.value,{pos,nodeSize:current.nodeSize});
   if(conflict){setErrors(previous=>({...previous,[field]:describeRmdAnchorConflict(conflict)}));return;}
  }
  setErrors(previous=>({...previous,[field]:''}));
  onApply(field,normalized.value);
 };
 const sketch=isSketchKind(kind);
 const color=String(node.attrs.color??'');
 const actualColor=color&&color in SKETCH_PALETTE?color:sketch?SKETCH_DEFAULT_COLORS[kind]:'yellow';
 const numericFields=fields.filter(field=>['stroke','padding','roughness','opacity'].includes(field));
 const labels:Record<string,string>={
  stroke:'笔画宽度（0.5–6）',padding:'内边距（0–24）',
  roughness:'手绘粗糙度（0–3）',opacity:'荧光笔透明度（0.1–0.85）'
 };
 const ranges:Record<string,{min:number;max:number;step:number;value:number}>={stroke:{min:.5,max:6,step:.1,value:2},padding:{min:0,max:24,step:.5,value:['circle','box','bracket'].includes(kind)?5:3},roughness:{min:0,max:3,step:.1,value:1},opacity:{min:.1,max:.85,step:.01,value:.42}};
 return <section className="rk-block-schema-attrs" aria-label={sketch?'手绘块样式':'容器属性'}>
  <strong>{sketch?'手绘标记样式':'容器属性'}</strong>
  {sketch&&<p className="rk-block-panel-help">修改即时更新图形与源码。留空代表 RMD 默认参数，不产生冗余属性。</p>}
  {fields.includes('title')&&<div className="rk-block-schema-field">
   <TextInput label={kind==='message'?'发言人名称':kind==='definition'?'术语名称':'块标题'} width="100%"
    value={inputs.title??''} onChange={value=>set('title',value)}/>
   {errors.title&&<p className="rk-block-panel-error" role="alert">{errors.title}</p>}
  </div>}
  {fields.includes('id')&&<div className="rk-block-schema-field">
   <TextInput label="容器锚点 ID（可选）" width="100%" value={inputs.id??''}
    onChange={raw=>set('id',raw)} placeholder="my-block-anchor"/>
   {errors.id&&<p className="rk-block-panel-error" role="alert">{errors.id}</p>}
  </div>}
  {fields.includes('sender')&&<div className="rk-block-schema-field">
   <Selector label="消息身份" width="100%" value={inputs.sender||'assistant'}
    options={CHAT_SENDERS.map(sender=>({
     value:sender,label:sender==='assistant'?'Agent / 助手':sender==='user'?'用户':'系统'
    }))} onChange={sender=>set('sender',sender)}/>
   {errors.sender&&<p className="rk-block-panel-error" role="alert">{errors.sender}</p>}
  </div>}
  {fields.includes('color')&&<div className="rk-block-schema-field">
   <div className="rk-block-color-palette" role="group" aria-label="笔迹颜色快捷选择">
    {RMD_COLORS.map(value=><Button key={value} label={'使用'+value+'颜色'} aria-pressed={actualColor===value}
     variant={actualColor===value?'secondary':'ghost'} size="sm" isIconOnly
     icon={<span className="rk-block-palette-swatch" style={{background:SKETCH_PALETTE[value as keyof typeof SKETCH_PALETTE]}} aria-hidden="true"/>}
     onClick={()=>set('color',value)}/>)}
   </div>
   <Selector label="笔迹颜色" width="100%" value={inputs.color??''}
    options={[{value:'',label:'默认颜色（'+SKETCH_DEFAULT_COLORS[kind as keyof typeof SKETCH_DEFAULT_COLORS]+'）'},
     ...RMD_COLORS.map(color=>({value:color,label:color}))]}
    onChange={color=>set('color',color)}/>
   <div className="rk-block-color-current">
    <span className="rk-block-color-swatch" style={{background:SKETCH_PALETTE[actualColor as keyof typeof SKETCH_PALETTE]}} aria-hidden="true"/>
    <span>当前颜色：{actualColor} {color?'（自定义）':'（默认）'}</span>
   </div>
  </div>}
  {numericFields.map(field=><div className="rk-block-schema-field" key={field}>
   <TextInput width="100%" label={labels[field]??field} value={inputs[field]??''}
    onChange={raw=>set(field,raw)} placeholder="默认"/>
   <div className="rk-block-sketch-range">
    <div className="rk-block-sketch-slider"><Slider label={'调整'+labels[field]} isLabelHidden width="100%"
     min={ranges[field].min} max={ranges[field].max} step={ranges[field].step}
     value={Math.max(ranges[field].min,Math.min(ranges[field].max,Number.isFinite(Number(inputs[field]))&&inputs[field]!==''?Number(inputs[field]):ranges[field].value))}
     onChange={(value:number)=>set(field,String(value))}/></div>
    <Button label={'重置'+labels[field]} variant="ghost" size="sm" onClick={()=>set(field,'')}>恢复默认</Button>
   </div>
   {errors[field]&&<p className="rk-block-panel-error" role="alert">{errors[field]}</p>}
  </div>)}
 </section>;
}
