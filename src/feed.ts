import type {Env} from './types.js';
import {StorageError} from './types.js';
import {sha256} from './version.js';
import {tagIdPattern} from './tag-model.js';
import type {FeedItem,FeedListInput,FeedObservation,FeedPublishInput,FeedRelation,FeedStateInput} from './feed-model.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso=()=>new Date().toISOString();
const VIEWER='owner'; // One authenticated library owner; never session-scoped.
type ItemRow=Omit<FeedItem,'state'>&{
 readRevision:number;savedAt:string|null;dismissedAt:string|null;snoozedUntil:string|null;feedback:'helpful'|'irrelevant'|null
};
type ObservationRow={
 id:string;itemId:string;actor:string;actorName:string;sourceKind:string;sourceUrl:string|null;publisher:string;
 evidenceExcerpt:string;observedAt:string;sourcePublishedAt:string|null
};
const selectItem=`SELECT i.id,i.kind,i.title,i.summary,i.why_relevant AS whyRelevant,
 i.primary_url AS primaryUrl,i.published_at AS publishedAt,
 i.first_seen_at AS firstSeenAt,i.last_changed_at AS lastChangedAt,
 i.expires_at AS expiresAt,i.lifecycle,i.revision,
 (SELECT COUNT(*) FROM feed_observations o WHERE o.item_id=i.id) AS sourceCount,
 COALESCE(s.read_revision,0) AS readRevision,s.saved_at AS savedAt,
 s.dismissed_at AS dismissedAt,s.snoozed_until AS snoozedUntil,s.feedback
 FROM feed_items i LEFT JOIN feed_states s ON s.item_id=i.id AND s.viewer_id='owner'`;
const itemFromRow=({readRevision,savedAt,dismissedAt,snoozedUntil,feedback,...item}:ItemRow):FeedItem=>({
 ...item,state:{readRevision,savedAt,dismissedAt,snoozedUntil,feedback}
});
function canonicalUrl(input:string){
 const value=new URL(input);
 value.hash='';
 for(const key of [...value.searchParams.keys()])
  if(/^utm_/i.test(key)||['fbclid','gclid','dclid','msclkid','mc_cid','mc_eid'].includes(key.toLowerCase()))
   value.searchParams.delete(key);
 value.searchParams.sort();
 return value.toString();
}
function cursorEncode(row:{id:string;firstSeenAt:string}){
 return btoa(JSON.stringify({id:row.id,firstSeenAt:row.firstSeenAt}));
}
function cursorDecode(cursor:string){
 try{
  const value=JSON.parse(atob(cursor)) as {id:string;firstSeenAt:string};
  if(!uuid.test(value.id)||typeof value.firstSeenAt!=='string'||!Number.isFinite(Date.parse(value.firstSeenAt)))
   throw Error();
  return value;
 }catch{throw new StorageError('INVALID_CURSOR');}
}
async function findObservation(env:Env,actor:string,submissionKey:string){
 return env.DB.prepare(`SELECT o.item_id AS itemId,o.payload_hash AS payloadHash,
 i.dedupe_key AS dedupeKey FROM feed_observations o
 JOIN feed_items i ON i.id=o.item_id WHERE o.actor=? AND o.submission_key=?`)
  .bind(actor,submissionKey).first<{itemId:string;payloadHash:string;dedupeKey:string}>();
}
async function validateRelations(env:Env,relations:FeedPublishInput['relations']){
 const seen=new Set<string>();
 for(const relation of relations){
  if(relation.targetType==='tag'){
   if(!tagIdPattern.test(relation.targetId))throw new StorageError('INVALID_FEED_RELATION');
  }else if(!uuid.test(relation.targetId))throw new StorageError('INVALID_FEED_RELATION');
  const key=[relation.targetType,relation.targetId,relation.relation].join(':');
  if(seen.has(key))throw new StorageError('DUPLICATE_FEED_RELATION');
  seen.add(key);
  const table=relation.targetType==='record'?'records':relation.targetType==='task'?'tasks':relation.targetType==='tag'?'tags':'smart_collections';
  const row=await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id=?`).bind(relation.targetId).first();
  if(!row)throw new StorageError('FEED_TARGET_NOT_FOUND');
 }
}
export async function publishFeed(env:Env,input:FeedPublishInput,actor:string){
 if(!actor||actor.length>300)throw new StorageError('INVALID_FEED_ACTOR');
 const timestamp=iso();
 if(input.expiresAt&&Date.parse(input.expiresAt)<=Date.now())throw new StorageError('INVALID_FEED_EXPIRY');
 const normalizedUrl=input.sourceUrl?canonicalUrl(input.sourceUrl):null;
 const dedupeKey=normalizedUrl?'url:'+await sha256(normalizedUrl)
  :'agent:'+await sha256(actor+'\0'+input.eventKey);
 const payloadHash=await sha256(JSON.stringify({...input,sourceUrl:normalizedUrl}));
 const previous=await findObservation(env,actor,input.submissionKey);
 if(previous){
  if(previous.payloadHash!==payloadHash||previous.dedupeKey!==dedupeKey)
   throw new StorageError('FEED_IDEMPOTENCY_CONFLICT');
  return {item:await getFeedItem(env,previous.itemId),duplicate:true,created:false};
 }
 const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
 const quota=await env.DB.prepare('SELECT COUNT(*) AS n FROM feed_observations WHERE actor=? AND created_at>=?').bind(actor,cutoff).first<{n:number}>();
 if(Number(quota?.n??0)>=200)throw new StorageError('FEED_RATE_LIMIT');
 await validateRelations(env,input.relations);
 const candidate=crypto.randomUUID(),observation=crypto.randomUUID();
 const expiresAt=input.expiresAt??new Date(Date.now()+(input.kind==='alert'?14:input.kind==='insight'?90:60)*86400000).toISOString();
 const statements:D1PreparedStatement[]=[
  env.DB.prepare(`INSERT INTO feed_items(id,dedupe_key,kind,title,summary,why_relevant,primary_url,published_at,first_seen_at,last_changed_at,expires_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`)
   .bind(candidate,dedupeKey,input.kind,input.title,input.summary,input.whyRelevant,normalizedUrl,input.publishedAt??null,timestamp,timestamp,expiresAt),
  env.DB.prepare(`INSERT INTO feed_observations(id,item_id,actor,submission_key,payload_hash,source_kind,source_url,publisher,evidence_excerpt,observed_at,source_published_at,created_at)
   SELECT ?,i.id,?,?,?,?,?,?,?,?,?,? FROM feed_items i WHERE i.dedupe_key=?`)
   .bind(observation,actor,input.submissionKey,payloadHash,input.sourceKind,input.sourceUrl??null,input.publisher,input.evidenceExcerpt,timestamp,input.publishedAt??null,timestamp,dedupeKey),
  env.DB.prepare(`UPDATE feed_items SET revision=revision+1,last_changed_at=? WHERE dedupe_key=? AND id<>?`)
   .bind(timestamp,dedupeKey,candidate)
 ];
 for(const relation of input.relations){
  statements.push(env.DB.prepare(`INSERT INTO feed_relations(item_id,target_type,target_id,relation,reason,created_by,created_at)
   SELECT i.id,?,?,?,?,?,? FROM feed_items i WHERE i.dedupe_key=?
   ON CONFLICT(item_id,target_type,target_id,relation) DO NOTHING`)
   .bind(relation.targetType,relation.targetId,relation.relation,relation.reason,actor,timestamp,dedupeKey));
 }
 let created=false;
 try{const results=await env.DB.batch(statements);created=Number(results[0]?.meta?.changes??0)>0;}
 catch(error){
  // A simultaneous identical retry may win the unique(actor,submission_key) race.
  const winner=await findObservation(env,actor,input.submissionKey);
  if(winner){
   if(winner.payloadHash!==payloadHash||winner.dedupeKey!==dedupeKey)throw new StorageError('FEED_IDEMPOTENCY_CONFLICT');
   return {item:await getFeedItem(env,winner.itemId),duplicate:true,created:false};
  }
  throw error;
 }
 const row=await env.DB.prepare('SELECT id FROM feed_items WHERE dedupe_key=?').bind(dedupeKey).first<{id:string}>();
 if(!row)throw new StorageError('FEED_ITEM_NOT_FOUND');
 return {item:await getFeedItem(env,row.id),duplicate:false,created};
}
export async function listFeed(env:Env,options:FeedListInput){
 const {view,kind,query,limit,cursor}=options,now=iso();
 const clauses=["i.lifecycle='active'"];
 const values:(string|number)[]=[];
 if(kind){clauses.push('i.kind=?');values.push(kind);}
 if(query){clauses.push('(instr(lower(i.title),lower(?))>0 OR instr(lower(i.summary),lower(?))>0)');values.push(query,query);}
 if(view==='inbox'||view==='unread'){
  clauses.push('(i.expires_at IS NULL OR i.expires_at>?)','s.dismissed_at IS NULL','(s.snoozed_until IS NULL OR s.snoozed_until<=?)');
  values.push(now,now);
 }
 if(view==='unread')clauses.push('COALESCE(s.read_revision,0)<i.revision');
 if(view==='saved')clauses.push('s.saved_at IS NOT NULL');
 if(view==='later'){clauses.push('s.snoozed_until>?');values.push(now);}
 if(view==='dismissed')clauses.push('s.dismissed_at IS NOT NULL');
 if(cursor){
  const after=cursorDecode(cursor);
  clauses.push('(i.first_seen_at<? OR (i.first_seen_at=? AND i.id<?))');
  values.push(after.firstSeenAt,after.firstSeenAt,after.id);
 }
 const rows=(await env.DB.prepare(`${selectItem} WHERE ${clauses.join(' AND ')}
  ORDER BY i.first_seen_at DESC,i.id DESC LIMIT ?`).bind(...values,limit+1).all<ItemRow>()).results;
 const items=rows.slice(0,limit).map(itemFromRow);
 return {items,page:{nextCursor:rows.length>limit&&items.length?cursorEncode(items[items.length-1]!):null}};
}
export async function getFeedItem(env:Env,id:string){
 const record=await env.DB.prepare(`${selectItem} WHERE i.id=?`).bind(id).first<ItemRow>();
 if(!record)throw new StorageError('FEED_ITEM_NOT_FOUND');
 const [observations,relations]=await Promise.all([
  env.DB.prepare(`SELECT o.id,o.item_id AS itemId,o.actor,
   COALESCE(n.client_name,o.actor) AS actorName,o.source_kind AS sourceKind,o.source_url AS sourceUrl,o.publisher,
   o.evidence_excerpt AS evidenceExcerpt,o.observed_at AS observedAt,o.source_published_at AS sourcePublishedAt
   FROM feed_observations o LEFT JOIN oauth_actor_names n ON o.actor=('grant:'||n.actor_id)
   WHERE o.item_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 100`).bind(id).all<ObservationRow>(),
  env.DB.prepare(`SELECT target_type AS targetType,target_id AS targetId,relation,reason FROM feed_relations
   WHERE item_id=? ORDER BY created_at DESC LIMIT 100`).bind(id).all<FeedRelation>()
 ]);
 return { ...itemFromRow(record),observations:observations.results as FeedObservation[],relations:relations.results };
}
export async function updateFeedState(env:Env,id:string,input:FeedStateInput){
 const record=await env.DB.prepare(`SELECT i.revision,COALESCE(s.read_revision,0) AS readRevision,
  s.saved_at AS savedAt,s.dismissed_at AS dismissedAt,s.snoozed_until AS snoozedUntil,s.feedback
  FROM feed_items i LEFT JOIN feed_states s ON s.item_id=i.id AND s.viewer_id='owner'
  WHERE i.id=?`).bind(id).first<{revision:number;readRevision:number;savedAt:string|null;dismissedAt:string|null;snoozedUntil:string|null;feedback:string|null}>();
 if(!record)throw new StorageError('FEED_ITEM_NOT_FOUND');
 const timestamp=iso();
 const mutations:Record<FeedStateInput['action'],{column:string;value:string|number|null}>={
  read:{column:'read_revision',value:record.revision},
  unread:{column:'read_revision',value:0},
  save:{column:'saved_at',value:timestamp},
  unsave:{column:'saved_at',value:null},
  dismiss:{column:'dismissed_at',value:timestamp},
  restore:{column:'dismissed_at',value:null},
  snooze:{column:'snoozed_until',value:input.action==='snooze'?input.until:null},
  unsnooze:{column:'snoozed_until',value:null},
  feedback:{column:'feedback',value:input.action==='feedback'&&input.value!=='clear'?input.value:null}
 };
 if(input.action==='snooze'&&Date.parse(input.until)<=Date.now())throw new StorageError('INVALID_FEED_SNOOZE');
 // A repeated browser retry is not a second user preference signal.
 const unchanged=input.action==='read'?record.readRevision>=record.revision:
  input.action==='unread'?record.readRevision===0:
  input.action==='save'?record.savedAt!==null:
  input.action==='unsave'?record.savedAt===null:
  input.action==='dismiss'?record.dismissedAt!==null:
  input.action==='restore'?record.dismissedAt===null:
  input.action==='snooze'?record.snoozedUntil===input.until:
  input.action==='unsnooze'?record.snoozedUntil===null:
  record.feedback===(input.value==='clear'?null:input.value);
 if(unchanged)return {item:await getFeedItem(env,id)};
 const {column,value}=mutations[input.action];
 const statements=[
  env.DB.prepare('INSERT OR IGNORE INTO feed_states(item_id,viewer_id,updated_at) VALUES(?,?,?)').bind(id,VIEWER,timestamp),
  env.DB.prepare(`UPDATE feed_states SET ${column}=?,updated_at=? WHERE item_id=? AND viewer_id=?`).bind(value,timestamp,id,VIEWER),
  env.DB.prepare('INSERT INTO feed_feedback_events(item_id,viewer_id,action,value,item_revision,created_at) VALUES(?,?,?,?,?,?)')
   .bind(id,VIEWER,input.action,input.action==='feedback'?input.value:null,record.revision,timestamp)
 ];
 await env.DB.batch(statements);
 return {item:await getFeedItem(env,id)};
}
