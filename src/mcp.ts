import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Env, EditInput } from './types.js';
import { StorageError } from './types.js';
import * as store from './storage.js';
import * as agent from './agent-tools.js';
import { processIndexJobs, search } from './search.js';

const uuid=z.string().uuid();
const limit=z.number().int().min(1).max(200).optional();
const statuses=z.enum(['draft','active','completed','superseded','archived']);
const taskStatuses=z.enum(['todo','in_progress','blocked','done','cancelled']);
const taskFields=z.object({
  title:z.string().max(500).optional(),details:z.string().max(50000).optional(),
  status:taskStatuses.optional(),priority:z.number().int().min(-10).max(10).optional()
}).strict();
const editSchema=z.object({
  id:uuid,expectedRevision:z.number().int().positive(),
  mode:z.enum(['rewrite','append','replace','replace_many','patch','lines']),
  content:z.string().max(500000).optional(),
  oldText:z.string().min(1).max(256000).optional(),
  newText:z.string().max(256000).optional(),
  expectedReplacements:z.number().int().min(1).max(1000).optional(),
  replacements:z.array(z.object({oldText:z.string().min(1),newText:z.string(),expectedReplacements:z.number().int().positive().optional()})).min(1).max(64).optional(),
  patch:z.string().min(1).max(512000).optional(),
  operations:z.array(z.object({action:z.enum(['insert','replace','delete']),start:z.number().int().positive(),end:z.number().int().positive().optional(),content:z.string().optional()})).min(1).max(64).optional(),
  message:z.string().max(500).optional(),dryRun:z.boolean().optional()
}).strict().superRefine((v,ctx)=>{
  const keys=v.mode==='rewrite'||v.mode==='append'?['content']:v.mode==='replace'?['oldText','newText']:v.mode==='replace_many'?['replacements']:v.mode==='patch'?['patch']:['operations'];
  for(const key of keys)if(v[key as keyof typeof v]===undefined)ctx.addIssue({code:'custom',path:[key],message:'Required for '+v.mode});
  for(const key of ['content','oldText','newText','replacements','patch','operations'] as const)
    if(!keys.includes(key)&&v[key]!==undefined)ctx.addIssue({code:'custom',path:[key],message:'Not allowed for '+v.mode});
});
function mappedEdit(input:z.infer<typeof editSchema>, original:string):EditInput|string {
  if(input.mode==='rewrite')return input.content!;
  if(input.mode==='append')return original+input.content!;
  if(input.mode==='replace')return {mode:'replace',oldText:input.oldText!,newText:input.newText!,expectedReplacements:input.expectedReplacements};
  if(input.mode==='replace_many')return {mode:'replace_many',replacements:input.replacements!};
  if(input.mode==='patch')return {mode:'patch',patch:input.patch!};
  return {mode:'lines',operations:input.operations!};
}
export function createRecalloomServer(env:Env,scopes:string[],actor='oauth-client') {
  const mcp=new McpServer({name:'recalloom',version:'0.1.0'});
  const register=(name:string,description:string,schema:z.ZodTypeAny,write:boolean,action:(input:any)=>Promise<unknown>)=>{
    mcp.registerTool(name,{
      description,
      inputSchema:schema as any,
      annotations:{readOnlyHint:!write,destructiveHint:write&&['restore_record','manage_record','import_snapshot','manage_link'].includes(name),idempotentHint:!write}
    },async (raw:any)=>{
      try {
        if(!scopes.includes('notes:read')||(write&&!scopes.includes('notes:write')))
          throw new StorageError('INSUFFICIENT_SCOPE','This operation requires notes:'+ (write?'write':'read'));
        const data=schema.parse(raw);
        const value=await action(data);
        return {content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:{result:value} as any};
      }catch(error) {
        const message=error instanceof Error?error.message:String(error);
        const code=error instanceof StorageError?error.code:/PATH_CONFLICT|UNIQUE constraint failed: (?:records|folders)\./.test(message)?'PATH_CONFLICT':'OPERATION_FAILED';
        return {content:[{type:'text' as const,text:JSON.stringify({code,message})}],structuredContent:{code,message},isError:true};
      }
    });
  };
  register('browse','List child folders and records with stable IDs, latest revision, status and descriptions. Start here when the target folder is known.',z.object({folderId:uuid.nullable().optional(),limit,cursor:z.number().int().nonnegative().optional()}),false,
    (x)=>store.browse(env,x.folderId??null,x.limit,x.cursor));
  register('resolve_path','Resolve a human-readable absolute virtual path to a stable folder or record ID.',z.object({path:z.string().startsWith('/').max(2048)}),false,
    (x)=>store.resolvePath(env,x.path));
  register('create_folder','Create a virtual folder; parentId is optional for the root.',z.object({name:z.string().min(1).max(180),parentId:uuid.nullable().optional(),description:z.string().max(5000).optional()}),true,
    (x)=>store.createFolder(env,x.name,x.parentId??null,x.description,actor));
  register('manage_folder','Rename, reparent or describe an existing virtual folder. Prevents cycles.',z.object({
    id:uuid,name:z.string().min(1).max(180).optional(),
    parentId:uuid.nullable().optional(),description:z.string().max(5000).optional(),expectedMetadataRevision:z.number().int().positive().optional()
  }),true,(x)=>store.manageFolder(env,x.id,x,actor));
  register('create_record','Create a document, checkpoint, or structured TODO list, with revision 1.',z.object({name:z.string().min(1).max(180),folderId:uuid.nullable().optional(),kind:z.enum(['document','task_list','checkpoint']).optional(),content:z.string().max(500000).optional(),description:z.string().max(5000).optional()}),true,
    (x)=>store.createRecord(env,x,actor));
  register('read_record','Read a record by stable ID. Supports historical revisions, metadata-only or bounded line ranges to save context.',z.object({id:uuid,revision:z.number().int().positive().optional(),metadataOnly:z.boolean().optional(),lineStart:z.number().int().positive().optional(),maxLines:z.number().int().min(1).max(2000).optional()}),false,
    (x)=>store.readRecord(env,x.id,x));
  register('edit_record','Strictly update a text record using expectedRevision. Modes: rewrite, append, exact replace, replace_many, unified diff patch or line ranges; supports dry-run. TODO records must use task tools.',editSchema,true,
    async (x:z.infer<typeof editSchema>)=>{
      const row=await store.getRecord(env,x.id);
      return store.editRecord(env,x.id,x.expectedRevision,mappedEdit(x,row.content),x.message??'Edited',actor,x.dryRun??false);
    });
  register('manage_record','Rename, move, change status, update description or archive a record without changing its content revision.',z.object({id:uuid,name:z.string().max(180).optional(),folderId:uuid.nullable().optional(),status:statuses.optional(),description:z.string().max(5000).optional(),expectedMetadataRevision:z.number().int().positive().optional()}),true,
    (x)=>store.updateMeta(env,x.id,x,actor));
  register('tag_record','Add or remove a free-form tag from a record.',z.object({id:uuid,tag:z.string().min(1).max(64),action:z.enum(['add','remove'])}),true,
    (x)=>store.tagRecord(env,x.id,x.tag,x.action,actor));
  register('list_tasks','List current structured tasks, optionally filter by task-list record and task status.',z.object({
    recordId:uuid.optional(),status:taskStatuses.optional(),limit,cursor:z.number().int().nonnegative().optional()
  }),false,(x)=>store.getTasks(env,x.recordId,x.status,x.limit,x.cursor));
  register('mutate_task','Atomically add, update or remove tasks in a task_list with expectedRevision and version history.',z.object({
    action:z.enum(['add','update','remove']),recordId:uuid,taskId:uuid.optional(),
    expectedRevision:z.number().int().positive(),changes:taskFields.optional()
  }),true,(x)=>store.taskOperation(env,x.recordId,x.expectedRevision,x.action,x.taskId,x.changes??{},actor));
  register('version_history','List immutable audit metadata for recent revisions of a record; pass beforeRevision=0 to begin paginated mode.',z.object({id:uuid,limit,beforeRevision:z.number().int().nonnegative().optional()}),false,
    (x)=>store.listVersions(env,x.id,x.limit,x.beforeRevision));
  register('restore_record','Append a new revision containing an older version. Supports documents, checkpoints, and task lists with atomic TODO projection restoration.',z.object({id:uuid,targetRevision:z.number().int().positive(),expectedRevision:z.number().int().positive()}),true,
    (x)=>store.restoreRecord(env,x.id,x.targetRevision,x.expectedRevision,actor));
  register('context','Return concise record metadata and open tasks in a folder, for cross-session context restoration.',z.object({folderId:uuid.nullable().optional(),limit}),false,
    (x)=>store.context(env,x.folderId??null,x.limit));
  register('changes','Get incremental record changes after an integer cursor.',z.object({cursor:z.number().int().nonnegative().optional(),limit}),false,
    (x)=>store.changesSince(env,x.cursor,x.limit));
  register('search','Search by metadata, literal text, semantic Vectorize, or fused hybrid ranking. Semantic results default to minScore=0.43 (adjustable 0-1); index may lag.',z.object({
    query:z.string().min(1).max(4000),mode:z.enum(['metadata','literal','semantic','hybrid','auto']).optional(),
    folderId:uuid.optional(),tag:z.string().max(64).optional(),status:statuses.optional(),limit:z.number().int().min(1).max(30).optional(),
    minScore:z.number().min(0).max(1).optional()
  }),false,(x)=>search(env,x));
  register('index_status','Check pending indexing jobs and failures without modifying the library.',z.object({}),false,
    async()=>env.DB.prepare('SELECT state,COUNT(*) AS count FROM index_jobs GROUP BY state').all().then(x=>x.results));
  register('index_diagnostics','Summarize index queue, stale running leases and recently failed jobs for operational recovery.',z.object({}),false,
    async()=>{const [counts,failures]=await Promise.all([
      env.DB.prepare("SELECT state,COUNT(*) AS count, SUM(CASE WHEN state='running' AND (started_at IS NULL OR started_at<?) THEN 1 ELSE 0 END) AS stale FROM index_jobs GROUP BY state")
        .bind(new Date(Date.now()-5*60*1000).toISOString()).all(),
      env.DB.prepare("SELECT id,record_id,revision,attempts,last_error,started_at FROM index_jobs WHERE state='failed' ORDER BY created_at DESC LIMIT 10").all()
    ]);return {counts:counts.results,recentFailures:failures.results};});
  register('index_pending','Process up to 10 pending semantic indexing jobs immediately. Normally the Cron scheduler handles them.',z.object({limit:z.number().int().min(1).max(10).optional()}),true,
    (x)=>processIndexJobs(env,x.limit??3));
  register('read_many','Read multiple records with a shared response character budget. Returns per-record errors without dropping other reads.',
    z.object({ids:z.array(uuid).min(1).max(12),maxChars:z.number().int().min(1000).max(60000).optional()}),false,
    (x)=>agent.readMany(env,x.ids,x.maxChars));
  register('diff_revisions','Compare two immutable text-version revisions and return a bounded unified diff.',
    z.object({id:uuid,fromRevision:z.number().int().positive(),toRevision:z.number().int().positive()}),false,
    (x)=>agent.diffRevisions(env,x.id,x.fromRevision,x.toRevision));
  register('list_tags','List known tags and how many records use each tag.',
    z.object({limit:z.number().int().min(1).max(200).optional()}),false,
    (x)=>agent.listTags(env,x.limit));
  register('list_links','Read existing incoming and outgoing links for a record without modifying data.',
    z.object({id:uuid}),false,(x)=>agent.links(env,x.id,'list'));
  register('manage_link','Add or remove a directed link between records with stable IDs.',
    z.object({id:uuid,action:z.enum(['add','remove']),targetId:uuid,relation:z.string().min(1).max(64).optional()}),true,
    (x)=>agent.links(env,x.id,x.action,x.targetId,x.relation,actor));
  register('record_links','List, add or remove directed links between records.',
    z.object({id:uuid,action:z.enum(['list','add','remove']).optional(),targetId:uuid.optional(),relation:z.string().min(1).max(64).optional()}),true,
    (x)=>agent.links(env,x.id,x.action,x.targetId,x.relation,actor));
  register('project_context','Restore project context recursively with bounded content snippets and outstanding tasks.',
    z.object({folderId:uuid.nullable().optional(),depth:z.number().int().min(0).max(5).optional(),budget:z.number().int().min(1000).max(30000).optional()}),false,
    (x)=>agent.projectContext(env,x.folderId??null,x.depth,x.budget));
  register('export_snapshot','Read a paged, version-preserving backup in recalloom-snapshot-v1 format, including archived records, folder hierarchy, links, tags and text-version history.',
    z.object({cursor:z.number().int().nonnegative().optional(),limit:z.number().int().min(1).max(5).optional()}),false,
    (x)=>agent.exportSnapshot(env,x.cursor,x.limit));
  register('import_snapshot','Validate or import a version-preserving snapshot page. Dry-run is the safe default; existing records are never overwritten.',
    z.object({snapshot:z.unknown(),dryRun:z.boolean().optional()}),true,
    (x)=>agent.importSnapshot(env,x.snapshot,x.dryRun??true));
  return mcp;
}
