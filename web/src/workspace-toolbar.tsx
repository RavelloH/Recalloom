import type {ReactNode} from 'react';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Icon} from './icon';

/** Shared collection controls. Filters lead on desktop; search leads on narrow screens. */
export function WorkspaceToolbar({filters,search,meta}:{filters:ReactNode;search:ReactNode;meta?:ReactNode}){
 return <div className="workspace-toolbar">
  <div className="workspace-toolbar-filters">{filters}{meta&&<div className="workspace-toolbar-meta">{meta}</div>}</div>
  <div className="workspace-toolbar-search">{search}</div>
 </div>;
}

export function WorkspaceSearch({label,placeholder,value,onChange}:{label:string;placeholder:string;value:string;onChange:(value:string)=>void}){
 return <TextInput label={label} isLabelHidden size="sm" placeholder={placeholder} startIcon={<Icon name="search" size="sm"/>} width="100%" value={value} onChange={onChange}/>;
}
