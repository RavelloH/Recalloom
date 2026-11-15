import {memo} from 'react';
import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {Icon,type IconName} from '../icon';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {statusLabels,taskStatuses,type TaskItem,type TaskStatus} from './data';
import {useTaskDragItem} from './drag';

const statusIcons:Record<TaskStatus,IconName>={todo:'taskPending',in_progress:'taskInProgress',blocked:'alertCircle',done:'success',cancelled:'error'};
export function TaskStatusIcon({status}:{status:TaskStatus}){return <span className={'tasks-status-dot tasks-status-'+status}>
 <AutoTransition as="span" mode="sync" className="tasks-status-icon-transition" transitionKey={status} duration={.12}><Icon name={statusIcons[status]} size="sm"/></AutoTransition>
</span>;}
export function TaskStatusControl({item,pending,onStatus}:{item:TaskItem;pending:boolean;onStatus:(item:TaskItem,status:TaskStatus)=>void}){
 return <DropdownMenu presentation="adaptive" items={taskStatuses.map(status=>({label:statusLabels[status],icon:<TaskStatusIcon status={status}/>,endContent:status===item.status?<Icon name="check" size="sm"/>:undefined,onClick:()=>onStatus(item,status)}))}
  renderTrigger={props=><IconButton {...props} className="tasks-status-control" label={'更改状态：'+item.title+'，'+statusLabels[item.status]} variant="ghost" size="sm" isDisabled={pending} icon={<TaskStatusIcon status={item.status}/>}/>}/>;
}
export type TaskItemProps={item:TaskItem;pending:boolean;layout:'card'|'row';onEdit:(item:TaskItem)=>void;onStatus:(item:TaskItem,status:TaskStatus)=>void;onDrag:(item:TaskItem|null)=>void;onDrop:(item:TaskItem)=>Promise<void>;canDrop:(item:TaskItem)=>boolean};
export const TaskEntry=memo(function TaskEntry({item,pending,layout,onEdit,onStatus}:TaskItemProps){
 const drag=useTaskDragItem(item);
 return <article className={(layout==='card'?'tasks-card':'tasks-row')+(drag.activeId===item.id?' is-dragging':'')} data-task-id={item.id} data-task-status={item.status} data-task-record-id={item.recordId}
  onClick={event=>{if(!(event.target as HTMLElement).closest('button,a'))onEdit(item);}}>
  <AutoResizer className="tasks-entry-resizer" duration={.18}>
   <div className="tasks-entry-content">
    <div className="tasks-card-heading">
     <IconButton data-task-drag className="tasks-drag" variant="ghost" size="sm" label={'拖动排序：'+item.title} icon={<Icon name="gripVertical" size="sm"/>}
      draggable={!pending} isDisabled={pending} aria-pressed={drag.activeId===item.id} aria-keyshortcuts="Space Enter ArrowUp ArrowDown ArrowLeft ArrowRight Home End Escape"
      onDragStart={event=>drag.startNative(event,item,layout)} onDragEnd={drag.finishNative}
      onPointerDown={event=>drag.startPointer(event,item,layout)} onKeyDown={event=>drag.handleKey(event,item,layout)}/>
     <TaskStatusControl item={item} pending={pending} onStatus={onStatus}/>
     <Button data-task-edit className="tasks-card-title" variant="ghost" size="sm" label={item.title} onClick={()=>onEdit(item)}><span className="tasks-card-title-text">
      <AutoTransition as="span" mode="sync" className="tasks-card-title-transition" transitionKey={item.title} duration={.14}>{item.title}</AutoTransition>
     </span></Button>
    </div>
    <AutoTransition as="span" className={(layout==='card'?'tasks-card-details':'tasks-row-details')+(item.details?'':' is-empty')}
     transitionKey={item.details??'empty'} duration={.14}>{item.details??null}</AutoTransition>
    {layout==='card'&&<Link data-task-source className="tasks-card-source" to="/records/$recordId" params={{recordId:item.recordId}} title={item.list.path}><Icon name="taskList" size="sm"/><span>{item.list.name}</span></Link>}
   </div>
  </AutoResizer>
 </article>;
});
