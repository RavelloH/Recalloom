import {useState} from 'react';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Button} from '@astryxdesign/core/Button';
import {ActivityEntry} from '../activity-entry';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {Icon} from '../icon';
import {eventDescription,type ActivityEvent,type ActivityGroup} from './data';

function ActivityGroupRow({group,onOpen}:{group:ActivityGroup;onOpen:(event:ActivityEvent)=>void}){
 const [expanded,setExpanded]=useState(false),first=group.events[0],last=group.events.at(-1)!,multiple=group.events.length>1;
 return <div className="activity-group" data-activity-group={group.key}>
  <ClickableCard className="activity-event-card" padding={0} variant="transparent" label={'查看活动详情：'+(first.resourceName??'资源')} onClick={()=>onOpen(first)}>
   <ActivityEntry item={first} description={multiple?'连续修改 '+group.events.length+' 次':eventDescription(first)}
    revisionLabel={multiple&&last.revision!=null&&first.revision!=null?'R'+Math.max(1,last.revision-1)+' → R'+first.revision:undefined}/>
  </ClickableCard>
  {multiple&&<div className="activity-group-toggle"><Button size="sm" variant="ghost" label={expanded?'收起修改记录':'展开 '+group.events.length+' 条修改记录'} aria-expanded={expanded} icon={<span className="activity-disclosure" data-expanded={expanded}><Icon name="chevronRight" size="sm"/></span>} onClick={()=>setExpanded(value=>!value)}/></div>}
  <AutoResizer><AutoTransition transitionKey={expanded?'expanded':'collapsed'}>{expanded?<div className="activity-group-events">{group.events.map(event=><ClickableCard key={event.seq} variant="transparent" padding={0} className="activity-event-card" label={'查看修改详情：'+eventDescription(event)} onClick={()=>onOpen(event)}><ActivityEntry item={event} description={eventDescription(event)}/></ClickableCard>)}</div>:null}</AutoTransition></AutoResizer>
 </div>;
}
export function ActivityTimeline({groups,onOpen}:{groups:ActivityGroup[];onOpen:(event:ActivityEvent)=>void}){
 const byDate=new Map<string,ActivityGroup[]>();for(const group of groups){const list=byDate.get(group.day)??[];list.push(group);byDate.set(group.day,list);}
 return <div className="activity-timeline">{[...byDate].map(([day,items])=><section key={day} className="activity-date-section" aria-label={day+'的活动'}>
  <div className="activity-date-heading"><h3>{new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'short'}).format(new Date(day+'T12:00:00'))}</h3><span className="muted tiny">{items.reduce((sum,item)=>sum+item.events.length,0)} 条记录</span></div>
  {items.map(group=><ActivityGroupRow key={group.key} group={group} onOpen={onOpen}/>)}</section>)}</div>;
}
