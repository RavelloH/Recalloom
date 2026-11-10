import {Icon} from '../icon';
import React,{useEffect,useRef,useState} from 'react';
import CodeBlockShiki from 'tiptap-extension-code-block-shiki';
import {optimizeShikiPlugins} from './shiki-transaction';
import {TableView} from '@tiptap/extension-table';
import type {Node as PMNode} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {ReactNodeViewRenderer,NodeViewWrapper,NodeViewContent,type NodeViewProps} from '@tiptap/react';
import {IconButton} from '@astryxdesign/core/IconButton';
import {TextInput} from '@astryxdesign/core/TextInput';

import {attachScrollbars} from '../scrollbars';
import {attachLazyCodeScrollbars} from '../code-scrollbars';
import {safeTableId,cleanTableCaption} from '../table-caption';
import {headingAnchor} from '../wiki-slug';
import {isRmdId} from '../rmd-schema';
import MermaidDiagram from '../mermaid-diagram';

function scrollFrame(host:HTMLElement,child:HTMLElement){
 host.classList.add('rk-hscroll');
 const viewport=document.createElement('div');
 viewport.className='rk-scroll-viewport';
 viewport.dataset.axis='x';
 host.insertBefore(viewport,child);
 viewport.appendChild(child);
 let detach:(()=>void)|undefined;
 const frame=requestAnimationFrame(()=>{if(host.isConnected)detach=attachScrollbars(host,viewport,'x',{edges:true});});
 return()=>{cancelAnimationFrame(frame);detach?.();};
}
export class ScrollTableView extends TableView{
 private release:()=>void;
 constructor(node:PMNode,cellMinWidth:number,view:EditorView,attrs:Record<string,unknown>={}){
  super(node,cellMinWidth,view,attrs);
  this.release=scrollFrame(this.dom,this.table);
 }
 destroy(){this.release();}
}

/** Keep editable GFM table cells managed exclusively by ProseMirror.
 * A non-editable caption follows the scroll viewport, outside contentDOM.
 * No DOM rewrite inside the table and no editor transaction on load. */
export class CaptionedScrollTableView extends ScrollTableView{
 private readonly captionElement:HTMLDivElement;
 private readonly editorView:EditorView;
 private currentNode:PMNode;
 private captionEditing=false;
 constructor(node:PMNode,cellMinWidth:number,view:EditorView,attrs:Record<string,unknown>={}){
  super(node,cellMinWidth,view,attrs);
  this.editorView=view;
  this.currentNode=node;
  this.captionElement=document.createElement('div');
  this.captionElement.className='rk-table-caption';
  // The caption itself owns the caret; never swap it for an input or touch
  // the table's ProseMirror-managed contentDOM while editing.
  this.captionElement.contentEditable='true';
  this.captionElement.role='textbox';
  this.captionElement.tabIndex=0;
  this.captionElement.title='点击文字原位编辑表格图注';
  this.captionElement.setAttribute('aria-label','直接编辑表格图注');
  this.captionElement.setAttribute('aria-multiline','false');
  this.captionElement.addEventListener('focus',()=>{this.captionEditing=true;});
  this.captionElement.addEventListener('blur',()=>this.finishCaptionEdit(true));
  this.captionElement.addEventListener('pointerdown',event=>event.stopPropagation());
  this.captionElement.addEventListener('click',event=>event.stopPropagation());
  this.captionElement.addEventListener('keydown',event=>{
   event.stopPropagation();
   if(event.isComposing)return;
   if(event.key==='Enter'){event.preventDefault();this.finishCaptionEdit(true);this.captionElement.blur();}
   else if(event.key==='Escape'){event.preventDefault();this.finishCaptionEdit(false);this.captionElement.blur();}
  });
  this.dom.appendChild(this.captionElement);
  this.paint(node);
 }
 private findTablePos():number|null{
  const doc=this.editorView.state.doc;
  try{
   const pos=this.editorView.posAtDOM(this.dom,0);
   if(doc.nodeAt(pos)?.type.name==='table')return pos;
   const resolved=doc.resolve(pos);
   for(let depth=resolved.depth;depth>0;depth--){
    if(resolved.node(depth).type.name==='table')return resolved.before(depth);
   }
  }catch{/* Detached NodeView: do not mutate an unrelated table. */}
  return null;
 }
 private finishCaptionEdit(save:boolean){
  if(!this.captionEditing)return;
  this.captionEditing=false;
  const caption=cleanTableCaption(this.captionElement.textContent);
  const prior=cleanTableCaption(this.currentNode.attrs.caption);
  if(save&&caption!==prior){
   const pos=this.findTablePos();
   const original=pos!==null?this.editorView.state.doc.nodeAt(pos):null;
   if(original?.type.name==='table'){
    try{
     const tr=this.editorView.state.tr.setNodeMarkup(pos!,undefined,{...original.attrs,caption});
     tr.doc.check();
     this.editorView.dispatch(tr);
    }catch{/* Keep the previous caption if the node changed. */}
   }
  }
  this.paint(this.currentNode);
 }
 private paint(node:PMNode){
  const id=safeTableId(node.attrs.tableId)?node.attrs.tableId as string:null;
  const caption=cleanTableCaption(node.attrs.caption);
  if(id){
   this.dom.id=headingAnchor(id);
   this.dom.dataset.rkTableId=id;
  }else{this.dom.removeAttribute('id');delete this.dom.dataset.rkTableId;}
  this.captionElement.hidden=!id||(!caption&&!this.captionEditing);
  if(!this.captionEditing)this.captionElement.textContent=caption;
 }
 update(node:PMNode):boolean{
  if(!super.update(node))return false;
  this.currentNode=node;
  this.paint(node);
  return true;
 }
 ignoreMutation(record:Parameters<TableView['ignoreMutation']>[0]):boolean{
  if(this.captionElement.contains(record.target))return true;
  return super.ignoreMutation(record);
 }
}
const CodeView=({node,updateAttributes}:NodeViewProps)=>{
 const host=useRef<HTMLDivElement>(null);
 const codeScroll=useRef<ReturnType<typeof attachLazyCodeScrollbars>|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [editing,setEditing]=useState(false);
 const [filename,setFilename]=useState(String(node.attrs.filename??''));
 const titleFinished=useRef(false);
 const codeText=node.textContent;
 const lines=codeText.split('\n').length;
 const fold=lines>20&&!node.attrs.expand&&!expanded;
 useEffect(()=>{
  const wrapper=host.current,viewport=wrapper?.querySelector<HTMLElement>('.rk-code-viewport');
  if(!wrapper||!viewport)return;
  const controller=attachLazyCodeScrollbars(wrapper,viewport);
  codeScroll.current=controller;
  return()=>{codeScroll.current=null;controller.dispose();};
 },[]);
 // ProseMirror can change an inline text node's scrollWidth without changing
 // the pre element's border box (and thus without a ResizeObserver event).
 // Recheck after text or wrapping changes while the block is near the viewport.
 useEffect(()=>{codeScroll.current?.check();},[codeText,node.attrs.wrap,expanded]);
 const startTitle=()=>{titleFinished.current=false;setFilename(String(node.attrs.filename??''));setEditing(true);};
 const finishTitle=()=>{
  if(titleFinished.current)return;
  titleFinished.current=true;
  const next=filename.replace(/[\r\n\]]/g,' ').slice(0,240);
  if(next!==String(node.attrs.filename??''))updateAttributes({filename:next});
  setEditing(false);
 };
 const cancelTitle=()=>{titleFinished.current=true;setEditing(false);};
 return <NodeViewWrapper ref={host} id={typeof node.attrs.id==='string'&&isRmdId(node.attrs.id)?headingAnchor(node.attrs.id):undefined} className={'code-block rk-code-block'+(node.attrs.wrap?' rk-code-wrap':'')+(fold?' rk-code-folded':'')} data-rk-code="true">
  <div className="rk-code-header" contentEditable={false}>
   <div className="rk-code-title">
    <Icon name="fileCode2" size="sm" aria-hidden="true"/>
    {editing?<TextInput label="代码文件名" value={filename} onChange={setFilename} hasAutoFocus
      onKeyDown={e=>{
       if(e.nativeEvent.isComposing)return;
       if(e.key==='Enter'){e.preventDefault();e.stopPropagation();finishTitle();}
       else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelTitle();}
      }} onBlur={finishTitle}/>
     :<span className="rk-code-title-hit" role="button" tabIndex={0}
       aria-label="编辑代码文件名" title="点击直接编辑代码文件名"
       onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();startTitle();}}
       onKeyDown={e=>{
        if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();startTitle();}
       }}>{String(node.attrs.filename||node.attrs.language||'Text')}</span>}
   </div>
   <div className="rk-code-actions">
    <IconButton label={node.attrs.wrap?'关闭自动换行':'开启自动换行'} variant="ghost" size="sm"
      icon={<Icon name="textWrap" size="sm"/>} onClick={()=>updateAttributes({wrap:!node.attrs.wrap})}/>
    <IconButton label="复制代码" variant="ghost" size="sm" icon={<Icon name="copy" size="sm"/>}
      onClick={()=>{if(typeof navigator!=='undefined'&&navigator.clipboard)void navigator.clipboard.writeText(node.textContent);}}/>
   </div>
  </div>
  <div className="rk-code-viewport rk-scroll-viewport" data-axis="x">
   <pre><NodeViewContent as={"code" as "div"}/></pre>
  </div>
  {String(node.attrs.language).toLowerCase()==='mermaid'&&<MermaidDiagram code={node.textContent}/>}
  {lines>20&&!node.attrs.expand&&<div className="rk-code-fold-button" contentEditable={false}>
    <IconButton label={fold?'展开全部代码':'收起长代码'} variant="ghost" size="sm"
      icon={fold?<Icon name="chevronDown" size="sm"/>:<Icon name="chevronUp" size="sm"/>} onClick={()=>setExpanded(!expanded)}/>
   </div>}
 </NodeViewWrapper>;
};
export const ScrollCodeBlock=CodeBlockShiki.extend({
 addProseMirrorPlugins(){return optimizeShikiPlugins(this.parent?.()??[]);},
 addAttributes(){return {...this.parent?.(),id:{default:null},filename:{default:''},wrap:{default:false},expand:{default:false}};},
 addNodeView(){return ReactNodeViewRenderer(CodeView);}
});
