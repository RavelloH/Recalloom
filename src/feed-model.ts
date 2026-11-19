import {z} from 'zod';

export const feedKinds=['news','release','insight','alert','digest'] as const;
export const feedSourceKinds=['web','github','paper','rss','internal','other'] as const;
export const feedTargets=['record','task','tag','collection'] as const;
export const feedRelationKinds=['relevant_to','contradicts','promoted_to'] as const;
const instant=z.string().datetime({offset:true}).max(40);
const url=z.string().url().max(2048).refine(value=>{
 try{
  const parsed=new URL(value),host=parsed.hostname.toLowerCase();
  if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||!host)return false;
  if(host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||host==='127.0.0.1'||host.startsWith('192.168.')||host.startsWith('10.')||/^172\\.(1[6-9]|2[0-9]|3[01])\\./.test(host))return false;
  return ![...parsed.searchParams.keys()].some(key=>/^(?:token|access_token|api_key|secret|password|signature|x-amz-signature|x-goog-signature)$/i.test(key));
 }
 catch{return false;}
},'Use an HTTP(S) URL without credentials');
export const feedRelationInput=z.object({
 targetType:z.enum(feedTargets),
 targetId:z.string().min(1).max(80),
 relation:z.enum(feedRelationKinds).default('relevant_to'),
 reason:z.string().max(500).default('')
}).strict();
export const publishFeedSchema=z.object({
 submissionKey:z.string().trim().min(1).max(120),
 eventKey:z.string().trim().min(1).max(240).optional(),
 kind:z.enum(feedKinds),
 title:z.string().trim().min(1).max(240),
 summary:z.string().trim().min(1).max(2400),
 whyRelevant:z.string().trim().max(1200).default(''),
 sourceKind:z.enum(feedSourceKinds),
 sourceUrl:url.optional(),
 publisher:z.string().trim().max(160).default(''),
 evidenceExcerpt:z.string().trim().max(1500).default(''),
 publishedAt:instant.optional(),
 expiresAt:instant.optional(),
 relations:z.array(feedRelationInput).max(8).default([])
}).strict().refine(value=>Boolean(value.sourceUrl||value.eventKey),{
 message:'Provide sourceUrl or a stable eventKey for internal insights'
}).refine(value=>value.sourceKind!=='internal'||Boolean(value.eventKey||value.sourceUrl),{
 message:'Internal posts require a stable identity'
});
export const feedPreferences=['saved','interested','not_interested'] as const;
export const feedStateInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('read')}).strict(),
 z.object({action:z.literal('preference'),value:z.enum([...feedPreferences,'clear'])}).strict()
]);
export const feedFeedbackInput=z.object({
 preference:z.enum(feedPreferences).optional(),
 sentiment:z.enum(['positive','negative','all']).default('all'),
 kind:z.enum(feedKinds).optional(),
 since:instant.optional(),
 cursor:z.string().max(4096).optional(),
 limit:z.number().int().min(1).max(50).default(20)
}).strict().refine(value=>!value.preference||value.sentiment==='all',{
 message:'Choose a specific preference or a sentiment, not both'
});
export const feedListInput=z.object({
 view:z.enum(['inbox','all','unread','read','saved','interested','not_interested']).default('inbox'),
 kind:z.enum(feedKinds).optional(),
 query:z.string().trim().max(200).default(''),
 cursor:z.string().max(4096).optional(),
 limit:z.number().int().min(1).max(50).default(20)
}).strict();

export type FeedPublishInput=z.infer<typeof publishFeedSchema>;
export type FeedListInput=z.infer<typeof feedListInput>;
export type FeedStateInput=z.infer<typeof feedStateInput>;
export type FeedFeedbackInput=z.infer<typeof feedFeedbackInput>;
export type FeedPreference=typeof feedPreferences[number];
export type FeedObservation={
 id:string;itemId:string;actor:string;actorName:string;sourceKind:string;sourceUrl:string|null;publisher:string;
 evidenceExcerpt:string;observedAt:string;sourcePublishedAt:string|null;
};
export type FeedRelation={targetType:string;targetId:string;relation:string;reason:string};
export type FeedViewerState={
 readRevision:number;preference:FeedPreference|null;preferenceUpdatedAt:string|null
};
export type FeedItem={
 id:string;kind:typeof feedKinds[number];title:string;summary:string;whyRelevant:string;
 primaryUrl:string|null;publishedAt:string|null;firstSeenAt:string;lastChangedAt:string;
 expiresAt:string|null;lifecycle:string;revision:number;sourceCount:number;
 agentName:string|null;sourcePublisher:string|null;state:FeedViewerState
};
