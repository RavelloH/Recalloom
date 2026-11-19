import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '../icon';
import {ago,fmt} from '../pages/shared';
import {feedKindIcons,feedKindLabels} from './feed-card';
import {feedReadLabel,isFeedSnoozed} from './presentation';
import type {FeedItem,FeedObservation,FeedRelation,FeedStateInput} from '../../../src/feed-model';

export type FeedDetailItem=FeedItem&{observations:FeedObservation[];relations:FeedRelation[]};

function FeedRelationLink({relation}:{relation:FeedRelation}){
 const label=relation.targetType==='record'?'关联文档':relation.targetType==='task'?'关联任务':
  relation.targetType==='tag'?'关联标签':'智能集合';
 const link=relation.targetType==='record'?<Link to="/records/$recordId" params={{recordId:relation.targetId}}>{label}</Link>:
  relation.targetType==='tag'?<Link to="/tags/$tagId" params={{tagId:relation.targetId}}>{label}</Link>:
  relation.targetType==='collection'?<Link to="/collections/$collectionId" params={{collectionId:relation.targetId}}>{label}</Link>:
  <Link to="/tasks">{label}</Link>;
 return <li className="feed-detail-relation"><Icon name="link" size="sm"/><div>{link}
  {relation.reason&&<p>{relation.reason}</p>}</div></li>;
}

export function FeedDetail({item,busy,onClose,onAction}:{item:FeedDetailItem;busy:boolean;onClose:()=>void;onAction:(input:FeedStateInput)=>void}){
 const saved=Boolean(item.state.savedAt),snoozed=isFeedSnoozed(item.state);
 const unread=feedReadLabel(item);
 return <div className="feed-detail" data-feed-detail={item.id}>
  <div className="feed-detail-top">
   <span className="feed-detail-category"><Icon name={feedKindIcons[item.kind]} size="sm"/>{feedKindLabels[item.kind]}</span>
   <Button label="关闭" variant="ghost" size="sm" icon={<Icon name="x" size="sm"/>} onClick={onClose}/>
  </div>
  <h2>{item.title}</h2>
  <div className="feed-detail-meta">
   <span><Icon name="clock" size="sm"/>收录于 <time dateTime={item.firstSeenAt} title={fmt(item.firstSeenAt)}>{ago(item.firstSeenAt)}</time></span>
   {item.publishedAt&&<span>发布于 <time dateTime={item.publishedAt}>{fmt(item.publishedAt)}</time></span>}
   {item.sourceCount>1&&<span>{item.sourceCount} 份独立投稿</span>}
   {unread&&<span className="feed-detail-unread">{unread}</span>}
  </div>
  <p className="feed-detail-lead">{item.summary}</p>
  {item.whyRelevant&&<aside className="feed-detail-relevance"><div className="feed-detail-section-label"><Icon name="sparkles" size="sm"/> 为什么值得关注</div>
   <p>{item.whyRelevant}</p></aside>}
  <section className="feed-detail-section" aria-label="来源与证据">
   <div className="feed-detail-section-title"><h3>来源与证据</h3><span>{item.observations.length} 份</span></div>
   <ol className="feed-detail-sources">
    {item.observations.map(observation=><li key={observation.id} className="feed-detail-source">
     <div className="feed-detail-source-head">
      <span className="feed-detail-source-icon"><Icon name={observation.sourceKind==='github'?'code':observation.sourceKind==='paper'?'document':observation.sourceKind==='internal'?'sparkles':'feed'} size="sm"/></span>
      <div className="feed-detail-source-identity">
       <strong>{observation.publisher||observation.actorName}</strong>
       <span>{observation.actorName} · <time dateTime={observation.observedAt} title={fmt(observation.observedAt)}>{ago(observation.observedAt)}</time></span>
      </div>
     </div>
     {observation.evidenceExcerpt&&<p className="feed-detail-evidence">{observation.evidenceExcerpt}</p>}
     {observation.sourceUrl&&<a href={observation.sourceUrl} target="_blank" rel="noopener noreferrer" className="feed-detail-source-link">
      阅读原始来源 <Icon name="externalLink" size="sm"/>
     </a>}
    </li>)}
   </ol>
  </section>
  {item.relations.length>0&&<section className="feed-detail-section" aria-label="关联内容">
   <div className="feed-detail-section-title"><h3>关联内容</h3><span>{item.relations.length} 项</span></div>
   <ul className="feed-detail-relations">{item.relations.map((relation,index)=><FeedRelationLink key={relation.targetType+':'+relation.targetId+':'+index} relation={relation}/>)}</ul>
  </section>}
  <section className="feed-detail-section" aria-label="管理动态">
   <h3>管理动态</h3>
   <div className="feed-detail-actions">
    <Button label={saved?'取消收藏':'收藏'} variant={saved?'secondary':'ghost'} size="sm"
     icon={<Icon name="bookmark" size="sm" fill={saved?'currentColor':'none'}/>} isDisabled={busy}
     onClick={()=>onAction({action:saved?'unsave':'save'})}/>
    <Button label={snoozed?'取消稍后阅读':'24 小时后再看'} variant={snoozed?'secondary':'ghost'} size="sm"
     icon={<Icon name="clock" size="sm"/>} isDisabled={busy}
     onClick={()=>onAction(snoozed?{action:'unsnooze'}:{action:'snooze',until:new Date(Date.now()+86400000).toISOString()})}/>
    <Button label={item.state.dismissedAt?'恢复':'忽略'} variant="ghost" size="sm"
     icon={<Icon name={item.state.dismissedAt?'restore':'eyeOff'} size="sm"/>} isDisabled={busy}
     onClick={()=>onAction({action:item.state.dismissedAt?'restore':'dismiss'})}/>
   </div>
  </section>
  <section className="feed-detail-section feed-detail-feedback" aria-label="推荐质量反馈">
   <h3>这条动态值得推荐吗？</h3>
   <p>只有你主动选择的评价才会用于改进后续推荐。</p>
   <div className="feed-detail-actions">
    <Button label="有帮助" size="sm" icon={<Icon name="thumbUp" size="sm"/>}
     variant={item.state.feedback==='helpful'?'secondary':'ghost'} isDisabled={busy}
     onClick={()=>onAction({action:'feedback',value:item.state.feedback==='helpful'?'clear':'helpful'})}/>
    <Button label="不相关" size="sm" icon={<Icon name="thumbDown" size="sm"/>}
     variant={item.state.feedback==='irrelevant'?'secondary':'ghost'} isDisabled={busy}
     onClick={()=>onAction({action:'feedback',value:item.state.feedback==='irrelevant'?'clear':'irrelevant'})}/>
   </div>
  </section>
 </div>;
}
