import type {Env} from './types.js';
import {StorageError} from './types.js';
import {sha256} from './version.js';
import {tagIdPattern} from './tag-model.js';
import type {FeedItem,FeedListInput,FeedObservation,FeedPublishInput,FeedRelation,FeedStateInput,FeedFeedbackInput} from './feed-model.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso=()=>new Date().toISOString();
const VIEWER='owner'; // One authenticated library owner; never session-scoped.
type ItemRow=Omit<FeedItem,'state'>&{
 readRevision:number;preference:'saved'|'interested'|'not_interested'|null;preferenceUpdatedAt:string|null
};
type ObservationRow={
 id:string;itemId:string;actor:string;actorName:string;sourceKind:string;sourceUrl:string|null;publisher:string;
 evidenceExcerpt:string;observedAt:string;sourcePublishedAt:string|null
};
const selectItem=`SELECT i.id,i.kind,i.title,i.summary,i.why_relevant AS whyRelevant,
 i.primary_url AS primaryUrl,i.published_at AS publishedAt,
 i.first_seen_at AS firstSeenAt,i.last_changed_at AS lastChangedAt,
 i.expires_at AS expiresAt,i.lifecycle,i.revision,
 NULLIF(first_observation.publisher,'') AS sourcePublisher,
 COALESCE(NULLIF(source_agent.client_name,''),CASE WHEN first_observation.actor LIKE 'grant:%' THEN NULL ELSE first_observation.actor END) AS agentName,
 (SELECT COUNT(*) FROM feed_observations o WHERE o.item_id=i.id) AS sourceCount,
 COALESCE(s.read_revision,0) AS readRevision,s.saved_at AS savedAt,
 s.preference,s.preference_updated_at AS preferenceUpdatedAt
 FROM feed_items i LEFT JOIN feed_states s ON s.item_id=i.id AND s.viewer_id='owner'
 LEFT JOIN feed_observations first_observation ON first_observation.id=(
  SELECT o.id FROM feed_observations o WHERE o.item_id=i.id ORDER BY o.created_at ASC,o.id ASC LIMIT 1
 )
 LEFT JOIN oauth_actor_names source_agent ON first_observation.actor=('grant:'||source_agent.actor_id)`;
const itemFromRow=({readRevision,preference,preferenceUpdatedAt,...item}:ItemRow):FeedItem=>({
 ...item,state:{readRevision,preference,preferenceUpdatedAt}
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
function cursorEncode(row:{id:string;publishedAt:string|null;firstSeenAt:string}){
 return btoa(JSON.stringify({id:row.id,sortAt:row.publishedAt??row.firstSeenAt}));
}
function cursorDecode(cursor:string){
 try{
  const value=JSON.parse(atob(cursor)) as {id:string;sortAt:string};
  if(!uuid.test(value.id)||typeof value.sortAt!=='string'||!Number.isFinite(Date.parse(value.sortAt)))
   throw Error();
  return value;
 }catch{throw new StorageError('INVALID_CURSOR');}
}
function feedbackCursorEncode(row:{id:string;state:{preferenceUpdatedAt:string|null}}){
 return btoa(JSON.stringify({id:row.id,sortAt:row.state.preferenceUpdatedAt}));
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
 const normalizedPublishedAt=input.publishedAt?new Date(input.publishedAt).toISOString():null;
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
 const expiresAt=input.expiresAt?new Date(input.expiresAt).toISOString():new Date(Date.now()+(input.kind==='alert'?14:input.kind==='insight'?90:60)*86400000).toISOString();
 const statements:D1PreparedStatement[]=[
  env.DB.prepare(`INSERT INTO feed_items(id,dedupe_key,kind,title,summary,why_relevant,primary_url,published_at,first_seen_at,last_changed_at,expires_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`)
   .bind(candidate,dedupeKey,input.kind,input.title,input.summary,input.whyRelevant,normalizedUrl,normalizedPublishedAt,timestamp,timestamp,expiresAt),
  env.DB.prepare(`INSERT INTO feed_observations(id,item_id,actor,submission_key,payload_hash,source_kind,source_url,publisher,evidence_excerpt,observed_at,source_published_at,created_at)
   SELECT ?,i.id,?,?,?,?,?,?,?,?,?,? FROM feed_items i WHERE i.dedupe_key=?`)
   .bind(observation,actor,input.submissionKey,payloadHash,input.sourceKind,input.sourceUrl??null,input.publisher,input.evidenceExcerpt,timestamp,normalizedPublishedAt,timestamp,dedupeKey),
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
 if(view==='inbox'||view==='unread'||view==='read'){
  clauses.push('(i.expires_at IS NULL OR i.expires_at>?)',"(s.preference IS NULL OR s.preference<>'not_interested')");
  values.push(now);
 }
 if(view==='unread')clauses.push('s.preference IS NULL','COALESCE(s.read_revision,0)<i.revision');
 if(view==='read')clauses.push('s.preference IS NULL','COALESCE(s.read_revision,0)>=i.revision');
 if(view==='saved'||view==='interested'||view==='not_interested'){
  clauses.push('s.preference=?');values.push(view);
 }
 if(cursor){
  const after=cursorDecode(cursor);
  clauses.push('(COALESCE(i.published_at,i.first_seen_at)<? OR (COALESCE(i.published_at,i.first_seen_at)=? AND i.id<?))');
  values.push(after.sortAt,after.sortAt,after.id);
 }
 const rows=(await env.DB.prepare(`${selectItem} WHERE ${clauses.join(' AND ')}
  ORDER BY COALESCE(i.published_at,i.first_seen_at) DESC,i.id DESC LIMIT ?`).bind(...values,limit+1).all<ItemRow>()).results;
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
/** Feedback is explicit preference only. Reading is a separate, weak behavioral signal. */
export async function listFeedFeedback(env:Env,options:FeedFeedbackInput){
 const clauses=["i.lifecycle='active'","s.preference IS NOT NULL"];
 const values:(string|number)[]=[];
 if(options.preference){clauses.push("s.preference=?");values.push(options.preference);}
 else if(options.sentiment==='positive')clauses.push("s.preference IN ('saved','interested')");
 else if(options.sentiment==='negative')clauses.push("s.preference='not_interested'");
 if(options.kind){clauses.push("i.kind=?");values.push(options.kind);}
 if(options.since){clauses.push("s.preference_updated_at>=?");values.push(new Date(options.since).toISOString());}
 if(options.cursor){
  const cursor=cursorDecode(options.cursor);
  clauses.push("(s.preference_updated_at<? OR (s.preference_updated_at=? AND i.id<?))");
  values.push(cursor.sortAt,cursor.sortAt,cursor.id);
 }
 const rows=(await env.DB.prepare(`${selectItem} WHERE ${clauses.join(' AND ')}
  ORDER BY s.preference_updated_at DESC,i.id DESC LIMIT ?`)
  .bind(...values,options.limit+1).all<ItemRow>()).results;
 const items=rows.slice(0,options.limit).map(itemFromRow);
 return {items,page:{nextCursor:rows.length>options.limit&&items.length?feedbackCursorEncode(items[items.length-1]!):null}};
}

export async function updateFeedState(env:Env,id:string,input:FeedStateInput){
 const record=await env.DB.prepare(`SELECT i.revision,COALESCE(s.read_revision,0) AS readRevision,
  s.preference FROM feed_items i LEFT JOIN feed_states s ON s.item_id=i.id AND s.viewer_id='owner'
  WHERE i.id=?`).bind(id).first<{revision:number;readRevision:number;preference:string|null}>();
 if(!record)throw new StorageError('FEED_ITEM_NOT_FOUND');
 const timestamp=iso(),reading=input.action==='read';
 const value=reading?null:input.value==='clear'?null:input.value;
 // Repeated intersection-observer notifications are not repeated user signals.
 const unchanged=reading?record.readRevision>=record.revision:record.preference===value;
 if(unchanged)return {item:await getFeedItem(env,id)};
 const statements:D1PreparedStatement[]=[
  env.DB.prepare('INSERT OR IGNORE INTO feed_states(item_id,viewer_id,updated_at) VALUES(?,?,?)').bind(id,VIEWER,timestamp),
  reading
   ?env.DB.prepare('UPDATE feed_states SET read_revision=?,updated_at=? WHERE item_id=? AND viewer_id=?')
     .bind(record.revision,timestamp,id,VIEWER)
   :env.DB.prepare('UPDATE feed_states SET preference=?,preference_updated_at=?,read_revision=?,updated_at=? WHERE item_id=? AND viewer_id=?')
     .bind(value,timestamp,record.revision,timestamp,id,VIEWER),
  env.DB.prepare('INSERT INTO feed_feedback_events(item_id,viewer_id,action,value,item_revision,created_at) VALUES(?,?,?,?,?,?)')
   .bind(id,VIEWER,reading?'read':'preference',reading?null:value,record.revision,timestamp)
 ];
 await env.DB.batch(statements);
 return {item:await getFeedItem(env,id)};
}
