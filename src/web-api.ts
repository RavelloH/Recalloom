import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import type { Env } from './types.js';
import { StorageError } from './types.js';
import * as store from './storage.js';
import * as agent from './agent-tools.js';
import { search } from './search.js';
import { recentActivity } from './web-activity.js';
import { capChallenge,capRedeem,webLogin,session,logout,listWebSessions,revokeWebSession,checkOrigin,cookie,WEB_COOKIE,type WebSession } from './web-auth.js';

type Vars={webSession:WebSession};
export const webApi=new Hono<{Bindings:Env;Variables:Vars}>().basePath('/api');
const uuid=z.string().uuid();
const limit=z.coerce.number().int().min(1).max(200).optional();
const status=z.enum(['draft','active','completed','superseded','archived']);
const taskStatus=z.enum(['todo','in_progress','blocked','done','cancelled']);
const recordKind=z.enum(['document','task_list']);
const idSchema=z.object({id:uuid});
const noStore={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const err=(code:string,status:400|401|403|404|405|409|413|429|500|503=400,message?:string)=>Response.json({code,...(message?{message}:{})},{status,headers:noStore});
const parseQuery=<T extends z.ZodTypeAny>(url:string,schema:T):z.infer<T>=>{
  const entries=new URL(url).searchParams;
  return schema.parse(Object.fromEntries(entries.entries()));
};
async function jsonBody<T extends z.ZodTypeAny>(req:Request,schema:T,max=520000):Promise<z.infer<T>>{
  if(!(req.headers.get('content-type')??'').toLowerCase().startsWith('application/json'))throw new StorageError('INVALID_CONTENT_TYPE');
  const length=Number(req.headers.get('content-length')??0);
  if(length>max)throw new StorageError('PAYLOAD_TOO_LARGE');
  const data=await req.text();
  if(new TextEncoder().encode(data).length>max)throw new StorageError('PAYLOAD_TOO_LARGE');
  try{return schema.parse(JSON.parse(data));}
  catch(e){if(e instanceof SyntaxError)throw new StorageError('INVALID_JSON');throw e;}
}
const body=<T extends z.ZodTypeAny>(schema:T,max?:number)=>(req:Request)=>jsonBody(req,schema,max);
const inputTask=z.object({title:z.string().trim().min(1).max(500).optional(),details:z.string().max(50000).optional(),status:taskStatus.optional(),priority:z.number().int().min(-10).max(10).optional()}).strict();
const asJson=(result:unknown,status:200|201=200)=>Response.json(result,{status,headers:noStore});
const actor=(s:WebSession)=>'web:owner:'+s.id;
webApi.onError((e)=>{
  if(e instanceof ZodError)return err('INVALID_ARGUMENT',400,e.issues.map(i=>i.path.join('.')+': '+i.message).join('; ').slice(0,600));
  if(e instanceof StorageError){
    const code=e.code;
    const status=code==='RECORD_NOT_FOUND'||code==='FOLDER_NOT_FOUND'||code==='REVISION_NOT_FOUND' ?404
      :code==='VERSION_CONFLICT'||code==='METADATA_CONFLICT'||code==='PATH_CONFLICT'?409
      :code==='CONTENT_TOO_LARGE'||code==='PAYLOAD_TOO_LARGE'?413:400;
    return err(code,status,e.message);
  }
  if(e instanceof Error&&/UNIQUE constraint failed/.test(e.message))return err('PATH_CONFLICT',409);
  console.error('Recalloom Web API request failed',e instanceof Error?e.name:'Unknown');
  return err('INTERNAL_ERROR',500);
});
webApi.use('*',async(c,next)=>{
  const path=c.req.path,method=c.req.method;
  // Always restrict browser credential-bearing mutations to the same origin.
  if(!['GET','HEAD','OPTIONS'].includes(method)&&!checkOrigin(c.req.raw))return err('INVALID_ORIGIN',403);
  if(method==='OPTIONS')return err('METHOD_NOT_ALLOWED',405);
  if((path==='/api/auth/cap/challenge'||path==='/api/auth/cap/redeem'||path==='/api/auth/login')&&method==='POST')return next();
  const who=await session(c.req.raw,c.env);
  if(!who)return err('UNAUTHORIZED',401);
  c.set('webSession',who);
  return next();
});
webApi.post('/auth/cap/challenge',(c)=>capChallenge(c.req.raw,c.env));
webApi.post('/auth/cap/redeem',async(c)=>capRedeem(c.req.raw,c.env,await jsonBody(c.req.raw,z.unknown(),16000)));
webApi.post('/auth/login',async(c)=>webLogin(c.req.raw,c.env,await jsonBody(c.req.raw,
  z.object({secret:z.string().min(1).max(4096),capToken:z.string().min(1).max(2048)}).strict(),8192)));
webApi.get('/auth/session',(c)=>asJson({authenticated:true,session:c.get('webSession')}));
webApi.post('/auth/logout',async(c)=>{
  await logout(c.env,c.get('webSession').id);
  const response=asJson({loggedOut:true});response.headers.append('set-cookie',cookie('',undefined));return response;
});
webApi.get('/auth/sessions',async(c)=>{
  const result=await listWebSessions(c.env);
  return asJson({...result,currentSessionId:c.get('webSession').id});
});
webApi.delete('/auth/sessions/:id',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const result=await revokeWebSession(c.env,id);
  const response=asJson(result);
  if(id===c.get('webSession').id)response.headers.append('set-cookie',cookie('',undefined));
  return response;
});
webApi.get('/folders',async(c)=>{
  const q=parseQuery(c.req.url,z.object({parentId:uuid.nullable().optional(),limit,cursor:z.string().max(4096).optional()}));
  return asJson(await store.browse(c.env,q.parentId??null,q.limit,q.cursor));
});
webApi.get('/folders/:id',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const item=await c.env.DB.prepare('SELECT id,parent_id AS parentId,name,description,metadata_revision AS metadataRevision,updated_at AS updatedAt FROM folders WHERE id=?').bind(id).first();
  return item?asJson(item):err('FOLDER_NOT_FOUND',404);
});
webApi.post('/folders',async(c)=>{
  const v=await body(z.object({name:z.string().trim().min(1).max(180),parentId:uuid.nullable().optional(),description:z.string().max(5000).optional()}).strict())(c.req.raw);
  return asJson(await store.createFolder(c.env,v.name,v.parentId??null,v.description,actor(c.get('webSession'))),201);
});
webApi.patch('/folders/:id',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const v=await body(z.object({name:z.string().trim().min(1).max(180).optional(),parentId:uuid.nullable().optional(),description:z.string().max(5000).optional(),expectedMetadataRevision:z.number().int().positive()}).strict())(c.req.raw);
  return asJson(await store.manageFolder(c.env,id,v,actor(c.get('webSession'))));
});
webApi.get('/paths',async(c)=>{
  const q=parseQuery(c.req.url,z.object({path:z.string().startsWith('/').max(2048)}));
  return asJson(await store.resolvePath(c.env,q.path));
});
webApi.post('/records',async(c)=>{
  const v=await body(z.object({folderId:uuid.nullable().optional(),name:z.string().trim().min(1).max(180),kind:recordKind.optional(),description:z.string().max(5000).optional(),content:z.string().max(500000).optional(),tags:z.array(z.string().min(1).max(64)).max(32).optional()}).strict())(c.req.raw);
  return asJson(await store.createRecord(c.env,v,actor(c.get('webSession'))),201);
});
webApi.get('/records/:id',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const q=parseQuery(c.req.url,z.object({revision:z.coerce.number().int().positive().optional(),metadataOnly:z.enum(['true','false']).optional(),lineStart:z.coerce.number().int().positive().optional(),maxLines:z.coerce.number().int().min(1).max(2000).optional()}));
  return asJson(await store.readRecord(c.env,id,{revision:q.revision,metadataOnly:q.metadataOnly==='true',lineStart:q.lineStart,maxLines:q.maxLines}));
});
webApi.patch('/records/:id/content',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const v=await body(z.object({expectedRevision:z.number().int().positive(),content:z.string().max(500000),message:z.string().max(500).optional(),dryRun:z.boolean().optional()}).strict())(c.req.raw);
  return asJson(await store.editRecord(c.env,id,v.expectedRevision,v.content,v.message??'Edited in Web UI',actor(c.get('webSession')),v.dryRun??false));
});
webApi.patch('/records/:id/meta',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const v=await body(z.object({name:z.string().trim().min(1).max(180).optional(),folderId:uuid.nullable().optional(),status:status.optional(),description:z.string().max(5000).optional(),expectedMetadataRevision:z.number().int().positive()}).strict())(c.req.raw);
  return asJson(await store.updateMeta(c.env,id,v,actor(c.get('webSession'))));
});
webApi.post('/records/:id/tags',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const v=await body(z.object({tag:z.string().trim().min(1).max(64),action:z.enum(['add','remove'])}).strict())(c.req.raw);
  return asJson(await store.tagRecord(c.env,id,v.tag,v.action,actor(c.get('webSession'))));
});
webApi.get('/records/:id/outline',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const q=parseQuery(c.req.url,z.object({revision:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(200).optional(),cursor:z.coerce.number().int().nonnegative().optional()}));
  return asJson(await agent.getOutline(c.env,id,q.revision,q.limit,q.cursor));
});
webApi.get('/records/:id/versions',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const q=parseQuery(c.req.url,z.object({cursor:z.coerce.number().int().positive().optional(),limit}));
  return asJson(await store.listVersions(c.env,id,q.limit,q.cursor));
});
webApi.get('/records/:id/diff',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const q=parseQuery(c.req.url,z.object({from:z.coerce.number().int().positive(),to:z.coerce.number().int().positive()}));
  return asJson(await agent.diffRevisions(c.env,id,q.from,q.to));
});
webApi.post('/records/:id/restore',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const v=await body(z.object({targetRevision:z.number().int().positive(),expectedRevision:z.number().int().positive()}).strict())(c.req.raw);
  return asJson(await store.restoreRecord(c.env,id,v.targetRevision,v.expectedRevision,actor(c.get('webSession'))));
});
webApi.get('/records/:id/links',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const q=parseQuery(c.req.url,z.object({cursor:z.string().max(4096).optional()}));
  return asJson(await agent.links(c.env,id,'list',undefined,undefined,actor(c.get('webSession')),q.cursor));
});
webApi.post('/records/:id/links',async(c)=>{
  const id=idSchema.parse(c.req.param()).id;
  const v=await body(z.object({action:z.enum(['add','remove']),targetId:uuid,relation:z.string().min(1).max(64).optional()}).strict())(c.req.raw);
  return asJson(await agent.links(c.env,id,v.action,v.targetId,v.relation,actor(c.get('webSession'))));
});
webApi.get('/tasks',async(c)=>{
  const q=parseQuery(c.req.url,z.object({recordId:uuid.optional(),status:taskStatus.optional(),limit,cursor:z.string().max(4096).optional()}));
  return asJson(await store.getTasks(c.env,q.recordId,q.status,q.limit,q.cursor));
});
webApi.post('/tasks/mutate',async(c)=>{
  const v=await body(z.object({recordId:uuid,action:z.enum(['add','update','remove']),taskId:uuid.optional(),expectedRevision:z.number().int().positive(),changes:inputTask.optional()}).strict().superRefine((v,ctx)=>{
    if(v.action==='add'&&!v.changes?.title)ctx.addIssue({code:'custom',path:['changes','title'],message:'Required for add'});
    if(v.action!=='add'&&!v.taskId)ctx.addIssue({code:'custom',path:['taskId'],message:'Required for update/remove'});
  }))(c.req.raw);
  return asJson(await store.taskOperation(c.env,v.recordId,v.expectedRevision,v.action,v.taskId,v.changes??{},actor(c.get('webSession'))));
});
webApi.get('/search',async(c)=>{
  const q=parseQuery(c.req.url,z.object({query:z.string().trim().min(1).max(4000),mode:z.enum(['metadata','literal','semantic','hybrid','auto']).optional(),folderId:uuid.optional(),status:status.optional(),tag:z.string().max(64).optional(),limit:z.coerce.number().int().min(1).max(30).optional(),minScore:z.coerce.number().min(0).max(1).optional()}));
  const {results,...rest}=await search(c.env,q);
  return asJson({...rest,items:results,page:{hasMore:false,nextCursor:null}});
});
webApi.get('/activity',async(c)=>{
  const q=parseQuery(c.req.url,z.object({cursor:z.coerce.number().int().nonnegative().optional(),limit}));
  return asJson(await recentActivity(c.env,q.cursor,q.limit));
});
webApi.get('/tags',async(c)=>{
  const q=parseQuery(c.req.url,z.object({cursor:z.string().max(4096).optional(),limit}));
  return asJson(await agent.listTags(c.env,q.limit,q.cursor));
});
webApi.get('/overview',async(c)=>{
  const q=parseQuery(c.req.url,z.object({folderId:uuid.optional(),depth:z.coerce.number().int().min(0).max(5).optional(),budget:z.coerce.number().int().min(1000).max(30000).optional(),cursor:z.string().max(4096).optional()}));
  return asJson(await agent.getOverview(c.env,q.folderId??null,q.depth,q.budget,q.cursor));
});
webApi.get('/index',async(c)=>{
  const [counts,errors]=await Promise.all([
    c.env.DB.prepare('SELECT state,COUNT(*) AS count FROM index_jobs GROUP BY state').all(),
    c.env.DB.prepare("SELECT id,record_id AS recordId,revision,attempts,last_error AS lastError FROM index_jobs WHERE state='failed' ORDER BY created_at DESC LIMIT 10").all()
  ]);
  return asJson({counts:counts.results,recentFailures:errors.results});
});
webApi.notFound(()=>err('NOT_FOUND',404));
