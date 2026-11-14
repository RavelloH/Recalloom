import React,{useEffect,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import type {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {assertRmdBlockCandidate,assertVisualField} from './block-visual-model';
import {StructuredBlockSettings,StructuredChildContentSettings} from './structured-block-settings';
import {STRUCTURED_BLOCKS} from './structured-block-settings-model';
import './block-settings-fields.css';

/** Each field retains its own incomplete draft until its canonical value changes. */
function SettingsText({value,label,onChange,rows,onValidationChange,description}:{
 value:string;label:string;onChange:(value:string)=>string|null;rows?:number;
 onValidationChange?:(error:string|null)=>void;description?:string;
}){
 const [draft,setDraft]=useState(value),[error,setError]=useState<string|null>(null);
 const report=useRef(onValidationChange);report.current=onValidationChange;
 useEffect(()=>{setDraft(value);setError(null);report.current?.(null);},[value]);
 const change=(next:string)=>{setDraft(next);const message=onChange(next);setError(message);report.current?.(message);};
 const status=error?{type:'error' as const,message:error}:undefined;
 return rows?<TextArea label={label} width="100%" value={draft} onChange={change} rows={rows}
  description={description} hasSpellCheck={false} status={status} statusVariant="detached"/>:
  <TextInput label={label} width="100%" value={draft} onChange={change}
   description={description} status={status} statusVariant="detached"/>;
}

/** Configure the selected node; prose editing belongs to the document canvas. */
export function BlockSettingsFields({editor,pos,node,onMathTypeChange,onRemove,mathTypeDisabled}:{
 editor:Editor;pos:number;node:ProseMirrorNode;
 onMathTypeChange?:(type:'inline'|'block')=>void;onRemove?:()=>void;mathTypeDisabled?:boolean;
}){
 const [latexError,setLatexError]=useState<string|null>(null);
 const kind=node.type.name,containerKind=String(node.attrs.kind??'');
 const applyAttribute=(name:string,value:string):string|null=>{
  const current=editor.state.doc.nodeAt(pos);
  if(!current||current.type.name!==kind)return '编辑目标已变化，请重新选择。';
  try{
   assertVisualField(kind,name,value);
   let attributeValue:string|number=value;
   if(kind==='heading'&&name==='level'){
    if(!/^[1-6]$/.test(value))return '标题级别必须为 1–6。';
    attributeValue=Number(value);
   }
   if(kind==='orderedList'&&name==='start'){
    if(!/^\d{1,9}$/.test(value))return '起始编号必须为 0–999999999 的整数。';
    attributeValue=Number(value);
   }
   const candidate=current.type.create({...current.attrs,[name]:attributeValue},current.content,current.marks);
   if(kind==='image')assertRmdBlockCandidate(editor.state.doc,candidate,pos);
   const tr=editor.state.tr.setNodeMarkup(pos,undefined,candidate.attrs);tr.doc.check();
   if(!candidate.eq(current))editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
   return null;
  }catch(error){return error instanceof Error?error.message:'当前输入无效，已保留有效内容。';}
 };
 if(kind==='richContainer'&&STRUCTURED_BLOCKS[containerKind])
  return <StructuredBlockSettings editor={editor} pos={pos} node={node}/>;
 if(kind==='richContainer'&&['message','tab','definition','front','back'].includes(containerKind))
  return <StructuredChildContentSettings editor={editor} pos={pos} node={node}/>;
 if(kind==='codeBlock')return <section className="rk-block-settings-fields" aria-label="代码设置">
  <SettingsText label="代码语言" value={String(node.attrs.language??'')} onChange={value=>applyAttribute('language',value)}/>
  <SettingsText label="代码正文" rows={10} value={node.textContent} onChange={value=>{
   const current=editor.state.doc.nodeAt(pos);if(!current||current.type!==node.type)return '编辑目标已变化，请重新选择。';
   try{
    const candidate=current.type.create(current.attrs,value?editor.state.schema.text(value):null,current.marks);
    const tr=editor.state.tr.replaceWith(pos,pos+current.nodeSize,candidate);tr.doc.check();
    if(!candidate.eq(current))editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
    return null;
   }catch(error){return error instanceof Error?error.message:'当前代码无法应用。';}
  }}/>
 </section>;
 const math=kind==='blockMath'||kind==='inlineMath';
 if(math||kind==='image')return <section className="rk-block-settings-fields" aria-label={math?'公式设置':'图片设置'}>
  {math?<>
   <Selector label="公式类型" width="100%" value={kind==='inlineMath'?'inline':'block'}
    options={[{value:'inline',label:'行内公式 $…$'},{value:'block',label:'块级公式 $$…$$'}]}
    isDisabled={!onMathTypeChange||Boolean(latexError)||mathTypeDisabled}
    disabledMessage={latexError?'请先修正公式，再切换类型。':mathTypeDisabled?'请先修正源码，再切换公式类型。':undefined}
    onChange={type=>{if(type!==(kind==='inlineMath'?'inline':'block'))onMathTypeChange?.(type as 'inline'|'block');}}/>
   <SettingsText label="LaTeX 公式" rows={5} value={String(node.attrs.latex??'')} onChange={value=>applyAttribute('latex',value)} onValidationChange={setLatexError}/>
   {kind==='blockMath'&&<p className="rk-block-panel-help">行内公式不使用公式 ID；切换为行内公式会移除公式 ID。</p>}
  </>:<>
   <SettingsText label="图片地址" value={String(node.attrs.src??'')} onChange={value=>applyAttribute('src',value)}/>
   <SettingsText label="替代文字" value={String(node.attrs.alt??'')} onChange={value=>applyAttribute('alt',value)}/>
   <SettingsText label="图片标题" value={String(node.attrs.title??'')} onChange={value=>applyAttribute('title',value)}/>
  </>}
  {onRemove&&<div className="rk-block-settings-actions"><Button label={math?'删除数学公式':'删除图片'}
   variant="destructive" size="sm" onClick={onRemove}/></div>}
 </section>;
 if(kind==='heading')return <Selector label="标题级别" width="100%" value={String(node.attrs.level??1)}
  options={[1,2,3,4,5,6].map(level=>({value:String(level),label:level+' 级标题'}))} onChange={value=>applyAttribute('level',value)}/>;
 if(kind==='orderedList')return <SettingsText label="起始编号" value={String(node.attrs.start??1)} onChange={value=>applyAttribute('start',value)}/>;
 if(kind==='table')return <p className="rk-block-panel-help">在下方设置表格图注与 ID；单元格内容和行列在文档中编辑。</p>;
 if(['paragraph','blockquote','bulletList','taskList','richFootnoteDefinition','rawMarkdown'].includes(kind))
  return <p className="rk-block-panel-help">正文在文档中直接编辑；此处仅设置当前块的参数。</p>;
 return null;
}
