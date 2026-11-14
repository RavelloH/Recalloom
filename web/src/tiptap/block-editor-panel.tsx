import {Icon} from '../icon';
import React,{useDeferredValue,useEffect,useMemo,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {closeHistory} from '@tiptap/pm/history';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TabList,Tab} from '@astryxdesign/core/TabList';
import {Collapsible} from '@astryxdesign/core/Collapsible';

import {parseRmdVisual} from '../rmd-visual';
import {serializeRmdBlock,serializeRmdInline} from '../rmd-serialize';
import {blockEditorTargetAt,mapBlockEditorTarget} from './editor-block-actions';
import {BlockSettingsFields} from './block-settings-fields';
import {createMathTypeTransaction,createRemoveBlockObjectTransaction} from './block-object-operations';
import {assertRmdBlockCandidate} from './block-visual-model';
import {EditorInsertFields} from './insert-dialog';
import {richTitle} from './rich-schema';
import {RmdSchemaAttributeFields} from './rmd-schema-attrs-fields';
import {RmdContainerAttributeFields} from './rmd-container-fields';
import {RmdLeafAttributeFields} from './rmd-leaf-fields';
import type {RichContainerField} from './rmd-container-attributes';
import {isRmdAttrsEditable} from './rmd-schema-attrs-model';
import {describeRmdAnchorConflict,findRmdAnchorConflictForNode} from './rmd-anchor-ids';
import {WorkspacePanel} from '../workspace-panels';
import './block-editor-panel.css';

const Preview=React.lazy(()=>import('../markdown-preview'));
const safeTitle=(s:string)=>s.replace(/[\r\n]/g,' ').slice(0,180);
type BlockPanelProps={editor:Editor;pos:number;attributePos?:number|null;onClose:()=>void;recordId?:string;
 insertion?:Omit<React.ComponentProps<typeof EditorInsertFields>,'onClose'>};
const blockSource=(node:import('@tiptap/pm/model').Node)=>node.isInline?serializeRmdInline([node.toJSON()]):serializeRmdBlock(node.toJSON());
const wrapSource=(kind:string,body:string)=>{const fence=':'.repeat(Math.max(3,...(body.match(/^:{3,}/gm)??[]).map(value=>value.length+1)));return fence+' '+kind+'\n\n'+body+'\n\n'+fence;};
const typeLabels:Record<string,string>={paragraph:'段落',heading:'标题',blockquote:'引用',bulletList:'无序列表',orderedList:'有序列表',taskList:'任务列表',table:'表格',codeBlock:'代码',image:'图片',blockMath:'块级公式',inlineMath:'行内公式',richLinkCard:'链接卡片',wikiEmbed:'引用文档',horizontalRule:'分隔线',rawMarkdown:'原始内容',richFootnoteDefinition:'脚注'};
export function BlockEditorPanel(props:BlockPanelProps){
 return props.insertion?<BlockInsertPanel {...props} insertion={props.insertion}/>:<BlockContentPanel {...props}/>;
}
function BlockInsertPanel({insertion,onClose}:BlockPanelProps&{insertion:NonNullable<BlockPanelProps['insertion']>}){
 const [open,setOpen]=useState(true);
 const {value}=insertion;
 const title=(value.existing?'编辑':'插入')+(value.kind==='link'?'链接':value.kind==='image'?'图片':'数学公式');
 return <WorkspacePanel id="block-editor" label="块编辑面板" title={title} open={open} onOpenChange={setOpen} onAfterClose={onClose}>
  <div className="rk-block-editor-panel"><div className="rk-block-panel-fields rk-block-insert-fields">
   <EditorInsertFields {...insertion} onClose={()=>setOpen(false)}/>
  </div></div>
 </WorkspacePanel>;
}
function BlockContentPanel({editor,pos,attributePos,onClose,recordId}:BlockPanelProps){
 const [version,setVersion]=useState(0);
 const [open,setOpen]=useState(true);
 const [mode,setMode]=useState<'settings'|'source'>('settings');
 const [draft,setDraft]=useState(()=>{const node=blockEditorTargetAt(editor,pos)?.node;return node?blockSource(node):'';});
 const [error,setError]=useState('');
 const [sourceError,setSourceError]=useState('');
 const invalidSource=useRef(false);
 const canonicalRef=useRef(draft);
 const inspectedPos=useRef(pos);
 useEffect(()=>{
  const node=blockEditorTargetAt(editor,pos)?.node;
  const source=node?blockSource(node):'';
  if(canonicalRef.current!==source){canonicalRef.current=source;if(!invalidSource.current)setDraft(source);setError('');}
 },[editor,pos]);
 useEffect(()=>{
  const update=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(!transaction.docChanged)return;
   setVersion(value=>value+1);
   const previous=transaction.before.nodeAt(inspectedPos.current);
   const current=previous?mapBlockEditorTarget(editor,transaction,inspectedPos.current,previous):null;
   if(!current)return;
   inspectedPos.current=current.pos;
   const canonical=blockSource(current.node);
   if(canonical!==canonicalRef.current){
    canonicalRef.current=canonical;
    // An external direct edit of the selected block updates the sidebar.
    // Editing the sidebar itself must not overwrite incomplete text inputs.
    if(!invalidSource.current&&(transaction.getMeta('rk-block-panel-edit')!==true||transaction.getMeta('rk-block-panel-field-edit')===true))setDraft(canonical);
   }
  };
  editor.on('transaction',update);
  return()=>{editor.off('transaction',update);};
 },[editor,pos]);
 const block=blockEditorTargetAt(editor,pos);
 const current=block?.node;
 const kind=current?.type.name??'';
 const subkind=kind==='richContainer'?String(current?.attrs.kind??''):'';
 const parentKind=block?.parentKind??null;
 const [previewOpen,setPreviewOpen]=useState(()=>Boolean(current?.isLeaf||kind==='codeBlock'));
 const nestedSource=(source:string)=>{
  if(!parentKind)return source;
  if(parentKind==='flashcard'&&block&&block.parentPos!==null){
   const parent=editor.state.doc.nodeAt(block.parentPos);
   if(parent){
    const siblings:string[]=[];
    parent.forEach((node,_offset,index)=>siblings.push(index===block.index?source:serializeRmdBlock(node.toJSON())));
    return wrapSource('flashcard',siblings.join('\n\n'));
   }
  }
  return wrapSource(parentKind,source);
 };
 const presentation=useMemo(()=>current?nestedSource(blockSource(current)):'', [current,version,parentKind]);
 const previewSource=useDeferredValue(presentation);
 if(!current)return null;
 const attr=(name:RichContainerField,value:string|number|null)=>{
  const node=editor.state.doc.nodeAt(pos);
  if(!node||node.type!==current.type){setError('目标块已变化，请重新打开');return;}
  if(name==='title'&&typeof value==='string')value=safeTitle(value);
  if(node.attrs[name]===value)return;
  try{
   assertRmdBlockCandidate(editor.state.doc,node.type.create({...node.attrs,[name]:value},node.content,node.marks),pos);
   const tr=editor.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,[name]:value});
   tr.doc.check();
   editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
   if(!invalidSource.current)setDraft(blockSource(editor.state.doc.nodeAt(pos)!));
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
   if(!invalidSource.current)setDraft(blockSource(editor.state.doc.nodeAt(pos)!));
   setError('');
  }catch{setError('当前属性未能写入，请确认格式');}
 };
 const commitRaw=(value:string)=>{
  setDraft(value);
  try{
   const parsed=parseRmdVisual(nestedSource(value));
   let parsedBlock=parsed.content?.[0]??(kind==='paragraph'&&!value.trim()?{type:'paragraph'}:undefined);
   if(current.isInline){
    if(parsed.content?.length!==1||parsedBlock?.type!=='paragraph'||parsedBlock.content?.length!==1)
     throw new Error('请保留一个完整的行内公式。');
    parsedBlock=parsedBlock.content[0];
   }else if(!parentKind&&parsed.content?.length!==1&&!(kind==='paragraph'&&!value.trim()))throw new Error('每次只能编辑一个完整块。');
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
   assertRmdBlockCandidate(editor.state.doc,candidate,pos);
   const anchorConflict=findRmdAnchorConflictForNode(editor.state.doc,candidate,pos);
   if(anchorConflict)throw new Error(describeRmdAnchorConflict(anchorConflict));
   const existing=editor.state.doc.nodeAt(pos);
   if(!existing||existing.type!==candidate.type)throw new Error('编辑目标已变化，请重新选择块。');
   const tr=editor.state.tr.replaceWith(pos,pos+existing.nodeSize,candidate);
   tr.doc.check();
   if(!existing.eq(candidate))editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true));
   invalidSource.current=false;setSourceError('');setError('');
  }catch(e){
   invalidSource.current=true;setSourceError(e instanceof Error?e.message:'输入尚未构成有效的完整块；修正后会自动生效');
  }
 };
 const label=kind==='richContainer'?richTitle(subkind):typeLabels[kind]??'内容块';
 const changeMathType=(type:'inline'|'block')=>{
  if(invalidSource.current){setError('请先修正源码，再切换公式类型。');return;}
  try{
   const next=createMathTypeTransaction(editor,pos,type);
   editor.view.dispatch(closeHistory(next.transaction));
   editor.view.dom.dispatchEvent(new CustomEvent('rmd-open-block-editor',{detail:{pos:next.pos}}));
  }catch(error){setError(error instanceof Error?error.message:'公式类型暂时无法转换。');}
 };
 const removeObject=()=>{
  try{
   editor.view.dispatch(closeHistory(createRemoveBlockObjectTransaction(editor,pos)));
   editor.view.focus();
  }catch(error){setError(error instanceof Error?error.message:'此内容暂时无法删除。');}
 };
 const schemaPos=attributePos??(isRmdAttrsEditable(kind)?pos:null);
 const preview=<Collapsible className="rk-block-panel-preview" trigger={<span className="rk-block-panel-preview-label"><Icon name="eye" size="sm"/>效果预览</span>}
  isOpen={previewOpen} onOpenChange={setPreviewOpen}>
  {previewOpen&&<div className="rk-block-panel-preview-body record-main">
   <React.Suspense fallback={<div className="muted small">准备预览…</div>}>
    <Preview content={previewSource} sourceId={recordId}/>
   </React.Suspense>
  </div>}
 </Collapsible>;
 return <WorkspacePanel id="block-editor" label="块编辑面板" title={parentKind?'编辑子块':'编辑块'} description={label} open={open}
  onOpenChange={setOpen} onAfterClose={onClose}>
  <div className="rk-block-editor-panel" data-block-kind={kind}>
  <div className="rk-block-panel-modes">
   <TabList role="tablist" aria-label="块编辑模式" value={mode} onChange={value=>setMode(value as 'settings'|'source')}
    size="sm" overflow="visible" hasDivider={false}>
    <Tab value="settings" label="设置" id="block-mode-settings" panelId="block-pane-settings" icon={<Icon name="settings" size="sm"/>}/>
    <Tab value="source" label="源码" id="block-mode-source" panelId="block-pane-source" icon={<Icon name="code" size="sm"/>}
     endContent={sourceError?<span className="rk-block-source-pending" aria-hidden="true" title="有未应用的源码修改"/>:undefined}/>
   </TabList>
   <span className="rk-block-panel-sync">同步到文档草稿</span>
  </div>
  <section className="rk-block-panel-fields">
   {(current.isLeaf||kind==='codeBlock')&&preview}
   <div id="block-pane-settings" role="tabpanel" aria-labelledby="block-mode-settings" hidden={mode!=='settings'}>
   <BlockSettingsFields editor={editor} pos={pos} node={current} mathTypeDisabled={Boolean(sourceError)}
    onMathTypeChange={kind==='blockMath'||kind==='inlineMath'?changeMathType:undefined}
    onRemove={['image','blockMath','inlineMath'].includes(kind)?removeObject:undefined}/>
   {kind==='richContainer'&&<RmdContainerAttributeFields key={'container-'+String(current.attrs.kind)}
     editor={editor} pos={pos} node={current} onApply={attr}/>}
   {(kind==='richLinkCard'||kind==='wikiEmbed')&&<RmdLeafAttributeFields key={kind} node={current} onApply={applyLeaf}/>}
   {schemaPos!==null&&isRmdAttrsEditable(editor.state.doc.nodeAt(schemaPos)?.type.name??'')&&
    <RmdSchemaAttributeFields editor={editor} pos={schemaPos}/>}
   {kind==='horizontalRule'&&<p className="rk-block-panel-help">分隔线在文档中显示为一条横线，无需填写内容。</p>}
   </div>
   <div id="block-pane-source" role="tabpanel" aria-labelledby="block-mode-source" hidden={mode!=='source'}>
   <TextArea label="块源码" width="100%" rows={10} value={draft} onChange={commitRaw}
    placeholder="编辑当前块的 Markdown / RMD" status={sourceError?{type:'error',message:sourceError}:undefined} statusVariant="detached"/>
   <p className="rk-block-panel-help">编辑当前块的完整源码。无效输入会保留在这里，修正后同步到文档。</p>
   </div>
   {!current.isLeaf&&kind!=='codeBlock'&&preview}
   {error&&<p className="rk-block-panel-error" role="alert">{error}</p>}
   <p className="rk-block-panel-help">修改会实时同步到文档，点击页面「保存」后保存。</p>
  </section>
  </div>
 </WorkspacePanel>;
}
