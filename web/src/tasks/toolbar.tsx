import React from 'react';
import {Button} from '@astryxdesign/core/Button';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {Token} from '@astryxdesign/core/Token';
import {Icon} from '../icon';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {InlineTitle} from '../page-chrome';
import {ago} from '../pages/shared';
import {sharedViewTransitionName} from '../shared-view-transition';
import type {RecordDetail} from '../types';

export type TaskView='board'|'list';

export function TasksViewSwitcher({view,onChange}:{view:TaskView;onChange:(view:TaskView)=>void}){
 return <ButtonGroup className="tasks-view-switch" label="任务视图" size="sm">
  <Button label="看板" variant={view==='board'?'secondary':'ghost'} aria-pressed={view==='board'} icon={<Icon name="taskBoard" size="sm"/>} onClick={()=>onChange('board')}/>
  <Button label="列表" variant={view==='list'?'secondary':'ghost'} aria-pressed={view==='list'} icon={<Icon name="list" size="sm"/>} onClick={()=>onChange('list')}/>
 </ButtonGroup>;
}

export function TasksResultCount({pending,total}:{pending:boolean;total:number}){
 const key=pending?'pending':'ready:'+total;
 return <AutoResizer animateWidth animateHeight={false} className="tasks-result-count-resizer">
  <span className="tasks-result-count-stack"><AutoTransition as="span" mode="sync" className="tasks-result-count-transition" transitionKey={key} duration={.14}>
    <span className="tasks-result-count" role="status">{pending?'…':total+' 项'}</span>
   </AutoTransition></span>
 </AutoResizer>;
}

export function TasksStateTransition({stateKey,children,className=''}:{stateKey:string;children:React.ReactNode;className?:string}){
 return <AutoResizer className={('tasks-state-resizer '+className).trim()}>
  <AutoTransition transitionKey={stateKey} className="tasks-state-transition" duration={.16}>{children}</AutoTransition>
 </AutoResizer>;
}

export function TasksContentTransition({transitionKey,children}:{transitionKey:string;children:React.ReactNode}){
 return <AutoTransition transitionKey={transitionKey} className="tasks-content-transition" duration={.16}>{children}</AutoTransition>;
}

export function TaskListWorkbenchHeader({item,focusTitle,onRename,onDetails,detailsOpen}:{
 item:RecordDetail;
 focusTitle:boolean;
 onRename:(name:string)=>Promise<void>;
 onDetails:()=>void;
 detailsOpen:boolean;
}){
 const sharedName=sharedViewTransitionName('record',item.id);
 const tags=item.tags??[];
 const tagsKey=tags.map(name=>name+':'+(item.tagDetails?.find(tag=>tag.name===name)?.source??'manual')).join('\u0000')||'none';
 return <header className="doc-header workbench-header task-list-workbench-header">
  <div className="workbench-identity">
   <span className="workbench-document-kind"><Icon name="taskList" size="sm" aria-hidden="true"/> 任务列表</span>
   <span className="workbench-revision" title={'当前内容版本 R'+item.revision}>R{item.revision}</span>
  </div>
  <InlineTitle value={item.name} onRename={onRename} autoFocus={focusTitle} transitionName={sharedName} transitionResource={{kind:'record',id:item.id}}/>
  <AutoResizer className="workbench-tag-resizer">
   <AutoTransition transitionKey={tagsKey} className="workbench-tag-transition" duration={.14}>
    {tags.length>0?<div className="workbench-tag-line" aria-label="任务列表标签">
     {tags.map(name=>{const tag=item.tagDetails?.find(tag=>tag.name===name);return <Token className="workbench-summary-tag" key={name} label={name} size="sm" color={tag?.color??'gray'} icon={tag?.source==='auto'?<Icon name="sparkles" size="sm"/>:undefined} description={tag?.reason} href={tag?'/tags/'+tag.id:undefined}/>;})}
    </div>:null}
   </AutoTransition>
  </AutoResizer>
  <div className="workbench-summary">
   <div className="workbench-summary-details">
    <AutoTransition as="span" transitionKey={item.updatedAt??'unknown'} duration={.14}>
     <time dateTime={item.updatedAt} title={item.updatedAt}>更新于 {ago(item.updatedAt)||'刚刚'}</time>
    </AutoTransition>
   </div>
   <Button label="详细信息" size="sm" variant="ghost" className="workbench-details-trigger" onClick={onDetails}
    aria-controls="task-list-panel-info" aria-expanded={detailsOpen}
    endContent={<Icon name="chevronRight" size="sm" aria-hidden="true"/>}/>
  </div>
 </header>;
}
