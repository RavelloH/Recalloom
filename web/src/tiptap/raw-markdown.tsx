import React,{useEffect,useRef,useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {Button} from '@astryxdesign/core/Button';
import {TextArea} from '@astryxdesign/core/TextArea';

/** A lossless atom for Markdown that cannot be represented by rich-text nodes.
 * Text is never interpreted as HTML; users can explicitly edit source in place.
 */
function RawView({node,updateAttributes,selected}:NodeViewProps){
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState(String(node.attrs.source??''));
 const editBaseline=useRef(String(node.attrs.source??''));
 useEffect(()=>{if(!editing)setDraft(String(node.attrs.source??''));},[node.attrs.source,editing]);
 const save=()=>setEditing(false);
 const cancel=()=>{updateAttributes({source:editBaseline.current});setDraft(editBaseline.current);setEditing(false);};
 return <NodeViewWrapper className={'raw-markdown-node'+(selected?' is-selected':'')} contentEditable={false}>
  <div className="raw-markdown-caption"><span>原始 Markdown · 保留语法</span>
   {editing?<div className="raw-markdown-actions"><Button label="取消" size="sm" variant="secondary" onClick={cancel}/><Button label="应用源码" size="sm" variant="primary" onClick={save}/></div>
   :<Button label="编辑此段源码" size="sm" variant="secondary" onClick={()=>{editBaseline.current=String(node.attrs.source??'');setEditing(true);}}/>}
  </div>
  {editing?<div className="raw-markdown-field" onKeyDown={event=>event.stopPropagation()}><TextArea label="编辑原始 Markdown" isLabelHidden width="100%" size="sm" value={draft} hasSpellCheck={false} rows={Math.min(18,Math.max(4,draft.split('\n').length+1))} onChange={value=>{setDraft(value);updateAttributes({source:value});}}/></div>
   :<pre className="raw-markdown-content">{String(node.attrs.source??'')}</pre>}
 </NodeViewWrapper>;
}
export const RawMarkdown=Node.create({
 name:'rawMarkdown',
 group:'block',
 atom:true,
 selectable:true,
 draggable:false,
 addAttributes(){return{source:{default:'',rendered:false}};},
 parseHTML(){return[{tag:'div[data-raw-markdown]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-raw-markdown':''})];},
 addNodeView(){return ReactNodeViewRenderer(RawView);},
 renderMarkdown(node){return String(node.attrs?.source??'');}
});
