import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './tag-fixture.js';
import {feedListInput,publishFeedSchema,feedStateInput} from '../src/feed-model.js';
import {publishFeed,listFeed,getFeedItem,updateFeedState} from '../src/feed.js';

const base={kind:'release' as const,title:'Example release',summary:'Release includes incremental indexing.',whyRelevant:'Useful to Recalloom search architecture.',sourceKind:'github' as const,sourceUrl:'https://example.com/releases/v1',publisher:'Example',evidenceExcerpt:'Version 1 released',relations:[]};
const post=(data:Record<string,unknown>={})=>publishFeedSchema.parse({...base,submissionKey:'v1',...data});
const fails=(code:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code===code);

test('feed accepts sourced observations, merges exact canonical URLs across agents, and is idempotent',async()=>{
 const f=fixture();
 try{
  const first=await publishFeed(f.env,post({sourceUrl:'https://EXAMPLE.com/releases/v1?utm_source=agent#details'}),'agent:github');
  assert.equal(first.created,true);assert.equal(first.duplicate,false);
  assert.equal(first.item.primaryUrl,'https://example.com/releases/v1');
  assert.equal((await getFeedItem(f.env,first.item.id)).observations[0]?.sourceUrl,'https://EXAMPLE.com/releases/v1?utm_source=agent#details');
  assert.equal(first.item.revision,1);
  const replay=await publishFeed(f.env,post({sourceUrl:'https://EXAMPLE.com/releases/v1?utm_source=agent#details'}),'agent:github');
  assert.equal(replay.duplicate,true);assert.equal(replay.item.id,first.item.id);
  await assert.rejects(publishFeed(f.env,post({title:'Changed but same key'}),'agent:github'),fails('FEED_IDEMPOTENCY_CONFLICT'));
  const second=await publishFeed(f.env,post({submissionKey:'web-1',sourceKind:'web',sourceUrl:'https://example.com/releases/v1',publisher:'Independent report'}),'agent:research');
  assert.equal(second.created,false);assert.equal(second.item.id,first.item.id);
  assert.equal(second.item.sourceCount,2);assert.equal(second.item.revision,2);
  const full=await getFeedItem(f.env,first.item.id);
  assert.deepEqual(new Set(full.observations.map(o=>o.actor)),new Set(['agent:github','agent:research']));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM feed_items').get()?.n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM feed_observations').get()?.n,2);
 }finally{f.db.close();}
});

test('feed resolves OAuth actor display names without changing stable provenance identities',async()=>{
 const f=fixture();
 try{
  const actorId=crypto.randomUUID();
  f.db.prepare('INSERT INTO oauth_actor_names(actor_id,client_name,created_at) VALUES(?,?,?)').run(actorId,'Research Agent','2026-11-19T00:00:00Z');
  const item=await publishFeed(f.env,post(),'grant:'+actorId);
  const observation=(await getFeedItem(f.env,item.item.id)).observations[0]!;
  assert.equal(observation.actor,'grant:'+actorId);
  assert.equal(observation.actorName,'Research Agent');
 }finally{f.db.close();}
});

test('feed internal insights use actor-scoped event IDs rather than a shared source URL',async()=>{
 const f=fixture();
 try{
  const first=await publishFeed(f.env,post({submissionKey:'ins-1',eventKey:'insight:search',sourceUrl:undefined,sourceKind:'internal',kind:'insight'}),'agent:A');
  const second=await publishFeed(f.env,post({submissionKey:'ins-1',eventKey:'insight:search',sourceUrl:undefined,sourceKind:'internal',kind:'insight'}),'agent:B');
  assert.notEqual(first.item.id,second.item.id);
  assert.equal((await listFeed(f.env,feedListInput.parse({}))).items.length,2);
  assert.equal(publishFeedSchema.safeParse({...base,submissionKey:'missing',sourceUrl:undefined}).success,false);
 }finally{f.db.close();}
});

test('feed preserves explicit knowledge relations and rejects nonexistent links before mutation',async()=>{
 const f=fixture();
 try{
  const document=await f.record('research.md','Knowledge research');
  const relation={targetType:'record' as const,targetId:document,relation:'relevant_to' as const,reason:'Relevant to indexing'};
  const result=await publishFeed(f.env,post({relations:[relation]}),'agent:research');
  assert.deepEqual((await getFeedItem(f.env,result.item.id)).relations.map(row=>({...row})),[relation]);
  const bad=post({submissionKey:'bad',sourceUrl:'https://example.com/bad',relations:[{...relation,targetId:crypto.randomUUID()}]});
  await assert.rejects(publishFeed(f.env,bad,'agent:research'),fails('FEED_TARGET_NOT_FOUND'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM feed_items').get()?.n,1);
 }finally{f.db.close();}
});

test('feed state supports revision-aware read, explicit feedback and stable filters',async()=>{
 const f=fixture();
 try{
  const first=await publishFeed(f.env,post(),'agent:A');
  const second=await publishFeed(f.env,post({submissionKey:'v2',sourceUrl:'https://example.org/other',title:'Other'}),'agent:A');
  const id=first.item.id;
  assert.equal((await listFeed(f.env,feedListInput.parse({view:'unread'}))).items.length,2);
  const read=await updateFeedState(f.env,id,feedStateInput.parse({action:'read'}));
  assert.equal(read.item.state.readRevision,1);
  await updateFeedState(f.env,id,{action:'read'});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM feed_feedback_events WHERE item_id=?').get(id)?.n,1,'duplicate reads are not new training signals');
  assert.equal((await listFeed(f.env,feedListInput.parse({view:'unread'}))).items.length,1);
  await updateFeedState(f.env,id,{action:'save'});
  assert.deepEqual((await listFeed(f.env,feedListInput.parse({view:'saved'}))).items.map(i=>i.id),[id]);
  await updateFeedState(f.env,id,{action:'feedback',value:'helpful'});
  assert.equal((await getFeedItem(f.env,id)).state.feedback,'helpful');
  const newer=await publishFeed(f.env,post({submissionKey:'independent',sourceKind:'web'}),'agent:B');
  assert.equal(newer.item.id,id);
  assert.deepEqual(new Set((await listFeed(f.env,feedListInput.parse({view:'unread'}))).items.map(i=>i.id)),new Set([id,second.item.id]));
  await updateFeedState(f.env,id,{action:'dismiss'});
  assert.equal((await listFeed(f.env,feedListInput.parse({view:'inbox'}))).items.some(i=>i.id===id),false);
  assert.equal((await listFeed(f.env,feedListInput.parse({view:'dismissed'}))).items[0]?.id,id);
  await updateFeedState(f.env,id,{action:'restore'});
  const until=new Date(Date.now()+86400000).toISOString();
  await updateFeedState(f.env,id,{action:'snooze',until});
  assert.equal((await listFeed(f.env,feedListInput.parse({view:'later'}))).items[0]?.id,id);
  await updateFeedState(f.env,id,{action:'unsnooze'});
  assert.equal((await listFeed(f.env,feedListInput.parse({view:'inbox'}))).items.length,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM feed_feedback_events WHERE item_id=?').get(id)?.n,7);
 }finally{f.db.close();}
});

test('feed concurrent retries converge on one item without losing provenance',async()=>{
 const f=fixture();
 try{
  const message=post({submissionKey:'same',sourceUrl:'https://example.com/concurrent'});
  const results=await Promise.all([
   publishFeed(f.env,message,'agent:A'),
   publishFeed(f.env,message,'agent:A'),
   publishFeed(f.env,post({submissionKey:'different',sourceUrl:'https://example.com/concurrent',publisher:'Other'}),'agent:B')
  ]);
  assert.equal(new Set(results.map(result=>result.item.id)).size,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM feed_items').get()?.n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM feed_observations').get()?.n,2);
  assert.ok(results.some(result=>result.duplicate));
 }finally{f.db.close();}
});

test('feed source validation refuses local endpoints, credentials, and URLs carrying obvious secrets',()=>{
 const cases=[
  'http://localhost:8787/api','http://127.0.0.1/private','http://10.0.0.1/',
  'https://user:pass@example.com/','https://example.com/file?access_token=secret',
  'file:///etc/hosts','javascript:alert(1)'
 ];
 for(const sourceUrl of cases)assert.equal(publishFeedSchema.safeParse({...base,submissionKey:'test',sourceUrl}).success,false,sourceUrl);
});

test('feed keyset pagination remains complete with equal timestamps',async()=>{
 const f=fixture();
 try{
  for(let i=0;i<7;i++)await publishFeed(f.env,post({submissionKey:'s'+i,sourceUrl:'https://example.com/item/'+i,title:'Topic '+i}),'agent:A');
  const seen:string[]=[];let cursor:string|undefined;
  do{
   const page=await listFeed(f.env,feedListInput.parse({limit:2,cursor}));
   seen.push(...page.items.map(row=>row.id));cursor=page.page.nextCursor??undefined;
  }while(cursor);
  assert.equal(new Set(seen).size,7);
  assert.equal(seen.length,7);
  assert.equal((await listFeed(f.env,feedListInput.parse({query:'Topic 3'}))).items.length,1);
  await assert.rejects(listFeed(f.env,feedListInput.parse({cursor:'bad'})),fails('INVALID_CURSOR'));
 }finally{f.db.close();}
});
