import {memo,type DragEvent} from 'react';
import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {Icon,type IconName} from '../icon';
import {statusLabels,taskStatuses,type TaskItem,type TaskStatus} from './data';

const statusIcons:Record<TaskStatus,IconName>={todo:'taskPending',in_progress:'taskInProgress',blocked:'alertCircle',done:'success',cancelled:'error'};
export function TaskStatusIcon({status}:{status:TaskStatus}){return <span className={'tasks-status-dot tasks-status-'+status}><Icon name={statusIcons[status]} size="sm"/></span>;}
export function TaskStatusControl({item,pending,onStatus}:{item:TaskItem;pending:boolean;onStatus:(item:TaskItem,status:TaskStatus)=>void}){
 return <DropdownMenu presentation="adaptive" items={taskStatuses.map(status=>({label:statusLabels[status],icon:<TaskStatusIcon status={status}/>,endContent:status===item.status?<Icon name="check" size="sm"/>:undefined,onClick:()=>onStatus(item,status)}))}
  renderTrigger={props=><IconButton {...props} className="tasks-status-control" label={'更改状态：'+item.title+'，'+statusLabels[item.status]} variant="ghost" size="sm" isDisabled={pending} icon={<TaskStatusIcon status={item.status}/>}/>}/>;
}
export type TaskItemProps={item:TaskItem;pending:boolean;layout:'card'|'row';onEdit:(item:TaskItem)=>void;onStatus:(item:TaskItem,status:TaskStatus)=>void;onDrag:(item:TaskItem|null)=>void;onDrop:(item:TaskItem)=>void;canDrop:(item:TaskItem)=>boolean};
export const TaskEntry=memo(function TaskEntry({item,pending,layout,onEdit,onStatus,onDrag,onDrop,canDrop}:TaskItemProps){
 const dragStart=(event:DragEvent)=>{
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-recalloom-task',item.id);
  const card=event.currentTarget.closest<HTMLElement>('[data-task-id]');if(card)event.dataTransfer.setDragImage(card,24,20);
  onDrag(item);
 };
 return <article className={layout==='card'?'tasks-card':'tasks-row'} data-task-id={item.id} data-task-status={item.status} data-task-record-id={item.recordId}
  onClick={event=>{if(!(event.target as HTMLElement).closest('button,a'))onEdit(item);}}
  onDragOver={event=>{if(canDrop(item)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}}}
  onDrop={event=>{if(canDrop(item)){event.preventDefault();event.stopPropagation();onDrop(item);}}}>
  <div className="tasks-card-heading">
   <IconButton data-task-drag className="tasks-drag" variant="ghost" size="sm" label={'拖动排序：'+item.title} icon={<Icon name="gripVertical" size="sm"/>} draggable={!pending} isDisabled={pending} onDragStart={dragStart} onDragEnd={()=>onDrag(null)}/>
   <TaskStatusControl item={item} pending={pending} onStatus={onStatus}/>
   <Button data-task-edit className="tasks-card-title" variant="ghost" size="sm" label={item.title} onClick={()=>onEdit(item)}><span className="tasks-card-title-text">{item.title}</span></Button>
  </div>
  {item.details&&<p className={layout==='card'?'tasks-card-details':'tasks-row-details'}>{item.details}</p>}
  {layout==='card'&&<Link data-task-source className="tasks-card-source" to="/records/$recordId" params={{recordId:item.recordId}} title={item.list.path}><Icon name="taskList" size="sm"/><span>{item.list.name}</span></Link>}
 </article>;
});
