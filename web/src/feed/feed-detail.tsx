import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '../icon';
import {ago,fmt} from '../pages/shared';
import {feedKindIcons,feedKindLabels} from './feed-card';
import {feedReadLabel} from './presentation';
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

export function FeedDetail({item,busy,onAction}:{item:FeedDetailItem;busy:boolean;onAction:(input:FeedStateInput)=>void}){
 const preference=item.state.preference;
 const unread=feedReadLabel(item);
 return <div className="feed-detail" data-feed-detail={item.id}>
  <div className="feed-detail-top">
   <span className="feed-detail-category"><Icon name={feedKindIcons[item.kind]} size="sm"/>{feedKindLabels[item.kind]}</span>
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
  <section className="feed-detail-section" aria-label="兴趣反馈">
   <h3>你的兴趣</h3>
   <p className="feed-detail-hint">收藏是最强的兴趣信号；也可以选择有兴趣或没兴趣。再次点击可撤销。</p>
   <div className="feed-detail-actions">
    {([
     ['saved','收藏','bookmark'],['interested','有兴趣','thumbUp'],['not_interested','没兴趣','thumbDown']
    ] as const).map(([value,label,icon])=><Button key={value} label={label} variant={preference===value?'secondary':'ghost'} size="sm"
     aria-pressed={preference===value} icon={<Icon name={icon} size="sm"/>} isDisabled={busy}
     onClick={()=>onAction({action:'preference',value:preference===value?'clear':value})}/>)}
   </div>
  </section>
 </div>;
}
