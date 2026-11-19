import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon,type IconName} from '../icon';
import {ago,fmt} from '../pages/shared';
import {feedReadLabel,feedSourceLabel} from './presentation';
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
 const unread=feedReadLabel(item),preference=item.state.preference;
 const action=(value:'saved'|'interested'|'not_interested')=>onAction({action:'preference',value:preference===value?'clear':value});
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
   <time className="feed-story-time" dateTime={item.publishedAt??item.firstSeenAt} title={fmt(item.publishedAt??item.firstSeenAt)}>{ago(item.publishedAt??item.firstSeenAt)}</time>
  </div>
  <h3 className="feed-story-title"><Button label={item.title} size="sm" variant="ghost" className="feed-story-open" onClick={onOpen}/></h3>
  <p className="feed-story-summary">{item.summary}</p>
  {item.whyRelevant&&<div className="feed-story-reason"><Icon name="sparkles" size="sm"/><span>{item.whyRelevant}</span></div>}
  <div className="feed-story-footer">
   <div className="feed-story-actions">
    <IconButton label={preference==='saved'?'取消收藏':'收藏'} size="sm" variant={preference==='saved'?'secondary':'ghost'}
     aria-pressed={preference==='saved'} icon={<Icon name="bookmark" size="sm" fill={preference==='saved'?'currentColor':'none'}/>} isDisabled={busy}
     onClick={()=>action('saved')}/>
    <IconButton label={preference==='interested'?'取消感兴趣':'有兴趣'} size="sm" variant={preference==='interested'?'secondary':'ghost'}
     aria-pressed={preference==='interested'} icon={<Icon name="thumbUp" size="sm"/>} isDisabled={busy} onClick={()=>action('interested')}/>
    <IconButton label={preference==='not_interested'?'取消不感兴趣':'没兴趣'} size="sm" variant={preference==='not_interested'?'secondary':'ghost'}
     aria-pressed={preference==='not_interested'} icon={<Icon name="thumbDown" size="sm"/>} isDisabled={busy} onClick={()=>action('not_interested')}/>
   </div>
   <div className="feed-story-reading">
    {unread&&<span className="feed-story-unread"><span className="feed-story-unread-dot"/>{unread}</span>}
    {item.primaryUrl&&<a className="feed-story-external" href={item.primaryUrl} target="_blank" rel="noopener noreferrer">
     原文 <Icon name="externalLink" size="sm"/>
    </a>}
    <Button label="阅读详情" icon={<Icon name="arrowRight" size="sm"/>} size="sm" variant="ghost" onClick={onOpen}/>
   </div>
  </div>
 </article>;
}
