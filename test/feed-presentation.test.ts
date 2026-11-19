import test from 'node:test';
import assert from 'node:assert/strict';
import {feedReadLabel,feedSourceLabel,groupFeedItems} from '../web/src/feed/presentation.js';
import type {FeedItem} from '../src/feed-model.js';

const sample=(id:string,firstSeenAt:string,readRevision=0,revision=1):FeedItem=>({
 id,kind:'news',title:id,summary:'Summary',whyRelevant:'',primaryUrl:'https://example.com',
 firstSeenAt,lastChangedAt:firstSeenAt,publishedAt:null,expiresAt:null,lifecycle:'active',
 revision,sourceCount:1,agentName:null,sourcePublisher:null,
 state:{readRevision,preference:null,preferenceUpdatedAt:null}
});

test('feed groups consecutive items by the viewer local calendar, including year boundaries',()=>{
 const now=new Date(2026,0,1,12,0,0);
 const items=[
  sample('a',new Date(2026,0,1,9).toISOString()),
  sample('b',new Date(2026,0,1,7).toISOString()),
  sample('c',new Date(2025,11,31,23).toISOString()),
  sample('d',new Date(2025,11,30,12).toISOString())
 ];
 const groups=groupFeedItems(items,now);
 assert.deepEqual(groups.map(group=>[group.label,group.items.map(item=>item.id)]),[
  ['今天',['a','b']],['昨天',['c']],['2025年12月30日',['d']]
 ]);
});

test('feed presentation communicates unread and updated revisions separately',()=>{
 const date=new Date().toISOString();
 assert.equal(feedReadLabel(sample('a',date)), '未读');
 assert.equal(feedReadLabel(sample('b',date,1,2)), '有新进展');
 assert.equal(feedReadLabel(sample('c',date,2,2)), null);
});

test('feed source badges use canonical host, and grouping uses publish time',()=>{
 assert.equal(feedSourceLabel('https://www.example.com/article?utm_source=test'),'example.com');
 assert.equal(feedSourceLabel(null),'Agent 发现');
 assert.equal(feedSourceLabel('not a URL'),'外部来源');
 const now=new Date(2026,10,19,12);
 const item=sample('a',new Date(2026,10,18,18).toISOString());
 item.publishedAt=new Date(2026,10,19,9).toISOString();
 assert.equal(groupFeedItems([item],now)[0]?.label,'今天');
});
