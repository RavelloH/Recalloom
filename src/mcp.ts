import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Env, EditInput } from './types.js';
import { StorageError } from './types.js';
import * as store from './storage.js';
import * as lifecycle from './lifecycle.js';
import * as agent from './agent-tools.js';
import {queryTasks,readTasks} from './storage/tasks.js';
import {mutateTasks} from './storage/task-mutations.js';
import { processIndexJobs, search } from './search.js';
import {processVectorDeleteJobs} from './lifecycle.js';
import {recordRelations,graphView} from './graph.js';
import { SERVER_INSTRUCTIONS, TOOL_GUIDANCE, type RecalloomToolName } from './mcp-guidance.js';
import {getHelp,listHelpResources,HELP_TOPICS,RMD_COMPONENT_NAMES,RMD_NODE_NAMES,type HelpTopic} from './help/index.js';

const uuid=z.string().uuid().describe('Stable record/folder UUID returned by browse, search, or resolve_path.');
const limit=z.number().int().min(1).max(200).describe('Maximum items per page (1–200).').optional();
const pageCursor=z.string().max(4096).describe('Opaque page.nextCursor from the previous response. Omit on the first page; never construct it.').optional();
const expectedRevision=z.number().int().positive().describe('Current revision from read_record; prevents overwriting concurrent edits.');
const expectedMetadataRevision=z.number().int().positive().describe('Current metadataRevision from browse or read_record; prevents concurrent metadata overwrites.');
const statuses=z.enum(['draft','active','completed','superseded','archived']);
const taskStatuses=z.enum(['todo','in_progress','blocked','done','cancelled']);
const taskFields=z.object({
  title:z.string().trim().min(1).max(500).optional(),details:z.string().max(50000).describe('Task details, acceptance criteria and progress evidence.').optional(),
  status:taskStatuses.describe('Current task workflow state.').optional()
}).strict();
const taskScope=z.object({recordId:uuid.optional(),status:taskStatuses.optional()}).strict();
const taskRef=z.string().min(1).max(100).describe('Existing task UUID, or the clientId of a create earlier in this batch.');
const taskMutation=z.discriminatedUnion('op',[
  z.object({op:z.literal('create'),recordId:uuid,title:z.string().trim().min(1).max(500),details:z.string().max(50000).optional(),status:taskStatuses.optional(),clientId:z.string().min(1).max(100).optional()}).strict(),
  z.object({op:z.literal('update'),taskId:taskRef,changes:taskFields.refine(x=>Object.keys(x).length>0,'Provide at least one changed field')}).strict(),
  z.object({op:z.literal('delete'),taskId:taskRef}).strict(),
  z.object({op:z.literal('place'),taskId:taskRef,beforeTaskId:taskRef.nullable().describe('Place before this task in the global order. null means the end of scope; an empty scope appends globally.'),scope:taskScope.optional()}).strict(),
  z.object({op:z.literal('transfer'),taskId:taskRef,targetRecordId:uuid.describe('New owning task-list UUID. Preserves the task UUID and global order.')}).strict()
]);
// Legacy priority and JSON array positions are internal historical fields.
const taskResult=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(taskResult);
  if(!value||typeof value!=='object')return value;
  const row=value as Record<string,unknown>;
  return Object.fromEntries(Object.entries(row)
    .filter(([key])=>key!=='priority'&&!(key==='position'&&'boardPosition'in row))
    .map(([key,item])=>[key==='boardPosition'?'position':key,taskResult(item)]));
};
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
  // Same canonical Markdown as get_help: MCP clients may discover/read these
  // static resources without accessing D1, Vectorize, or user records.
  for(const doc of listHelpResources()){
    mcp.registerResource('recalloom-help-'+doc.topic,doc.uri,{
      title:doc.title,description:doc.summary,mimeType:'text/markdown'
    },async uri=>{
      if(!scopes.includes('notes:read'))
        throw new StorageError('INSUFFICIENT_SCOPE','Reading help requires notes:read');
      return {contents:[{uri:uri.href,mimeType:'text/markdown',text:doc.content}]};
    });
  }
  const register=(name:RecalloomToolName,schema:z.ZodTypeAny,write:boolean,action:(input:any)=>Promise<unknown>)=>{
    const guidance=TOOL_GUIDANCE[name];
    mcp.registerTool(name,{
      title:guidance.title,
      description:guidance.description,
      inputSchema:schema as any,
      // Tool annotations are advisory. Auth scope checks and revision controls remain authoritative.
      annotations:{readOnlyHint:!write,destructiveHint:write&&guidance.destructive,idempotentHint:!write||name==='mutate_tasks'}
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
        const retryable=['VERSION_CONFLICT','METADATA_CONFLICT','TASK_ORDER_CONFLICT','ORDER_VERSION_CONFLICT','SNAPSHOT_CHANGED'].includes(code);
        const details=error instanceof z.ZodError?error.issues.map(issue=>({path:issue.path.join('.'),message:issue.message})):error instanceof StorageError?error.details:undefined;
        const body={code,message,retryable,...(details?{details}:{})};
        return {content:[{type:'text' as const,text:JSON.stringify(body)}],structuredContent:body,isError:true};
      }
    });
  };
  register('get_help',z.object({
    topic:z.enum(HELP_TOPICS as [HelpTopic,...HelpTopic[]]).optional()
      .describe('Help topic; omit for topic index.'),
    component:z.enum(RMD_COMPONENT_NAMES as [string,...string[]]).optional()
      .describe('A valid RMD component, e.g. badge, tabs, mark or link-card. Returns its schema-generated syntax and parameters.'),
    kind:z.enum(['inline','block','leaf']).optional()
      .describe('Select a component form, e.g. inline or block Mark.'),
    node:z.enum(RMD_NODE_NAMES as [string,...string[]]).optional()
      .describe('Markdown node for @ attrs: heading, paragraph, image, math, table, code.')
  }).strict().superRefine((input,ctx)=>{
    if((input.component||input.node)&&input.topic&&input.topic!=='markdown')
      ctx.addIssue({code:'custom',message:'component/node requires topic markdown',path:['topic']});
    if(input.component&&input.node)
      ctx.addIssue({code:'custom',message:'Choose either component or node',path:['node']});
    if(input.kind&&!input.component)
      ctx.addIssue({code:'custom',message:'kind requires component',path:['kind']});
  }),false,(x)=>Promise.resolve(getHelp(x.topic,{component:x.component,node:x.node,kind:x.kind})));
  register('browse',z.object({folderId:uuid.nullable().describe('Folder UUID; omit or null to browse root.').optional(),limit,cursor:pageCursor}),false,
    (x)=>store.browse(env,x.folderId??null,x.limit,x.cursor));
  register('resolve_path',z.object({path:z.string().startsWith('/').max(2048).describe('Absolute Recalloom virtual path such as /Notes/Example/note.md, not a local disk path.')}),false,
    (x)=>store.resolvePath(env,x.path));
  register('create_folder',z.object({name:z.string().min(1).max(180),parentId:uuid.nullable().optional(),description:z.string().max(5000).optional()}),true,
    (x)=>store.createFolder(env,x.name,x.parentId??null,x.description,actor));
  register('manage_folder',z.object({
    id:uuid,name:z.string().min(1).max(180).optional(),
    parentId:uuid.nullable().optional(),description:z.string().max(5000).optional(),expectedMetadataRevision
  }),true,(x)=>store.manageFolder(env,x.id,x,actor));
  register('delete_folder',z.object({
    id:uuid,expectedMetadataRevision,
    dryRun:z.boolean().describe('Default true; inspect an entire subtree before deleting folders and archiving records.').optional(),
    previewToken:z.string().regex(/^[a-f0-9]{64}$/).describe('Exact previewToken from the preceding dryRun. Required to execute.').optional()
  }),true,async(x)=>x.dryRun===false
    ?lifecycle.deleteFolder(env,x.id,x.expectedMetadataRevision,x.previewToken??'',actor)
    :lifecycle.previewDeleteFolder(env,x.id,x.expectedMetadataRevision));
  register('create_record',z.object({name:z.string().min(1).max(180),folderId:uuid.nullable().optional(),kind:z.enum(['document','task_list']).optional(),content:z.string().max(500000).optional(),description:z.string().max(5000).optional(),tags:z.array(z.string().min(1).max(64)).max(32).optional()}),true,
    (x)=>store.createRecord(env,x,actor));
  register('read_record',z.object({id:uuid,revision:z.number().int().positive().optional(),metadataOnly:z.boolean().optional(),lineStart:z.number().int().positive().optional(),maxLines:z.number().int().min(1).max(2000).optional()}),false,
    (x)=>store.readRecord(env,x.id,x));
  register('edit_record',editSchema,true,
    async (x:z.infer<typeof editSchema>)=>{
      const row=await store.getRecord(env,x.id);
      return store.editRecord(env,x.id,x.expectedRevision,mappedEdit(x,row.content),x.message??'Edited',actor,x.dryRun??false);
    });
  register('manage_record',z.object({id:uuid,name:z.string().max(180).optional(),folderId:uuid.nullable().optional(),status:statuses.optional(),description:z.string().max(5000).optional(),expectedMetadataRevision}),true,
    (x)=>store.updateMeta(env,x.id,x,actor));
  register('list_archived',z.object({
    limit,cursor:pageCursor,query:z.string().max(200).describe('Optional archived name or original-path substring.').optional()
  }),false,(x)=>store.archivedRecords(env,x.limit,x.cursor,x.query));
  register('delete_archived_record',z.object({
    id:uuid,expectedMetadataRevision,expectedRevision,
    dryRun:z.boolean().describe('Defaults to true: preview permanent deletion impact. false deletes all content and history irreversibly.').optional()
  }),true,(x)=>lifecycle.deleteArchivedRecord(env,x.id,x.expectedMetadataRevision,x.expectedRevision,x.dryRun??true,actor));
  register('tag_record',z.object({id:uuid,tag:z.string().min(1).max(64),action:z.enum(['add','remove'])}),true,
    (x)=>store.tagRecord(env,x.id,x.tag,x.action,actor));
  register('query_tasks',z.object({
    recordId:uuid.optional(),folderId:uuid.describe('Folder subtree; cannot be combined with recordId.').optional(),query:z.string().max(200).optional(),
    statuses:z.array(taskStatuses).max(5).describe('Selected workflow states; omitted means all five, [] means none.').optional(),
    order:z.enum(['manual','updated']).describe('Default manual: the same global order used by every task view. updated sorts by most recently edited.').optional(),limit,cursor:pageCursor
  }).strict().refine(x=>!(x.recordId&&x.folderId),'Choose recordId or folderId'),false,async(x)=>taskResult(await queryTasks(env,x)));
  register('read_tasks',z.object({ids:z.array(uuid).min(1).max(100).describe('Exact task UUIDs; returns full details, owner metadata, revisions and the current order version. Missing IDs are reported separately.')}).strict(),false,
    async(x)=>taskResult(await readTasks(env,x.ids)));
  register('mutate_tasks',z.object({
    requestId:z.string().min(1).max(100).describe('Unique idempotency key. Retrying identical input returns its original result; never reuse it for different input.'),
    expectedRevisions:z.record(z.string().uuid(),z.number().int().positive()).describe('Current content revisions for all involved task lists, including source, placement anchors/scopes, and both owners of a transfer. Pure place operations do not create content revisions.'),
    expectedOrderVersion:z.number().int().nonnegative().describe('Current orderVersion from query_tasks/read_tasks. Required for placement; conflicts apply nothing.').optional(),
    operations:z.array(taskMutation).min(1).max(50).describe('Sequential operations applied in one atomic transaction. A content-changing list receives one revision for the entire batch.')
  }).strict(),true,async(x)=>taskResult(await mutateTasks(env,x,actor)));
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
    async()=>{const [counts,failures,vectorCleanup]=await Promise.all([
      env.DB.prepare("SELECT state,COUNT(*) AS count, SUM(CASE WHEN state='running' AND (started_at IS NULL OR started_at<?) THEN 1 ELSE 0 END) AS stale FROM index_jobs GROUP BY state")
        .bind(new Date(Date.now()-5*60*1000).toISOString()).all(),
      env.DB.prepare("SELECT id,record_id,revision,attempts,last_error,started_at FROM index_jobs WHERE state='failed' ORDER BY created_at DESC LIMIT 10").all(),
      env.DB.prepare('SELECT record_id AS recordId,state,attempts,last_error AS lastError FROM vector_delete_jobs ORDER BY created_at DESC LIMIT 20').all()
    ]);return {counts:counts.results,recentFailures:failures.results,vectorCleanup:vectorCleanup.results};});
  register('index_pending',z.object({limit:z.number().int().min(1).max(10).optional()}),true,
    async(x)=>({vectorCleanup:await processVectorDeleteJobs(env,x.limit??3),...await processIndexJobs(env,x.limit??3)}));
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
  register('related_records',
    z.object({id:uuid,semantic:z.boolean().describe('Include Vectorize semantic candidates (default true); false returns only confirmed links.').optional(),limit:z.number().int().min(1).max(25).describe('Maximum semantic candidates (1–25).').optional()}),false,
    (x)=>recordRelations(env,x.id,{semantic:x.semantic!==false,limit:x.limit}));
  register('get_knowledge_graph',
    z.object({focusId:uuid.describe('Center the graph around one record; omit to show a recent-knowledge subgraph.').optional(),limit:z.number().int().min(10).max(100).optional(),semantic:z.boolean().describe('Include semantic neighbours only when focusId is provided.').optional()}),false,
    (x)=>graphView(env,{focusId:x.focusId,limit:x.limit,semantic:x.semantic!==false}));
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
    z.object({bundle:z.unknown().describe('Complete recalloom-snapshot-v3 object shaped {pages:[...all pages...]}; v2 bundles remain importable. Supply every page.'),dryRun:z.boolean().describe('Defaults to true. Only false performs the atomic restore.').optional()}),true,
    (x)=>agent.importSnapshot(env,x.bundle,x.dryRun??true,actor));
  return mcp;
}
