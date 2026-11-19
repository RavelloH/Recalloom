import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon,type IconName} from '../icon';
import {ago,fmt} from '../pages/shared';
import {feedReadLabel,feedSourceLabel,isFeedSnoozed} from './presentation';
import type {FeedItem,FeedStateInput} from '../../../src/feed-model';

export const feedKindLabels:Record<FeedItem['kind'],string>={
 news:'资讯',release:'版本发布',insight:'Agent 发现',alert:'重要提醒',digest:'精选摘要'
};
export const feedKindIcons:Record<FeedItem['kind'],IconName>={
 news:'feed',release:'tool',insight:'sparkles',alert:'warning',digest:'list'
};

export function FeedCard({item,view,busy,onOpen,onAction}:{
 item:FeedItem;view:string;busy:boolean;onOpen:()=>void;onAction:(input:FeedStateInput)=>void
}){
 const unread=feedReadLabel(item),snoozed=isFeedSnoozed(item.state);
 const saved=Boolean(item.state.savedAt);
 const identity=item.agentName||item.sourcePublisher||'Agent 推送';
 const sources=[feedKindLabels[item.kind],item.sourcePublisher!==identity?item.sourcePublisher:null,
  item.primaryUrl?feedSourceLabel(item.primaryUrl):null,item.sourceCount>1?item.sourceCount+' 份投稿':null].filter(Boolean).join(' · ');
 return <article className="feed-story" data-kind={item.kind} data-unread={Boolean(unread)||undefined} data-feed-id={item.id}>
  <div className="feed-story-meta">
   <span className="feed-story-symbol"><Icon name={feedKindIcons[item.kind]} size="md"/></span>
   <div className="feed-story-origin">
    <div className="feed-story-kind">{identity}</div>
    <div className="feed-story-source" title={sources}>{sources}</div>
   </div>
   <time className="feed-story-time" dateTime={item.firstSeenAt} title={fmt(item.firstSeenAt)}>{ago(item.firstSeenAt)}</time>
  </div>
  <h3 className="feed-story-title"><Button label={item.title} size="sm" variant="ghost" className="feed-story-open" onClick={onOpen}/></h3>
  <p className="feed-story-summary">{item.summary}</p>
  {item.whyRelevant&&<div className="feed-story-reason"><Icon name="sparkles" size="sm"/><span>{item.whyRelevant}</span></div>}
  <div className="feed-story-footer">
   <div className="feed-story-reading">
    <Button label="阅读详情" icon={<Icon name="arrowRight" size="sm"/>} size="sm" variant="ghost" onClick={onOpen}/>
    {item.primaryUrl&&<a className="feed-story-external" href={item.primaryUrl} target="_blank" rel="noopener noreferrer">
     原文 <Icon name="externalLink" size="sm"/>
    </a>}
    {unread&&<span className="feed-story-unread"><span className="feed-story-unread-dot"/>{unread}</span>}
   </div>
   <div className="feed-story-actions">
    <IconButton label={saved?'取消收藏':'收藏动态'} size="sm" variant={saved?'secondary':'ghost'}
     icon={<Icon name="bookmark" size="sm" fill={saved?'currentColor':'none'}/>} isDisabled={busy}
     onClick={()=>onAction({action:saved?'unsave':'save'})}/>
    <IconButton label={snoozed?'取消稍后阅读':'24 小时后再看'} size="sm" variant={snoozed?'secondary':'ghost'}
     icon={<Icon name="clock" size="sm"/>} isDisabled={busy}
     onClick={()=>onAction(snoozed?{action:'unsnooze'}:{action:'snooze',until:new Date(Date.now()+86400000).toISOString()})}/>
    <IconButton label={view==='dismissed'?'恢复动态':'忽略动态'} size="sm" variant="ghost"
     icon={<Icon name={view==='dismissed'?'restore':'eyeOff'} size="sm"/>} isDisabled={busy}
     onClick={()=>onAction({action:view==='dismissed'?'restore':'dismiss'})}/>
   </div>
  </div>
 </article>;
}
