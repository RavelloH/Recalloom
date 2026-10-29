import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Env, EditInput } from './types.js';
import { StorageError } from './types.js';
import * as store from './storage.js';
import * as agent from './agent-tools.js';
import { processIndexJobs, search } from './search.js';
import { SERVER_INSTRUCTIONS, TOOL_GUIDANCE, type RecalloomToolName } from './mcp-guidance.js';

const uuid=z.string().uuid().describe('Stable record/folder UUID returned by browse, search, or resolve_path.');
const limit=z.number().int().min(1).max(200).describe('Maximum items per page (1–200).').optional();
const pageCursor=z.string().max(4096).describe('Opaque page.nextCursor from the previous response. Omit on the first page; never construct it.').optional();
const expectedRevision=z.number().int().positive().describe('Current revision from read_record; prevents overwriting concurrent edits.');
const expectedMetadataRevision=z.number().int().positive().describe('Current metadataRevision from browse or read_record; prevents concurrent metadata overwrites.');
const statuses=z.enum(['draft','active','completed','superseded','archived']);
const taskStatuses=z.enum(['todo','in_progress','blocked','done','cancelled']);
const taskFields=z.object({
  title:z.string().max(500).describe('Task title; required for add.').optional(),details:z.string().max(50000).describe('Task details, acceptance criteria and progress evidence.').optional(),
  status:taskStatuses.describe('Current task workflow state.').optional(),priority:z.number().int().min(-10).max(10).describe('Priority: larger numbers are more urgent.').optional()
}).strict();
const editSchema=z.object({
  id:uuid,expectedRevision,
  mode:z.enum(['rewrite','append','replace','replace_many','patch','lines']).describe('Choose full rewrite, append, exact replacement, unified patch, or positional line edits.'),
  content:z.string().max(500000).describe('Entire replacement body for rewrite, or appended text for append.').optional(),
  oldText:z.string().min(1).max(256000).describe('Exact old substring for replace.').optional(),
  newText:z.string().max(256000).describe('New substring for replace; may be empty.').optional(),
  expectedReplacements:z.number().int().min(1).max(1000).describe('Required occurrence count for an exact replacement.').optional(),
  replacements:z.array(z.object({oldText:z.string().min(1),newText:z.string(),expectedReplacements:z.number().int().positive().optional()})).min(1).max(64).optional(),
  patch:z.string().min(1).max(512000).describe('Unified diff to apply against existing content.').optional(),
  operations:z.array(z.object({action:z.enum(['insert','replace','delete']),start:z.number().int().positive(),end:z.number().int().positive().optional(),content:z.string().optional()})).min(1).max(64).optional(),
  message:z.string().max(500).describe('Audit message for this revision.').optional(),dryRun:z.boolean().describe('Validate without modifying the stored record.').optional()
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
  const mcp=new McpServer({name:'recalloom',version:'0.1.0'}, {instructions:SERVER_INSTRUCTIONS});
  const register=(name:RecalloomToolName,schema:z.ZodTypeAny,write:boolean,action:(input:any)=>Promise<unknown>)=>{
    const guidance=TOOL_GUIDANCE[name];
    mcp.registerTool(name,{
      title:guidance.title,
      description:guidance.description,
      inputSchema:schema as any,
      // Tool annotations are advisory. Auth scope checks and revision controls remain authoritative.
      annotations:{readOnlyHint:!write,destructiveHint:write&&guidance.destructive,idempotentHint:!write}
    },async (raw:any)=>{
      try {
        if(!scopes.includes('notes:read')||(write&&!scopes.includes('notes:write')))
          throw new StorageError('INSUFFICIENT_SCOPE','This operation requires notes:'+ (write?'write':'read'));
        const data=schema.parse(raw);
        const value=await action(data);
        return {content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:{result:value} as any};
      }catch(error) {
        const message=error instanceof Error?error.message:String(error);
        const code=error instanceof StorageError?error.code:error instanceof z.ZodError?'INVALID_ARGUMENT':/PATH_CONFLICT|UNIQUE constraint failed: (?:records|folders)\./.test(message)?'PATH_CONFLICT':/FOREIGN KEY constraint failed/.test(message)?'REFERENTIAL_CONFLICT':'OPERATION_FAILED';
        const retryable=['VERSION_CONFLICT','METADATA_CONFLICT','SNAPSHOT_CHANGED'].includes(code);
        const details=error instanceof z.ZodError?error.issues.map(issue=>({path:issue.path.join('.'),message:issue.message})):undefined;
        const body={code,message,retryable,...(details?{details}:{})};
        return {content:[{type:'text' as const,text:JSON.stringify(body)}],structuredContent:body,isError:true};
      }
    });
  };
  register('browse',z.object({folderId:uuid.nullable().describe('Folder UUID; omit or null to browse root.').optional(),limit,cursor:pageCursor}),false,
    (x)=>store.browse(env,x.folderId??null,x.limit,x.cursor));
  register('resolve_path',z.object({path:z.string().startsWith('/').max(2048).describe('Absolute Recalloom virtual path such as /Notes/Example/note.md, not a local disk path.')}),false,
    (x)=>store.resolvePath(env,x.path));
  register('create_folder',z.object({name:z.string().min(1).max(180),parentId:uuid.nullable().optional(),description:z.string().max(5000).optional()}),true,
    (x)=>store.createFolder(env,x.name,x.parentId??null,x.description,actor));
  register('manage_folder',z.object({
    id:uuid,name:z.string().min(1).max(180).optional(),
    parentId:uuid.nullable().optional(),description:z.string().max(5000).optional(),expectedMetadataRevision:expectedMetadataRevision.optional()
  }),true,(x)=>store.manageFolder(env,x.id,x,actor));
  register('create_record',z.object({name:z.string().min(1).max(180),folderId:uuid.nullable().optional(),kind:z.enum(['document','task_list']).optional(),content:z.string().max(500000).optional(),description:z.string().max(5000).optional(),tags:z.array(z.string().min(1).max(64)).max(32).optional()}),true,
    (x)=>store.createRecord(env,x,actor));
  register('read_record',z.object({id:uuid,revision:z.number().int().positive().optional(),metadataOnly:z.boolean().optional(),lineStart:z.number().int().positive().optional(),maxLines:z.number().int().min(1).max(2000).optional()}),false,
    (x)=>store.readRecord(env,x.id,x));
  register('edit_record',editSchema,true,
    async (x:z.infer<typeof editSchema>)=>{
      const row=await store.getRecord(env,x.id);
      return store.editRecord(env,x.id,x.expectedRevision,mappedEdit(x,row.content),x.message??'Edited',actor,x.dryRun??false);
    });
  register('manage_record',z.object({id:uuid,name:z.string().max(180).optional(),folderId:uuid.nullable().optional(),status:statuses.optional(),description:z.string().max(5000).optional(),expectedMetadataRevision:expectedMetadataRevision.optional()}),true,
    (x)=>store.updateMeta(env,x.id,x,actor));
  register('tag_record',z.object({id:uuid,tag:z.string().min(1).max(64),action:z.enum(['add','remove'])}),true,
    (x)=>store.tagRecord(env,x.id,x.tag,x.action,actor));
  register('list_tasks',z.object({
    recordId:uuid.describe('Task-list record UUID; omit for all active task lists.').optional(),status:taskStatuses.describe('Task status filter.').optional(),limit,cursor:pageCursor
  }),false,(x)=>store.getTasks(env,x.recordId,x.status,x.limit,x.cursor));
  register('mutate_task',z.object({
    action:z.enum(['add','update','remove']).describe('Add a new task, update an existing one, or remove a task.'),recordId:uuid,taskId:uuid.describe('Task UUID, required for update/remove; omit for add.').optional(),
    expectedRevision,changes:taskFields.optional()
  }),true,(x)=>store.taskOperation(env,x.recordId,x.expectedRevision,x.action,x.taskId,x.changes??{},actor));
  register('version_history',z.object({id:uuid,limit,cursor:z.number().int().positive().describe('Older revision from page.nextCursor; omit for latest revisions.').optional()}),false,
    (x)=>store.listVersions(env,x.id,x.limit,x.cursor));
  register('restore_record',z.object({id:uuid,targetRevision:z.number().int().positive().describe('Historical revision to restore as a new current revision.'),expectedRevision}),true,
    (x)=>store.restoreRecord(env,x.id,x.targetRevision,x.expectedRevision,actor));
  register('changes',z.object({cursor:z.number().int().nonnegative().describe('Last processed change seq (start at 0, then page.nextCursor).').optional(),limit}),false,
    (x)=>store.changesSince(env,x.cursor,x.limit));
  register('search',z.object({
    query:z.string().min(1).max(4000).describe('Query text, title terms, or a natural-language question.'),mode:z.enum(['metadata','literal','semantic','hybrid','auto']).describe('metadata: names/descriptions; literal: exact substring; semantic: vectors; hybrid/auto: combined.').optional(),
    folderId:uuid.optional(),tag:z.string().max(64).optional(),status:statuses.optional(),limit:z.number().int().min(1).max(30).optional(),
    minScore:z.number().min(0).max(1).describe('Raw semantic similarity threshold, default 0.43; unrelated to lexical search.').optional()
  }),false,async (x)=>{const {results,...rest}=await search(env,x);return {...rest,items:results,page:{hasMore:false,nextCursor:null}};});
  register('index_diagnostics',z.object({}),false,
    async()=>{const [counts,failures]=await Promise.all([
      env.DB.prepare("SELECT state,COUNT(*) AS count, SUM(CASE WHEN state='running' AND (started_at IS NULL OR started_at<?) THEN 1 ELSE 0 END) AS stale FROM index_jobs GROUP BY state")
        .bind(new Date(Date.now()-5*60*1000).toISOString()).all(),
      env.DB.prepare("SELECT id,record_id,revision,attempts,last_error,started_at FROM index_jobs WHERE state='failed' ORDER BY created_at DESC LIMIT 10").all()
    ]);return {counts:counts.results,recentFailures:failures.results};});
  register('index_pending',z.object({limit:z.number().int().min(1).max(10).optional()}),true,
    (x)=>processIndexJobs(env,x.limit??3));
  register('read_many',
    z.object({items:z.array(z.object({id:uuid,revision:z.number().int().positive().optional(),offsetChars:z.number().int().nonnegative().describe('Zero-based UTF-16 character offset from previous item.nextOffsetChars.').optional()})).min(1).max(12),maxChars:z.number().int().min(1000).max(60000).describe('Shared JSON output character budget across records.').optional()}),false,
    (x)=>agent.readMany(env,x.items,x.maxChars));
  register('diff_revisions',
    z.object({id:uuid,fromRevision:z.number().int().positive(),toRevision:z.number().int().positive()}),false,
    (x)=>agent.diffRevisions(env,x.id,x.fromRevision,x.toRevision));
  register('list_tags',
    z.object({limit:z.number().int().min(1).max(200).optional(),cursor:pageCursor}),false,
    (x)=>agent.listTags(env,x.limit,x.cursor));
  register('list_links',
    z.object({id:uuid,cursor:pageCursor}),false,(x)=>agent.links(env,x.id,'list',undefined,undefined,actor,x.cursor));
  register('manage_link',
    z.object({id:uuid,action:z.enum(['add','remove']),targetId:uuid,relation:z.string().min(1).max(64).optional()}),true,
    (x)=>agent.links(env,x.id,x.action,x.targetId,x.relation,actor));
  register('get_overview',
    z.object({folderId:uuid.nullable().optional(),depth:z.number().int().min(0).max(5).describe('Descendant folder depth, 0 = selected folder only.').optional(),budget:z.number().int().min(1000).max(30000).describe('Shared character budget for record excerpts and open tasks.').optional(),cursor:pageCursor}),false,
    (x)=>agent.getOverview(env,x.folderId??null,x.depth,x.budget,x.cursor));
  register('get_outline',
    z.object({id:uuid,revision:z.number().int().positive().optional(),limit:z.number().int().min(1).max(200).optional(),cursor:z.number().int().nonnegative().describe('Zero-based heading index from page.nextCursor; omit to start.').optional()}),false,
    (x)=>agent.getOutline(env,x.id,x.revision,x.limit,x.cursor));
  register('export_snapshot',
    z.object({cursor:z.string().nullable().describe('Export page.nextCursor from the previous page; omit to start.').optional(),limit:z.number().int().min(1).max(5).describe('Maximum record entries in a backup page.').optional()}),false,
    (x)=>agent.exportSnapshot(env,x.cursor??null,x.limit));
  register('import_snapshot',
    z.object({bundle:z.unknown().describe('Complete recalloom-snapshot-v2 object shaped {pages:[...all pages...]}; not a single page.'),dryRun:z.boolean().describe('Defaults to true. Only false performs the atomic restore.').optional()}),true,
    (x)=>agent.importSnapshot(env,x.bundle,x.dryRun??true,actor));
  return mcp;
}
