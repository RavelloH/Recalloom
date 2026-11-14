import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {Fragment,type Node as ProseMirrorNode} from '@tiptap/pm/model';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {EditorView,type NodeViewConstructor} from '@tiptap/pm/view';
import {baseKeymap,toggleMark} from '@tiptap/pm/commands';
import {splitListItem,sinkListItem,liftListItem} from '@tiptap/pm/schema-list';
import {addRowAfter,deleteRow,addColumnAfter,deleteColumn,tableEditing} from '@tiptap/pm/tables';
import {keymap} from '@tiptap/pm/keymap';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {describeRmdAnchorConflict,findRmdAnchorConflictForNode} from './rmd-anchor-ids';
import {assertRmdBlockCandidate,assertVisualField,structuredChildren} from './block-visual-model';
import {mapBlockEditorTarget} from './editor-block-actions';
import './block-visual-fields.css';

const visualMarks=[['bold','粗体'],['italic','斜体'],['strike','删除线'],['code','行内代码'],['underline','下划线'],['superscript','上标'],['subscript','下标']] as const;

/** A failed value remains editable until that particular canonical field changes. */
function NativeField({value,label,onChange,rows,onValidationChange}:{value:string;label:string;onChange:(value:string)=>string|null;rows?:number;onValidationChange?:(error:string|null)=>void}){
 const [draft,setDraft]=useState(value),[error,setError]=useState<string|null>(null);
 const errorId=useId(),reportValidation=useRef(onValidationChange);reportValidation.current=onValidationChange;
 useEffect(()=>{setDraft(value);setError(null);reportValidation.current?.(null);},[value]);
 const change=(next:string)=>{setDraft(next);const message=onChange(next);setError(message);reportValidation.current?.(message);};
 const accessibility={'aria-label':label,'aria-invalid':error?true:undefined,'aria-describedby':error?errorId:undefined};
 return <label>{label}{rows?<textarea {...accessibility} rows={rows} spellCheck={false} value={draft} onChange={event=>change(event.target.value)}/>:<input {...accessibility} value={draft} onChange={event=>change(event.target.value)}/>}{error&&<span id={errorId} className="rk-block-visual-field-error" role="alert">{error}</span>}</label>;
}

/** Isolated schema-sharing view. Its transactions always enter parent history. */
export function BlockVisualFields({editor,pos,node,onMathTypeChange,onRemove}:{editor:Editor;pos:number;node:ProseMirrorNode;onMathTypeChange?:(type:'inline'|'block')=>void;onRemove?:()=>void}){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null);
 const position=useRef(pos),synchronize=useRef<(()=>void)|null>(null);
 const [error,setError]=useState(''),[draft,setDraft]=useState(node);
 const [nativeErrors,setNativeErrors]=useState<Record<string,string|null>>({});
 const [activeMarks,setActiveMarks]=useState<string[]>([]);
 const kind=node.type.name,atom=node.isLeaf;
 useLayoutEffect(()=>{position.current=pos;synchronize.current?.();},[pos,node]);
 useEffect(()=>{
  if(atom||kind==='codeBlock'||!host.current)return;
  const original=editor.state.doc.nodeAt(position.current);
  if(!original)return;
  const schema=editor.state.schema;
  let committed=original,disposed=false;
  const updateActiveMarks=(state:EditorState)=>{
   const {selection}=state;
   const next=visualMarks.filter(([name])=>{
    const mark=schema.marks[name];if(!mark)return false;
    return selection.empty?Boolean(mark.isInSet(state.storedMarks??selection.$from.marks())):state.doc.rangeHasMark(selection.from,selection.to,mark);
   }).map(([name])=>name);
   setActiveMarks(previous=>previous.length===next.length&&previous.every((name,index)=>name===next[index])?previous:next);
  };
  const hardBreak:import('@tiptap/pm/state').Command=(state,dispatch)=>{
   const type=schema.nodes.hardBreak;
   if(!type||!state.selection.$from.parent.isTextblock||state.selection.$from.parent.type.name==='codeBlock')return false;
   dispatch?.(state.tr.replaceSelectionWith(type.create()).scrollIntoView());return true;
  };
  const listCommand=(operation:typeof splitListItem):import('@tiptap/pm/state').Command=>(state,dispatch,view)=>{
   const {$from}=state.selection;
   for(let depth=$from.depth;depth>0;depth--){
    const item=$from.node(depth).type;
    if(item.name==='listItem'||item.name==='taskItem')return operation(item)(state,dispatch,view);
   }
   return false;
  };
  const plugins=[keymap({
   'Mod-z':()=>editor.commands.undo(),'Mod-Shift-z':()=>editor.commands.redo(),'Mod-y':()=>editor.commands.redo(),
   Enter:(state,dispatch,view)=>{
    if(listCommand(splitListItem)(state,dispatch,view))return true;
    return ['paragraph','heading'].includes(kind)?hardBreak(state,dispatch,view):false;
   },
   'Shift-Enter':hardBreak,Tab:listCommand(sinkListItem),'Shift-Tab':listCommand(liftListItem)
  }),keymap(baseKeymap),tableEditing()];
  const atomView:NodeViewConstructor=(initial,_view,getPos)=>{
   let current=initial;
   const dom=document.createElement(initial.isInline?'span':'div');
   dom.className='rk-block-visual-atom';dom.contentEditable='false';dom.tabIndex=0;dom.setAttribute('role','button');
   const render=()=>{
    dom.replaceChildren();
    const type=current.type.name;
    const label=type==='image'?'图片':type==='richLinkCard'?'链接卡片':type==='wikiEmbed'?'引用文档':'公式';
    dom.setAttribute('aria-label','编辑'+label);dom.title='点击编辑'+label;
    if(type==='blockMath'||type==='inlineMath'){
     try{katex.render(String(current.attrs.latex??''),dom,{throwOnError:false,trust:false,strict:false,displayMode:type==='blockMath'});}
     catch{dom.textContent=String(current.attrs.latex??'公式');}
    }else if(type==='image'){
     const image=document.createElement('img'),fallback=document.createElement('span');
     image.alt=String(current.attrs.alt??'');image.loading='lazy';
     fallback.className='rk-block-visual-atom-hint';fallback.textContent='图片 · 点击编辑';
     image.addEventListener('error',()=>{image.hidden=true;fallback.textContent='图片加载失败 · 点击编辑地址';});
     try{assertVisualField('image','src',String(current.attrs.src??''));image.src=String(current.attrs.src);}catch{image.hidden=true;fallback.textContent='图片地址无效 · 点击编辑';}
     dom.append(image,fallback);
    }else{
     const title=document.createElement('strong'),detail=document.createElement('span');
     title.textContent=String(current.attrs.title||(type==='wikiEmbed'?'引用文档':'链接卡片'));
     detail.textContent=String(type==='wikiEmbed'?current.attrs.target??'':current.attrs.url??'');
     dom.append(title,detail);
    }
   };
   const open=()=>{
    const localPos=getPos();if(typeof localPos!=='number')return;
    if(!local.state.doc.firstChild?.content.eq(committed.content)){setError('请先修正当前正文，再编辑嵌套内容。');return;}
    editor.view.dom.dispatchEvent(new CustomEvent('rmd-open-block-editor',{detail:{pos:position.current+localPos}}));
   };
   dom.addEventListener('click',open);
   dom.addEventListener('keydown',event=>{const key=(event as KeyboardEvent).key;if(key==='Enter'||key===' '){event.preventDefault();open();}});
   render();
   return {dom,update(next){if(next.type!==initial.type)return false;current=next;render();return true;},stopEvent:()=>true,ignoreMutation:()=>true};
  };
  const local=new EditorView(host.current,{
   state:EditorState.create({schema,doc:schema.topNodeType.create(null,original),plugins}),
   attributes:{class:'rk-block-visual-document',role:'textbox','aria-label':'可视化编辑块正文','aria-multiline':'true'},
   nodeViews:{richFootnoteRef(initial){
    const dom=document.createElement('span');dom.contentEditable='false';dom.className='rk-block-visual-footnote-ref';
    const render=(current:ProseMirrorNode)=>{const id=String(current.attrs.id??'');dom.textContent='['+id+']';dom.setAttribute('aria-label','脚注：'+id);};
    render(initial);return {dom,update(current){if(current.type!==initial.type)return false;render(current);return true;},ignoreMutation:()=>true};
   },blockMath:atomView,inlineMath:atomView,image:atomView,richLinkCard:atomView,wikiEmbed:atomView,richContainer(container){
    const dom=document.createElement('section'),label=document.createElement('div'),contentDOM=document.createElement('div');
    dom.className='rk-block-visual-container';label.className='rk-block-visual-container-label';label.contentEditable='false';
    const updateLabel=(current:ProseMirrorNode)=>{label.textContent=String(current.attrs.title||current.attrs.kind);dom.dataset.kind=String(current.attrs.kind);};
    updateLabel(container);dom.append(label,contentDOM);
    return {dom,contentDOM,update(current){if(current.type!==container.type)return false;updateLabel(current);return true;}};
   }},
   handleDOMEvents:{compositionend(){queueMicrotask(()=>{if(!disposed)sync();});return false;}},
   dispatchTransaction(transaction){
    const next=local.state.apply(transaction);
    // A single-block editor must not turn Enter/lift/delete-table into a second
    // document root that the author can neither commit nor undo locally.
    if(transaction.docChanged&&(next.doc.childCount!==1||next.doc.firstChild?.type!==committed.type||next.doc.firstChild?.attrs.kind!==committed.attrs.kind)){
     setError('此操作会改变当前块类型；请使用块操作菜单。');return;
    }
    local.updateState(next);
    if(transaction.selectionSet||transaction.storedMarksSet||transaction.docChanged)updateActiveMarks(next);
    if(!transaction.docChanged)return;
    setDraft(next.doc.firstChild??original);
    try{
     const targetPos=position.current;
     const current=editor.state.doc.nodeAt(targetPos),body=next.doc.firstChild;
     if(!current||!body||next.doc.childCount!==1||body.type!==current.type||body.attrs.kind!==current.attrs.kind)
      throw new Error('请保留当前块类型；可在正文中编辑内容。');
     const candidate=current.type.create(current.attrs,body.content,current.marks);
     assertRmdBlockCandidate(editor.state.doc,candidate,targetPos);
     const conflict=findRmdAnchorConflictForNode(editor.state.doc,candidate,targetPos);
     if(conflict)throw new Error(describeRmdAnchorConflict(conflict));
     if(!candidate.eq(current)){
      const tr=editor.state.tr.replaceWith(targetPos,targetPos+current.nodeSize,candidate);tr.doc.check();
      committed=candidate;
      editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true).setMeta('rk-block-visual-edit',true));
     }
     setError('');
    }catch(e){setError(e instanceof Error?e.message:'修改暂时无效，已保留输入。');}
   }
  });
  view.current=local;setDraft(original);updateActiveMarks(local.state);
  function sync(){
   if(local.composing)return;
   const current=editor.state.doc.nodeAt(position.current);
   if(!current||current.type.name!==kind)return;
   // Unrelated property changes retain an incomplete local body and caret.
   if(current.content.eq(committed.content)){
    if(!local.state.doc.firstChild?.sameMarkup(current)){
     local.updateState(local.state.apply(local.state.tr.setNodeMarkup(0,undefined,current.attrs,current.marks)));
     updateActiveMarks(local.state);
     setDraft(local.state.doc.firstChild!);
    }
    committed=current;return;
   }
   const target=schema.topNodeType.create(null,current),old=local.state.doc;
   const start=old.content.findDiffStart(target.content);
   if(start!==null){
    const end=old.content.findDiffEnd(target.content)!;
    // Minimal replacement maps selection instead of recreating editor state.
    const overlap=Math.max(0,start-Math.min(end.a,end.b));
    const tr=local.state.tr.replace(start,end.a+overlap,target.slice(start,end.b+overlap));
    local.updateState(local.state.apply(tr));
   }
   committed=current;setDraft(local.state.doc.firstChild!);updateActiveMarks(local.state);setError('');
  }
  const onTransaction=({transaction}:{transaction:import('@tiptap/pm/state').Transaction})=>{
   if(!transaction.docChanged)return;
   const target=mapBlockEditorTarget(editor,transaction,position.current,committed);
   if(!target)return;
   position.current=target.pos;
   if(!transaction.getMeta('rk-block-visual-edit'))sync();
  };
  synchronize.current=sync;
  editor.on('transaction',onTransaction);
  return()=>{disposed=true;synchronize.current=null;editor.off('transaction',onTransaction);view.current=null;local.destroy();};
 },[editor,kind,atom]);
 const applyAttribute=(name:string,value:string):string|null=>{
  const current=editor.state.doc.nodeAt(pos);if(!current||current.type.name!==kind)return '编辑目标已变化，请重新选择。';
  try{
   assertVisualField(kind,name,value);
   let attributeValue:string|number=value;
   if(kind==='heading'&&name==='level'){
    if(!/^[1-6]$/.test(value))return '标题级别必须为 1–6。';
    attributeValue=Number(value);
   }
   if(kind==='orderedList'&&name==='start'){
    if(!/^\d{1,9}$/.test(value)||Number(value)>999999999)return '起始编号必须为 0–999999999 的整数。';
    attributeValue=Number(value);
   }
   const candidate=current.type.create({...current.attrs,[name]:attributeValue},current.content,current.marks);
   if(kind==='image')assertRmdBlockCandidate(editor.state.doc,candidate,pos);
   const tr=editor.state.tr.setNodeMarkup(pos,undefined,candidate.attrs);tr.doc.check();
   if(!candidate.eq(current))editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
   return null;
  }catch(error){return error instanceof Error?error.message:'当前输入尚未有效，原文已保留。';}
 };
 if(kind==='codeBlock')return <section className="rk-block-visual-fields"><NativeField label="代码语言" value={String(node.attrs.language??'')} onChange={value=>applyAttribute('language',value)}/><NativeField label="代码正文" rows={12} value={node.textContent} onChange={value=>{
  const current=editor.state.doc.nodeAt(pos);if(!current)return '编辑目标已变化，请重新选择。';
  try{
   const candidate=current.type.create(current.attrs,value?editor.state.schema.text(value):null);
   const tr=editor.state.tr.replaceWith(pos,pos+current.nodeSize,candidate);tr.doc.check();
   if(!candidate.eq(current))editor.view.dispatch(tr.setMeta('rk-block-panel-edit',true).setMeta('rk-block-panel-field-edit',true));
   return null;
  }catch(error){return error instanceof Error?error.message:'当前代码尚未有效，原文已保留。';}
 }}/>{error&&<p role="alert">{error}</p>}</section>;
 if(atom){
  const fields=kind==='image'?[['src','图片地址'],['alt','替代文字'],['title','图片标题']]:kind==='blockMath'||kind==='inlineMath'?[['latex','LaTeX 公式']]:[];
  if(!fields.length)return null;
  const math=kind==='blockMath'||kind==='inlineMath';
  return <section className="rk-block-visual-fields" aria-label="内容编辑">
   {math&&<label>公式类型<select aria-label="公式类型" value={kind==='inlineMath'?'inline':'block'} disabled={!onMathTypeChange||Boolean(nativeErrors.latex)} onChange={event=>{
    if(nativeErrors.latex)return;
    const type=event.target.value as 'inline'|'block';
    if(type!==(kind==='inlineMath'?'inline':'block'))onMathTypeChange?.(type);
   }}><option value="inline">行内公式 $…$</option><option value="block">块级公式 $$…$$</option></select></label>}
   {math&&<p className="rk-block-visual-field-help">行内公式不支持公式 ID；切换为行内公式会移除公式 ID。{nativeErrors.latex?'请先修正公式，再切换类型。':''}</p>}
   {fields.map(([name,label])=><NativeField key={name} label={label!} rows={name==='latex'?5:2} value={String(node.attrs[name!]??'')} onChange={value=>applyAttribute(name!,value)} onValidationChange={message=>setNativeErrors(previous=>previous[name!]===message?previous:{...previous,[name!]:message})}/>)}
   {onRemove&&<div className="rk-block-visual-actions" aria-label="内容操作"><button type="button" className="rk-block-visual-remove" onClick={onRemove}>{math?'删除数学公式':'删除图片'}</button></div>}
  </section>;
 }
 const structure=kind==='richContainer'?structuredChildren[String(node.attrs.kind)]:undefined;
 const children:ProseMirrorNode[]=[];draft.forEach(child=>children.push(child));
 const changeChildren=(change:(children:ProseMirrorNode[],local:EditorView)=>ProseMirrorNode[])=>{
  const local=view.current;if(!local)return;
  const root=local.state.doc.firstChild!;const existing:ProseMirrorNode[]=[];root.forEach(child=>existing.push(child));
  const updated=root.copy(Fragment.fromArray(change(existing,local)));
  local.dispatch(local.state.tr.replaceWith(0,root.nodeSize,updated));
 };
 return <section className="rk-block-visual-fields" aria-label="可视化正文编辑">
  {kind==='heading'&&<label>标题级别<select aria-label="标题级别" value={String(node.attrs.level??1)} onChange={event=>applyAttribute('level',event.target.value)}>{[1,2,3,4,5,6].map(level=><option key={level} value={level}>{level} 级标题</option>)}</select></label>}
  {kind==='orderedList'&&<NativeField label="起始编号" value={String(node.attrs.start??1)} onChange={value=>applyAttribute('start',value)}/>}
  {structure&&<div className="rk-block-visual-children" aria-label="结构子块">
   {children.map((child,index)=><div className="rk-block-visual-child" key={index}>
    <label>{structure.label} {index+1}<input aria-label={`${structure.label} ${index+1} 标题`} value={String(child.attrs.title??'')} onChange={event=>{
     const title=event.target.value.replace(/[\r\n]/g,' ').slice(0,180);
     changeChildren(items=>items.map((item,i)=>i===index?item.type.create({...item.attrs,title},item.content,item.marks):item));
    }}/></label>
    {child.attrs.kind==='message'&&<label>消息身份<select aria-label={`消息 ${index+1} 身份`} value={String(child.attrs.sender??'assistant')} onChange={event=>changeChildren(items=>items.map((item,i)=>i===index?item.type.create({...item.attrs,sender:event.target.value},item.content,item.marks):item))}>{['assistant','user','system'].map(sender=><option key={sender}>{sender}</option>)}</select></label>}
    <div className="rk-block-visual-toolbar">
     <button type="button" onClick={()=>{const local=view.current;if(!local)return;let offset=2;for(let i=0;i<index;i++)offset+=children[i]!.nodeSize;local.dispatch(local.state.tr.setSelection(TextSelection.near(local.state.doc.resolve(offset))));local.focus();}}>编辑正文</button>
     {node.attrs.kind!=='flashcard'&&<>
      <button type="button" aria-label={`${structure.label} ${index+1} 上移`} disabled={index===0} onClick={()=>changeChildren(items=>{[items[index-1],items[index]]=[items[index]!,items[index-1]!];return items;})}>上移</button>
      <button type="button" aria-label={`${structure.label} ${index+1} 下移`} disabled={index===children.length-1} onClick={()=>changeChildren(items=>{[items[index],items[index+1]]=[items[index+1]!,items[index]!];return items;})}>下移</button>
      <button type="button" aria-label={`删除${structure.label} ${index+1}`} disabled={children.length<=1} onClick={()=>changeChildren(items=>items.filter((_,i)=>i!==index))}>删除</button>
     </>}
    </div>
   </div>)}
   {node.attrs.kind!=='flashcard'&&<button type="button" onClick={()=>changeChildren((items,local)=>[...items,local.state.schema.nodes.richContainer!.create({kind:structure.kind,title:structure.title,...(structure.kind==='message'?{sender:'assistant'}:{})},local.state.schema.nodes.paragraph!.create())])}>添加{structure.label}</button>}
  </div>}
  {kind!=='rawMarkdown'&&<div className="rk-block-visual-toolbar" role="toolbar" aria-label="正文格式"><span>正文</span>
   {visualMarks.filter(([name])=>editor.state.schema.marks[name]).map(([name,label])=><button key={name} type="button" aria-label={label} aria-pressed={activeMarks.includes(name)} title={label} onMouseDown={event=>event.preventDefault()} onClick={()=>{const local=view.current;if(local){toggleMark(local.state.schema.marks[name]!)(local.state,local.dispatch,local);local.focus();}}}>{label}</button>)}
  </div>}
  {kind==='table'&&<div className="rk-block-visual-toolbar" role="toolbar" aria-label="表格操作">{([['添加行',addRowAfter],['删除行',deleteRow],['添加列',addColumnAfter],['删除列',deleteColumn]] as const).map(([label,command])=><button key={label} type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>{const local=view.current;if(local){command(local.state,local.dispatch);local.focus();}}}>{label}</button>)}</div>}
  <div ref={host} className="rk-block-visual-surface record-main"/>
  {error&&<p role="alert" className="rk-block-panel-error">{error}</p>}
 </section>;
}
