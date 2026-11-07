import React,{useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import type {JSONContent} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {Card} from '@astryxdesign/core/Card';
import {MetadataList,MetadataListItem} from '@astryxdesign/core/MetadataList';
import {TextArea} from '@astryxdesign/core/TextArea';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Pencil,Check,X,FileCog} from 'lucide-react';
import {frontMatterEntries} from './frontmatter-utils';

export function FrontMatterCard({source}:{source:string}){
 const {entries,error}=frontMatterEntries(source);
 return <Card variant="muted" padding={3} className="rk-frontmatter-card">
  <div className="rk-frontmatter-heading"><FileCog size={16} aria-hidden="true"/> 文档 Front Matter</div>
  {error?<div className="rk-frontmatter-error">{error}</div>
   :<MetadataList columns="single" maxNumOfItems={10}>
     {entries.map(({key,value})=><MetadataListItem key={key} label={key}>{value}</MetadataListItem>)}
    </MetadataList>}
  <div className="rk-frontmatter-caption">仅保留在 Markdown 中；不会自动覆盖 Recalloom 的独立文件属性。</div>
 </Card>;
}
function FrontMatterEditor({node,updateAttributes}:NodeViewProps){
 const raw=String(node.attrs.source??'');
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState(raw);
 const save=()=>{updateAttributes({source:draft.replace(/\r\n/g,'\n')});setEditing(false);};
 return <NodeViewWrapper contentEditable={false} className="rk-frontmatter-node" data-rk-frontmatter="">
  <div className="rk-frontmatter-controls">
   {!editing?<IconButton label="编辑 YAML Front Matter" size="sm" variant="ghost" icon={<Pencil size={16}/>} onClick={()=>{setDraft(raw);setEditing(true);}}/>
    :<>
      <IconButton label="保存 Front Matter 修改" size="sm" variant="ghost" icon={<Check size={16}/>} onClick={save}/>
      <IconButton label="放弃 Front Matter 修改" size="sm" variant="ghost" icon={<X size={16}/>} onClick={()=>{setDraft(raw);setEditing(false);}}/>
     </>}
  </div>
  {editing?<TextArea label="YAML 源码" value={draft} onChange={setDraft} rows={Math.min(15,Math.max(6,draft.split('\n').length))}/>
   :<FrontMatterCard source={raw}/>}
 </NodeViewWrapper>;
}
export const RichFrontMatter=Node.create({
 name:'richFrontMatter',group:'block',atom:true,defining:true,selectable:true,priority:140,
 addAttributes(){return {source:{default:''}};},
 parseHTML(){return [{tag:'div[data-rk-frontmatter]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-rk-frontmatter':''})];},
 addNodeView(){return ReactNodeViewRenderer(FrontMatterEditor);},
 renderMarkdown(node:JSONContent){return String(node.attrs?.source??'');}
});
