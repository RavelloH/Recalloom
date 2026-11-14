import React,{useId,type ReactNode} from 'react';
import {useCollapsible} from '@astryxdesign/core/Collapsible';
import {IconButton} from '@astryxdesign/core/IconButton';
import {useTooltip} from '@astryxdesign/core/Tooltip';
import {Icon} from './icon';
import {richTitle} from './tiptap/rich-schema';

/** The document title and disclosure are siblings: editing never toggles it. */
export function EditableDetails({title,label,children}:{title:ReactNode;label:string;children:ReactNode}){
 const {isOpen,toggle}=useCollapsible({isCollapsible:true});
 const contentId=useId();
 return <div className="rk-details-edit">
  <div className="rk-details-heading" contentEditable={false}>
   <div className="rk-details-title">{title}</div>
   <IconButton className="rk-details-toggle" variant="ghost" size="sm"
    label={(isOpen?'收起 ':'展开 ')+label} aria-expanded={isOpen} aria-controls={contentId}
    icon={<Icon name={isOpen?'chevronUp':'chevronDown'} className="rk-details-chevron"/>}
    onMouseDown={event=>event.preventDefault()} onClick={toggle}/>
  </div>
  {/* Hiding must never unmount ProseMirror's contentDOM or its selection. */}
  <div id={contentId} className="rk-details-content" hidden={!isOpen}>{children}</div>
 </div>;
}

/** Front/back are fixed grammar roles, not user-editable container titles. */
export function FlashcardSideTitle({side}:{side:'front'|'back'}){
 return <div contentEditable={false} className="rk-flashcard-panel-title">{richTitle(side,'')}</div>;
}

/** Inline hook composition avoids Tooltip's block wrapper inside a paragraph. */
export function RmdReadTooltip({kind,description,children}:{kind:'abbr'|'tooltip';description:string;children:ReactNode}){
 const tooltip=useTooltip({placement:'below',alignment:'start',delay:0,focusTrigger:'always',isEnabled:!!description});
 return <>
  <span ref={tooltip.ref} className={'rk-tooltip-inline rk-inline-'+kind}
   tabIndex={description?0:undefined} aria-describedby={description?tooltip.describedBy:undefined}>{children}</span>
  {tooltip.renderTooltip(<span className="rk-read-tooltip-content">{description}</span>)}
 </>;
}
