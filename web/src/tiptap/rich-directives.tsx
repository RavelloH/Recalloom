import React,{useRef,useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {ReactNodeViewRenderer,NodeViewContent,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {Banner} from '@astryxdesign/core/Banner';
import {Badge} from '@astryxdesign/core/Badge';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Card} from '@astryxdesign/core/Card';
import {Button} from '@astryxdesign/core/Button';
import {TabList,Tab} from '@astryxdesign/core/TabList';
import {RmdChatMessage,RmdChatTranscript} from '../rmd-chat';
import {isSketchKind} from '../sketch-geometry';
import {IconEye,IconEyeOff} from '@tabler/icons-react';
import {richTitle} from './rich-schema';
import {isRmdId} from '../rmd-schema';
import {headingAnchor} from '../wiki-slug';
import {calloutIcon} from '../callout-icon';
import {asAstryBadgeVariant} from '../rmd-badge';
export {richTitle} from './rich-schema';

const bannerStatus=(kind:string):'info'|'warning'|'error'|'success'=>
 kind==='warning'?'warning':kind==='danger'?'error':kind==='success'?'success':'info';
const safeTitle=(v:string)=>v.replace(/[\r\n]/g,' ').slice(0,180);
const calloutKinds=new Set(['note','info','tip','success','warning','danger','example','question']);

function ContainerView({node,updateAttributes}:NodeViewProps){
 const kind=String(node.attrs.kind??'note'),title=String(node.attrs.title??'');
 const color=String(node.attrs.color??'');
 const sketchKind=isSketchKind(kind);
 const mathOnly=node.childCount===1&&node.firstChild?.type.name==='blockMath';
 const sender=node.attrs.sender==='user'?'user':node.attrs.sender==='system'?'system':'assistant';
 const tabs=node.content?.content.filter(child=>child.type.name==='richContainer'&&child.attrs.kind==='tab')??[];
 const [selected,setSelected]=useState('0');
 const [flashcardOpen,setFlashcardOpen]=useState(false);
 const activeTab=Math.min(Math.max(0,Number(selected)||0),Math.max(0,tabs.length-1));
 // The title is the editing surface itself. Never replace it with a text input
 // (which changes its dimensions and breaks the click-to-caret experience).
 const titleElement=useRef<HTMLSpanElement|null>(null);
 const titleEditing=useRef(false);
 const titleAtFocus=useRef('');
 const finishTitleEdit=(save:boolean)=>{
  if(!titleEditing.current)return;
  titleEditing.current=false;
  const element=titleElement.current;
  const displayed=richTitle(kind,title);
  const next=safeTitle(element?.textContent??'');
  // A Callout with no explicit title renders a default title (e.g. "警告").
  // That default IS visible text, not a placeholder to erase on focus.
  // Clicking and blurring without editing must not write it back as an attr.
  if(!save){if(element)element.textContent=displayed;return;}
  if(next===titleAtFocus.current)return;
  if(next!==title)updateAttributes({title:next});
  if(element&&!next)element.textContent=richTitle(kind,'');
 };
 // Use the rendered title itself as the editing surface. There is no
 // separate input, floating field, or additional editor wrapper to resize it.
 // This inert outer span prevents ProseMirror from trying to parse title
 // keystrokes as changes to its separate NodeView contentDOM. It is not an
 // input and has no form styling: the inner text remains directly editable.
 const editTitle=<span className="rk-directive-title" contentEditable={false}>
 <span ref={titleElement} className="rk-directive-title-hit" contentEditable
  suppressContentEditableWarning role="textbox" tabIndex={0}
  aria-label="容器标题" aria-multiline={false} spellCheck
  title="直接在标题文字上编辑；Enter 确认、Esc 取消"
  onPointerDown={event=>event.stopPropagation()}
  onClick={event=>event.stopPropagation()}
  onFocus={event=>{
   titleEditing.current=true;
   titleAtFocus.current=event.currentTarget.textContent??'';
  }}
  onBlur={()=>finishTitleEdit(true)}
  onKeyDown={event=>{
   event.stopPropagation();
   if(event.nativeEvent.isComposing)return;
   if(event.key==='Enter'){event.preventDefault();finishTitleEdit(true);event.currentTarget.blur();}
   else if(event.key==='Escape'){event.preventDefault();finishTitleEdit(false);event.currentTarget.blur();}
  }}>{richTitle(kind,title)}</span>
 </span>;
 const stableId=typeof node.attrs.id==='string'&&isRmdId(node.attrs.id)?headingAnchor(node.attrs.id):undefined;
 return <NodeViewWrapper id={stableId} className={'rk-directive rk-directive-'+kind+(calloutKinds.has(kind)?' rk-rmd-callout':'')+(sketchKind?' rk-directive-sketch':'')} data-rk-kind={kind}>
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
        icon={flashcardOpen?<IconEyeOff size="var(--rk-icon-sm)" aria-hidden="true"/>:<IconEye size="var(--rk-icon-sm)" aria-hidden="true"/>}
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
   ?<RmdChatTranscript title={title} titleNode={editTitle}><NodeViewContent className="rk-directive-body rk-chat-list"/></RmdChatTranscript>
   :kind==='message'
   ?<RmdChatMessage sender={sender} name={editTitle}><NodeViewContent className="rk-directive-body rk-chat-message"/></RmdChatMessage>
   :kind==='details'
   ?<Collapsible trigger={editTitle} defaultIsOpen><NodeViewContent className="rk-directive-body"/></Collapsible>
   :sketchKind
   ?<section className="rk-sketch-block" data-rk-sketch-kind={kind}
     data-rk-sketch-color={color||undefined}
     data-rk-sketch-stroke={node.attrs.stroke??undefined}
     data-rk-sketch-padding={node.attrs.padding??undefined}
     data-rk-sketch-roughness={node.attrs.roughness??undefined}
     data-rk-sketch-opacity={node.attrs.opacity??undefined}
     data-rk-sketch-math-only={mathOnly?'true':undefined}>
     <NodeViewContent className="rk-directive-body rk-sketch-content"/>
    </section>
   :kind==='mark'
   ?<section className={'rk-rmd-block-mark'+(mathOnly?' rk-rmd-mark-math-only':'')}>
     <NodeViewContent className="rk-directive-body"/>
    </section>
   :kind==='comment'
   ?<section className="rk-rmd-comment-block"><NodeViewContent className="rk-directive-body"/></section>
   :<Banner status={bannerStatus(kind)} icon={calloutIcon(kind)} title={editTitle} collapsible={false} container="card">
      <NodeViewContent className="rk-directive-body"/>
     </Banner>}
 </NodeViewWrapper>;
}
export const RichContainer=Node.create({
 name:'richContainer',group:'block',content:'block+',defining:true,isolating:true,priority:67,
 addAttributes(){return {kind:{default:'note'},title:{default:''},id:{default:null},sender:{default:null},color:{default:null},stroke:{default:null},padding:{default:null},roughness:{default:null},opacity:{default:null}};},
 parseHTML(){return [{tag:'div[data-rk-kind]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-rk-kind':HTMLAttributes.kind}),0];},
 addNodeView(){return ReactNodeViewRenderer(ContainerView);}
});

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
  const variant=asAstryBadgeVariant(attrs.variant);
  return <NodeViewWrapper as="span" className="rk-rich-inline rk-inline-badge"><Badge label={inner} variant={variant}/></NodeViewWrapper>;
 }
 const description=kind==='richAbbr'?attrs.title:attrs.content;
 // Editable ProseMirror NodeViews must not mount a stateful Tooltip trigger:
 // Astryx Tooltip can update its DOM attributes on mount, which Tiptap
 // incorrectly observes as a content edit. A CSS pseudo tooltip is inert.
 return <NodeViewWrapper as="span" className={'rk-rich-inline '+(kind==='richAbbr'?'rk-inline-abbr':'rk-inline-tooltip')}>
  <span className="rk-tooltip-inline" tabIndex={0} data-rk-tooltip={description||undefined}
   aria-label={description?'查看解释：'+description:undefined}>{inner}</span>
 </NodeViewWrapper>;
}
function makeInline(kind:'badge'|'abbr'|'tooltip'|'kbd'|'cloze'){
 const name='rich'+kind[0]!.toUpperCase()+kind.slice(1);
 return Node.create({
  name,inline:true,group:'inline',content:'text*',priority:1800,
  addAttributes(){return {variant:{default:'neutral'},title:{default:''},content:{default:''},hint:{default:''}};},
  parseHTML(){return [{tag:'span[data-rk-inline="'+kind+'"]'}];},
  renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-rk-inline':kind}),0];},
  addNodeView(){return ReactNodeViewRenderer(InlineView);}
 });
}
export const RichBadge=makeInline('badge');
export const RichAbbr=makeInline('abbr');
export const RichTooltip=makeInline('tooltip');
export const RichKbd=makeInline('kbd');
export const RichCloze=makeInline('cloze');
