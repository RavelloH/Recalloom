import React,{useEffect,useRef,useState} from 'react';
import CodeBlockShiki from 'tiptap-extension-code-block-shiki';
import {optimizeShikiPlugins} from './shiki-transaction';
import {TableView} from '@tiptap/extension-table';
import type {Node as PMNode} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {ReactNodeViewRenderer,NodeViewWrapper,NodeViewContent,type NodeViewProps} from '@tiptap/react';
import {IconButton} from '@astryxdesign/core/IconButton';
import {TextInput} from '@astryxdesign/core/TextInput';
import {IconCopy,IconTextWrap,IconFileCode2,IconPencil,IconChevronDown,IconChevronUp} from '@tabler/icons-react';
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
 constructor(node:PMNode,cellMinWidth:number,view:EditorView,attrs:Record<string,unknown>={}){
  super(node,cellMinWidth,view,attrs);
  this.captionElement=document.createElement('div');
  this.captionElement.className='rk-table-caption';
  this.captionElement.contentEditable='false';
  this.dom.appendChild(this.captionElement);
  this.paint(node);
 }
 private paint(node:PMNode){
  const id=safeTableId(node.attrs.tableId)?node.attrs.tableId as string:null;
  const caption=cleanTableCaption(node.attrs.caption);
  if(id){
   this.dom.id=headingAnchor(id);
   this.dom.dataset.rkTableId=id;
  }else{this.dom.removeAttribute('id');delete this.dom.dataset.rkTableId;}
  this.captionElement.hidden=!id||!caption;
  this.captionElement.textContent=caption;
 }
 update(node:PMNode):boolean{
  if(!super.update(node))return false;
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
 const saveTitle=()=>{updateAttributes({filename:filename.replace(/[\r\n\]]/g,' ').slice(0,240)});setEditing(false);};
 return <NodeViewWrapper ref={host} id={typeof node.attrs.id==='string'&&isRmdId(node.attrs.id)?headingAnchor(node.attrs.id):undefined} className={'code-block rk-code-block'+(node.attrs.wrap?' rk-code-wrap':'')+(fold?' rk-code-folded':'')} data-rk-code="true">
  <div className="rk-code-header" contentEditable={false}>
   <div className="rk-code-title">
    <IconFileCode2 size="var(--rk-icon-sm)" aria-hidden="true"/>
    {editing?<TextInput label="代码文件名" value={filename} onChange={setFilename} hasAutoFocus
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();saveTitle();}else if(e.key==='Escape')setEditing(false);}}
      onBlur={saveTitle}/>
     :<><span>{String(node.attrs.filename||node.attrs.language||'Text')}</span>
       <IconButton label="修改代码文件名" variant="ghost" size="sm" icon={<IconPencil size="var(--rk-icon-sm)"/>}
         onClick={()=>{setFilename(String(node.attrs.filename??''));setEditing(true);}}/></>}
   </div>
   <div className="rk-code-actions">
    <IconButton label={node.attrs.wrap?'关闭自动换行':'开启自动换行'} variant="ghost" size="sm"
      icon={<IconTextWrap size="var(--rk-icon-sm)"/>} onClick={()=>updateAttributes({wrap:!node.attrs.wrap})}/>
    <IconButton label="复制代码" variant="ghost" size="sm" icon={<IconCopy size="var(--rk-icon-sm)"/>}
      onClick={()=>{if(typeof navigator!=='undefined'&&navigator.clipboard)void navigator.clipboard.writeText(node.textContent);}}/>
   </div>
  </div>
  <div className="rk-code-viewport rk-scroll-viewport" data-axis="x">
   <pre><NodeViewContent as={"code" as "div"}/></pre>
  </div>
  {String(node.attrs.language).toLowerCase()==='mermaid'&&<MermaidDiagram code={node.textContent}/>}
  {lines>20&&!node.attrs.expand&&<div className="rk-code-fold-button" contentEditable={false}>
    <IconButton label={fold?'展开全部代码':'收起长代码'} variant="ghost" size="sm"
      icon={fold?<IconChevronDown size="var(--rk-icon-sm)"/>:<IconChevronUp size="var(--rk-icon-sm)"/>} onClick={()=>setExpanded(!expanded)}/>
   </div>}
 </NodeViewWrapper>;
};
export const ScrollCodeBlock=CodeBlockShiki.extend({
 addProseMirrorPlugins(){return optimizeShikiPlugins(this.parent?.()??[]);},
 addAttributes(){return {...this.parent?.(),id:{default:null},filename:{default:''},wrap:{default:false},expand:{default:false}};},
 addNodeView(){return ReactNodeViewRenderer(CodeView);}
});
