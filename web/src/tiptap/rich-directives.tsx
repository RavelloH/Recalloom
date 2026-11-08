import React,{useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewContent,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import type {JSONContent} from '@tiptap/core';
import {Banner} from '@astryxdesign/core/Banner';
import {Badge} from '@astryxdesign/core/Badge';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Card} from '@astryxdesign/core/Card';
import {Button} from '@astryxdesign/core/Button';
import {TabList,Tab} from '@astryxdesign/core/TabList';
import {ChatMessage,ChatMessageBubble,ChatMessageList} from '@astryxdesign/core/Chat';
import {IconButton} from '@astryxdesign/core/IconButton';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Pencil,Eye,EyeOff} from 'lucide-react';
import {richTitle} from './rich-schema';
export {richTitle} from './rich-schema';

const bannerStatus=(kind:string):'info'|'warning'|'error'|'success'=>
 kind==='warning'?'warning':kind==='danger'?'error':kind==='success'?'success':'info';
const safeTitle=(v:string)=>v.replace(/[\r\n\[\]]/g,' ').slice(0,180);

function ContainerView({node,updateAttributes}:NodeViewProps){
 const kind=String(node.attrs.kind??'note'),title=String(node.attrs.title??'');
 const sender=node.attrs.sender==='user'?'user':node.attrs.sender==='system'?'system':'assistant';
 const tabs=node.content?.content.filter(child=>child.type.name==='richContainer'&&child.attrs.kind==='tab')??[];
 const [selected,setSelected]=useState('0');
 const [flashcardOpen,setFlashcardOpen]=useState(false);
 const activeTab=Math.min(Math.max(0,Number(selected)||0),Math.max(0,tabs.length-1));
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState(title);
 const editTitle=<span className="rk-directive-title" contentEditable={false}>
  {editing?<TextInput label="容器标题" value={draft} onChange={setDraft} aria-label="容器标题"
    onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();updateAttributes({title:safeTitle(draft)});setEditing(false);}if(event.key==='Escape')setEditing(false);}}
    onBlur={()=>{updateAttributes({title:safeTitle(draft)});setEditing(false);}}/>
  :<span>{richTitle(kind,title)}</span>}
  {!editing&&<IconButton label="编辑标题" variant="ghost" size="sm" onClick={()=>{setDraft(title);setEditing(true);}} icon={<Pencil size={13}/>}/>}
 </span>;
 return <NodeViewWrapper className={'rk-directive rk-directive-'+kind} data-rk-kind={kind}>
  {kind==='tabs'
   ?<Card variant="default" padding={3} className="rk-tabs-edit" data-rk-active-tab={tabs.length<=32?String(activeTab):undefined}>
      <div className="rk-tabs-heading" contentEditable={false}>{editTitle}</div>
      {tabs.length>0&&<div contentEditable={false}>
       <TabList value={String(activeTab)} onChange={setSelected} hasDivider>
        {tabs.map((tab,index)=><Tab key={index} value={String(index)} label={richTitle('tab',String(tab.attrs.title??''))}/>) }
       </TabList>
      </div>}
      <NodeViewContent className="rk-directive-body rk-tabs-editor-body"/>
     </Card>
   :kind==='tab'
   ?<Card variant="muted" padding={3} className="rk-tab-edit">
      <div className="rk-tab-title" contentEditable={false}>{editTitle}</div>
      <NodeViewContent className="rk-directive-body rk-tab-content"/>
     </Card>
   :kind==='flashcard'
   ?<Card variant="default" padding={3} className="rk-flashcard rk-flashcard-edit" data-rk-answer-open={String(flashcardOpen)}>
      <div contentEditable={false} className="rk-flashcard-heading">
       {editTitle}
       <Button variant="ghost" label={flashcardOpen?"收起答案":"显示答案"}
        icon={flashcardOpen?<EyeOff size={16} aria-hidden="true"/>:<Eye size={16} aria-hidden="true"/>}
        aria-expanded={flashcardOpen}
        onMouseDown={event=>event.preventDefault()}
        onClick={()=>setFlashcardOpen(open=>!open)}/>
      </div>
      {/* Keep ProseMirror's question and answer DOM mounted at all times. */}
      <NodeViewContent className="rk-directive-body rk-flashcard-body"/>
     </Card>
   :kind==='front'||kind==='back'
   ?<Card variant="muted" padding={3} className={'rk-flashcard-panel rk-flashcard-'+kind}>
      <div contentEditable={false} className="rk-flashcard-panel-title">{editTitle}</div>
      <NodeViewContent className="rk-directive-body rk-flashcard-content"/>
     </Card>
   :kind==='glossary'
   ?<Card variant="muted" padding={3} className="rk-glossary-edit">
      <div className="rk-glossary-title" contentEditable={false}>{editTitle}</div>
      <NodeViewContent className="rk-directive-body rk-glossary-entries"/>
     </Card>
   :kind==='definition'
   ?<div className="rk-definition-edit">
      <div className="rk-definition-term" contentEditable={false}>{editTitle}</div>
      <NodeViewContent className="rk-directive-body rk-definition-body"/>
     </div>
   :kind==='chat'
   ?<ChatMessageList density="compact" align="top"><NodeViewContent className="rk-directive-body rk-chat-list"/></ChatMessageList>
   :kind==='message'
   ?<ChatMessage sender={sender}><ChatMessageBubble name={editTitle}><NodeViewContent className="rk-directive-body rk-chat-message"/></ChatMessageBubble></ChatMessage>
   :kind==='details'
   ?<Collapsible trigger={editTitle} defaultIsOpen><NodeViewContent className="rk-directive-body"/></Collapsible>
   :<Banner status={bannerStatus(kind)} title={editTitle} collapsible={false} container="card">
      <NodeViewContent className="rk-directive-body"/>
     </Banner>}
 </NodeViewWrapper>;
}
export const RichContainer=Node.create({
 name:'richContainer',group:'block',content:'block+',defining:true,isolating:true,priority:67,
 addAttributes(){return {kind:{default:'note'},title:{default:''},sender:{default:null}};},
 parseHTML(){return [{tag:'div[data-rk-kind]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-rk-kind':HTMLAttributes.kind}),0];},
 addNodeView(){return ReactNodeViewRenderer(ContainerView);},
 renderMarkdown(node:JSONContent,helpers:{renderChildren:(children:JSONContent[])=>string}){
  const kind=String(node.attrs?.kind??'note'),title=safeTitle(String(node.attrs?.title??''));
  const sender=kind==='message'&&['assistant','user','system'].includes(String(node.attrs?.sender))?'{sender='+String(node.attrs?.sender)+'}':'';
  // Each block must retain its own blank-line boundary. Tiptap's helper
  // concatenates adjacent paragraphs and lists without a separator.
  const body=(node.content??[]).map(child=>helpers.renderChildren([child]).trimEnd()).join('\n\n');
  // CommonMark directive fences must be longer than nested directive fences.
  // In particular, a chat wraps :::message with ::::chat / ::::.
  const colons=(body.match(/^:{3,}(?=[\[{\w\s]|$)/gm)??[]).reduce((max,line)=>Math.max(max,line.length),2)+1;
  const fence=':'.repeat(Math.max(3,colons));
  return fence+kind+(title?'['+title+']':'')+sender+'\n\n'+body+'\n\n'+fence;
 }
});

type RichToken={type?:string;raw?:string;label?:string;attrs?:Record<string,string>};
function readAttrs(value:string):Record<string,string>{
 const attrs:Record<string,string>={};
 for(const match of value.matchAll(/(?:^|\s)([\w-]+)=("[^"]*"|'[^']*'|[^\s]+)/g)){
  const key=match[1]??'',raw=match[2]??'';
  if(key==='title'||key==='variant'||key==='content'||key==='hint')attrs[key]=raw.replace(/^['"]|['"]$/g,'').slice(0,300);
 }
 return attrs;
}
const variants=new Set(['neutral','info','success','warning','error','blue','cyan','green','orange','pink','purple','red','teal','yellow']);
function InlineView({node}:NodeViewProps){
 const kind=node.type.name;
 const attrs=node.attrs as {variant?:string;title?:string;content?:string;hint?:string};
 const [clozeOpen,setClozeOpen]=useState(false);
 const inner=<NodeViewContent as={"span" as "div"} className="rk-inline-editable"/>;
 if(kind==='richCloze')return <NodeViewWrapper as="span" className="rk-rich-inline rk-inline-cloze" data-rk-cloze-open={String(clozeOpen)}>
  <button type="button" className="rk-cloze-trigger" contentEditable={false}
   aria-expanded={clozeOpen} aria-label={clozeOpen?'隐藏挖空答案':'显示挖空答案'}
   title={attrs.hint||'点击揭示答案'}
   onMouseDown={event=>event.preventDefault()}
   onClick={()=>setClozeOpen(open=>!open)}>
   {clozeOpen?'隐藏':attrs.hint||'显示答案'}
  </button>
  {/* Keep the editable answer DOM mounted across reveal/hide. */}
  <NodeViewContent as={"span" as "div"} className="rk-inline-editable rk-cloze-editor-answer"/>
 </NodeViewWrapper>;
 if(kind==='richKbd')return <NodeViewWrapper as="span" className="rk-rich-inline rk-inline-kbd">
  <kbd className="rk-keycap"><NodeViewContent as={"span" as "div"} className="rk-inline-editable"/></kbd>
 </NodeViewWrapper>;
 if(kind==='richBadge'){
  const variant=variants.has(attrs.variant??'')?attrs.variant as 'neutral'|'success'|'warning'|'error'|'info':'neutral';
  return <NodeViewWrapper as="span" className="rk-rich-inline rk-inline-badge"><Badge label={inner} variant={variant}/></NodeViewWrapper>;
 }
 const description=kind==='richAbbr'?attrs.title:attrs.content;
 // Editable ProseMirror NodeViews must not mount a stateful Tooltip trigger:
 // Astryx Tooltip can update its DOM attributes on mount, which Tiptap
 // incorrectly observes as a content edit. A CSS pseudo tooltip is inert.
 return <NodeViewWrapper as="span" className={'rk-rich-inline '+(kind==='richAbbr'?'rk-inline-abbr':'rk-inline-tip')}>
  <span className="rk-tooltip-inline" tabIndex={0} data-rk-tooltip={description||undefined}
   aria-label={description?'查看解释：'+description:undefined}>{inner}</span>
 </NodeViewWrapper>;
}
function makeInline(kind:'badge'|'abbr'|'tip'|'kbd'|'cloze'){
 const name='rich'+kind[0]!.toUpperCase()+kind.slice(1);
 return Node.create({
  name,inline:true,group:'inline',content:'text*',priority:1800,
  addAttributes(){return {variant:{default:'neutral'},title:{default:''},content:{default:''},hint:{default:''}};},
  parseHTML(){return [{tag:'span[data-rk-inline="'+kind+'"]'}];},
  renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-rk-inline':kind}),0];},
  addNodeView(){return ReactNodeViewRenderer(InlineView);},
  parseMarkdown(token:RichToken){
   return {type:name,attrs:token.attrs??{},content:token.label?[{type:'text',text:token.label}]:[]};
  },
  renderMarkdown(node:JSONContent){
   const label=(node.content??[]).map(x=>x.text??'').join('').replace(/[\r\n\]]/g,' ');
   const attrs=node.attrs??{};
   const key=kind==='badge'?'variant':kind==='abbr'?'title':kind==='cloze'?'hint':'content';
   const val=String(attrs[key]??'');
   const clean=kind==='badge'&&val==='neutral'?'':val;
   return ':'+kind+'['+label+']'+(clean?'{'+key+'="'+clean.replace(/"/g,'&quot;')+'"}':'');
  },
  markdownTokenizer:{
   name,level:'inline' as const,
   start:(source:string)=>source.indexOf(':'+kind+'['),
   tokenize:(source:string):RichToken|undefined=>{
    const match=new RegExp('^:'+kind+'\\[([^\\]\\r\\n]+)\\](?:\\{([^}\\r\\n]*)\\})?').exec(source);
    if(!match)return undefined;
    return {type:name,raw:match[0],label:match[1],attrs:readAttrs(match[2]??'')};
   }
  }
 });
}
export const RichBadge=makeInline('badge');
export const RichAbbr=makeInline('abbr');
export const RichTip=makeInline('tip');
export const RichKbd=makeInline('kbd');
export const RichCloze=makeInline('cloze');
