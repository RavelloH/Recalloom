import { McpServer } from '@modelcontextprotocol/server';
import {getTag,queryTags} from './tags/catalog.js';
import {assignTag,createTag,updateTag,tagImpact,mergeTag,deleteTag} from './tags/mutations.js';
import {queryTaggedRecords} from './tags/records.js';
import {tagColors,tagIdPattern} from './tag-model.js';
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
import {indexOverview,retryIndex} from './index-observability.js';
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
const tagId=z.string().regex(tagIdPattern);
const tagFields={name:z.string().min(1).max(64),description:z.string().max(2000).optional(),color:z.enum(tagColors).optional(),aliases:z.array(z.string().min(1).max(64)).optional()};
const manageTagSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),...tagFields}).strict(),
 z.object({action:z.literal('update'),id:tagId,...tagFields,expectedMetadataRevision}).strict(),
 z.object({action:z.literal('merge'),id:tagId,targetId:tagId,dryRun:z.boolean().optional(),expectedMetadataRevision:expectedMetadataRevision.optional(),expectedTargetRevision:z.number().int().positive().optional(),expectedCatalogVersion:z.number().int().nonnegative().optional()}).strict(),
 z.object({action:z.literal('delete'),id:tagId,dryRun:z.boolean().optional(),expectedMetadataRevision:expectedMetadataRevision.optional(),expectedCatalogVersion:z.number().int().nonnegative().optional()}).strict()
]).superRefine((value,ctx)=>{
 if((value.action==='merge'||value.action==='delete')&&value.dryRun===false){
  if(value.expectedMetadataRevision===undefined||value.expectedCatalogVersion===undefined||value.action==='merge'&&value.expectedTargetRevision===undefined)ctx.addIssue({code:'custom',message:'Execution requires metadata revisions and the catalogVersion from a fresh dryRun'});
 }
});
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
// Schemas are immutable and shared. Auth, actors and handlers remain request-scoped.
const toolSchemas={
  get_help:z.object({
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
  }),
  browse:z.object({folderId:uuid.nullable().describe('Folder UUID; omit or null to browse root.').optional(),limit,cursor:pageCursor}),
  resolve_path:z.object({path:z.string().startsWith('/').max(2048).describe('Absolute Recalloom virtual path such as /Notes/Example/note.md, not a local disk path.')}),
  create_folder:z.object({name:z.string().min(1).max(180),parentId:uuid.nullable().optional(),description:z.string().max(5000).optional()}),
  manage_folder:z.object({
    id:uuid,name:z.string().min(1).max(180).optional(),
    parentId:uuid.nullable().optional(),description:z.string().max(5000).optional(),expectedMetadataRevision
  }),
  delete_folder:z.object({
    id:uuid,expectedMetadataRevision,
    dryRun:z.boolean().describe('Default true; inspect an entire subtree before deleting folders and archiving records.').optional(),
    previewToken:z.string().regex(/^[a-f0-9]{64}$/).describe('Exact previewToken from the preceding dryRun. Required to execute.').optional()
  }),
  create_record:z.object({name:z.string().min(1).max(180),folderId:uuid.nullable().optional(),kind:z.enum(['document','task_list']).optional(),content:z.string().max(500000).optional(),description:z.string().max(5000).optional(),tags:z.array(z.string().min(1).max(64)).max(32).optional()}),
  read_record:z.object({id:uuid,revision:z.number().int().positive().optional(),metadataOnly:z.boolean().optional(),lineStart:z.number().int().positive().optional(),maxLines:z.number().int().min(1).max(2000).optional()}),
  manage_record:z.object({id:uuid,name:z.string().max(180).optional(),folderId:uuid.nullable().optional(),status:statuses.optional(),description:z.string().max(5000).optional(),expectedMetadataRevision}),
  list_archived:z.object({
    limit,cursor:pageCursor,query:z.string().max(200).describe('Optional archived name or original-path substring.').optional()
  }),
  delete_archived_record:z.object({
    id:uuid,expectedMetadataRevision,expectedRevision,
    dryRun:z.boolean().describe('Defaults to true: preview permanent deletion impact. false deletes all content and history irreversibly.').optional()
  }),
  tag_record:z.object({id:uuid,tag:z.string().min(1).max(64).optional(),tagId:tagId.optional(),action:z.enum(['add','remove']),expectedMetadataRevision}).strict().refine(value=>Boolean(value.tag)!==Boolean(value.tagId),'Choose tag or tagId'),
  get_tag:z.object({id:tagId}).strict(),
  manage_tag:manageTagSchema,
  query_tag_records:z.object({tagIds:z.array(tagId).min(1).max(32),match:z.enum(['all','any']).optional(),status:z.enum(['active','archived','all']).optional(),kind:z.enum(['document','task_list']).optional(),query:z.string().max(200).optional(),limit,cursor:pageCursor}).strict(),
  query_tasks:z.object({
    recordId:uuid.optional(),folderId:uuid.describe('Folder subtree; cannot be combined with recordId.').optional(),query:z.string().max(200).optional(),
    statuses:z.array(taskStatuses).max(5).describe('Selected workflow states; omitted means all five, [] means none.').optional(),
    order:z.enum(['manual','updated']).describe('Default manual: the same global order used by every task view. updated sorts by most recently edited.').optional(),limit,cursor:pageCursor
  }).strict().refine(x=>!(x.recordId&&x.folderId),'Choose recordId or folderId'),
  read_tasks:z.object({ids:z.array(uuid).min(1).max(100).describe('Exact task UUIDs; returns full details, owner metadata, revisions and the current order version. Missing IDs are reported separately.')}).strict(),
  mutate_tasks:z.object({
    requestId:z.string().min(1).max(100).describe('Unique idempotency key. Retrying identical input returns its original result; never reuse it for different input.'),
    expectedRevisions:z.record(z.string().uuid(),z.number().int().positive()).describe('Current content revisions for all involved task lists, including source, placement anchors/scopes, and both owners of a transfer. Pure place operations do not create content revisions.'),
    expectedOrderVersion:z.number().int().nonnegative().describe('Current orderVersion from query_tasks/read_tasks. Required for placement; conflicts apply nothing.').optional(),
    operations:z.array(taskMutation).min(1).max(50).describe('Sequential operations applied in one atomic transaction. A content-changing list receives one revision for the entire batch.')
  }).strict(),
  version_history:z.object({id:uuid,limit,cursor:z.number().int().positive().describe('Older revision from page.nextCursor; omit for latest revisions.').optional()}),
  restore_record:z.object({id:uuid,targetRevision:z.number().int().positive().describe('Historical revision to restore as a new current revision.'),expectedRevision}),
  changes:z.object({cursor:z.number().int().nonnegative().describe('Last processed change seq (start at 0, then page.nextCursor).').optional(),limit}),
  search:z.object({
    query:z.string().min(1).max(4000).describe('Query text, title terms, or a natural-language question.'),mode:z.enum(['metadata','literal','semantic','hybrid','auto']).describe('metadata: names/descriptions; literal: exact substring; semantic: vectors; hybrid/auto: combined.').optional(),
    folderId:uuid.optional(),tag:z.string().max(64).optional(),status:statuses.optional(),limit:z.number().int().min(1).max(30).optional(),
    minScore:z.number().min(0).max(1).describe('Raw semantic similarity threshold, default 0.68 for Gemma 512; candidate relevance only, not answer confidence.').optional()
  }),
  index_diagnostics:z.object({}),
  index_pending:z.object({limit:z.number().int().min(1).max(10).optional(),recordId:uuid.describe('Retry this record only; resets backoff and attempts.').optional(),rebuild:z.boolean().describe('Required true to rebuild an already completed index.').optional()}).refine(x=>!x.rebuild||Boolean(x.recordId),{message:'rebuild requires recordId'}),
  read_many:z.object({items:z.array(z.object({id:uuid,revision:z.number().int().positive().optional(),offsetChars:z.number().int().nonnegative().describe('Zero-based UTF-16 character offset from previous item.nextOffsetChars.').optional()})).min(1).max(12),maxChars:z.number().int().min(1000).max(60000).describe('Shared JSON output character budget across records.').optional()}),
  diff_revisions:z.object({id:uuid,fromRevision:z.number().int().positive(),toRevision:z.number().int().positive()}),
  list_tags:z.object({limit:z.number().int().min(1).max(200).optional(),cursor:pageCursor,query:z.string().max(200).optional(),usage:z.enum(['all','active','archived','unused']).optional(),sort:z.enum(['name','count','updated']).optional()}),
  list_links:z.object({id:uuid,cursor:pageCursor}),
  related_records:z.object({id:uuid,semantic:z.boolean().describe('Include Vectorize semantic candidates (default true); false returns only confirmed links.').optional(),limit:z.number().int().min(1).max(25).describe('Maximum semantic candidates (1–25).').optional()}),
  get_knowledge_graph:z.object({focusId:uuid.describe('Center the graph around one record; omit to show a recent-knowledge subgraph.').optional(),limit:z.number().int().min(10).max(100).optional(),semantic:z.boolean().describe('Include semantic candidates (default true). Overview samples up to six indexed records and limits semantic degree to four per node.').optional()}),
  manage_link:z.object({id:uuid,action:z.enum(['add','remove']),targetId:uuid,relation:z.string().min(1).max(64).optional()}),
  get_overview:z.object({folderId:uuid.nullable().optional(),depth:z.number().int().min(0).max(5).describe('Descendant folder depth, 0 = selected folder only.').optional(),budget:z.number().int().min(1000).max(30000).describe('Shared character budget for record excerpts and open tasks.').optional(),cursor:pageCursor}),
  get_outline:z.object({id:uuid,revision:z.number().int().positive().optional(),limit:z.number().int().min(1).max(200).optional(),cursor:z.number().int().nonnegative().describe('Zero-based heading index from page.nextCursor; omit to start.').optional()}),
  export_snapshot:z.object({cursor:z.string().nullable().describe('Export page.nextCursor from the previous page; omit to start.').optional(),limit:z.number().int().min(1).max(5).describe('Maximum record entries in a backup page.').optional()}),
  import_snapshot:z.object({bundle:z.unknown().describe('Complete recalloom-snapshot-v4 object shaped {pages:[...all pages...]}; v2/v3 bundles remain importable. Supply every page.'),dryRun:z.boolean().describe('Defaults to true. Only false performs the atomic restore.').optional()})
};

// The SDK creates a fresh server per HTTP request. Reuse discovery projections
// as well as validators, instead of converting every schema again per server.
const inputSchemas=new Map<z.ZodTypeAny,unknown>([...Object.values(toolSchemas),editSchema].map(schema=>{
  const json=z.toJSONSchema(schema,{io:'input',target:'draft-2020-12'});
  return [schema,{'~standard':{...schema['~standard'],jsonSchema:{...schema['~standard'].jsonSchema,input:()=>json}}}];
}));

type ToolDefinition={schema:z.ZodTypeAny;write:boolean;action:(env:Env,actor:string,input:any)=>Promise<unknown>};
const toolDefinitions:Record<RecalloomToolName,ToolDefinition>={
  get_help:{schema:toolSchemas.get_help,write:false,action:(env,actor,x)=>Promise.resolve(getHelp(x.topic,{component:x.component,node:x.node,kind:x.kind}))},
  browse:{schema:toolSchemas.browse,write:false,action:(env,actor,x)=>store.browse(env,x.folderId??null,x.limit,x.cursor)},
  resolve_path:{schema:toolSchemas.resolve_path,write:false,action:(env,actor,x)=>store.resolvePath(env,x.path)},
  create_folder:{schema:toolSchemas.create_folder,write:true,action:(env,actor,x)=>store.createFolder(env,x.name,x.parentId??null,x.description,actor)},
  manage_folder:{schema:toolSchemas.manage_folder,write:true,action:(env,actor,x)=>store.manageFolder(env,x.id,x,actor)},
  delete_folder:{schema:toolSchemas.delete_folder,write:true,action:async (env,actor,x)=>x.dryRun===false
    ?lifecycle.deleteFolder(env,x.id,x.expectedMetadataRevision,x.previewToken??'',actor)
    :lifecycle.previewDeleteFolder(env,x.id,x.expectedMetadataRevision)},
  create_record:{schema:toolSchemas.create_record,write:true,action:(env,actor,x)=>store.createRecord(env,x,actor)},
  read_record:{schema:toolSchemas.read_record,write:false,action:(env,actor,x)=>store.readRecord(env,x.id,x)},
  edit_record:{schema:editSchema,write:true,action:async (env,actor,x:z.infer<typeof editSchema>)=>{
      const row=await store.getRecord(env,x.id);
      return store.editRecord(env,x.id,x.expectedRevision,mappedEdit(x,row.content),x.message??'Edited',actor,x.dryRun??false);
    }},
  manage_record:{schema:toolSchemas.manage_record,write:true,action:(env,actor,x)=>store.updateMeta(env,x.id,x,actor)},
  list_archived:{schema:toolSchemas.list_archived,write:false,action:(env,actor,x)=>store.archivedRecords(env,x.limit,x.cursor,x.query)},
  delete_archived_record:{schema:toolSchemas.delete_archived_record,write:true,action:(env,actor,x)=>lifecycle.deleteArchivedRecord(env,x.id,x.expectedMetadataRevision,x.expectedRevision,x.dryRun??true,actor)},
  tag_record:{schema:toolSchemas.tag_record,write:true,action:(env,actor,x)=>assignTag(env,x.id,x,actor)},
  get_tag:{schema:toolSchemas.get_tag,write:false,action:async(env,actor,x)=>({item:await getTag(env,x.id)})},
  query_tag_records:{schema:toolSchemas.query_tag_records,write:false,action:(env,actor,x)=>queryTaggedRecords(env,x)},
  manage_tag:{schema:toolSchemas.manage_tag,write:true,action:(env,actor,x)=>{
   if(x.action==='create')return createTag(env,x,actor);
   if(x.action==='update')return updateTag(env,x.id,x,actor);
   if(x.dryRun!==false)return tagImpact(env,x.id,x.action==='merge'?x.targetId:undefined);
   return x.action==='merge'?mergeTag(env,x.id,x,actor):deleteTag(env,x.id,x,actor);
  }},
  query_tasks:{schema:toolSchemas.query_tasks,write:false,action:async (env,actor,x)=>taskResult(await queryTasks(env,x))},
  read_tasks:{schema:toolSchemas.read_tasks,write:false,action:async (env,actor,x)=>taskResult(await readTasks(env,x.ids))},
  mutate_tasks:{schema:toolSchemas.mutate_tasks,write:true,action:async (env,actor,x)=>taskResult(await mutateTasks(env,x,actor))},
  version_history:{schema:toolSchemas.version_history,write:false,action:(env,actor,x)=>store.listVersions(env,x.id,x.limit,x.cursor)},
  restore_record:{schema:toolSchemas.restore_record,write:true,action:(env,actor,x)=>store.restoreRecord(env,x.id,x.targetRevision,x.expectedRevision,actor)},
  changes:{schema:toolSchemas.changes,write:false,action:(env,actor,x)=>store.changesSince(env,x.cursor,x.limit)},
  search:{schema:toolSchemas.search,write:false,action:async (env,actor,x)=>{const {results,...rest}=await search(env,x);return {...rest,items:results,page:{hasMore:false,nextCursor:null}};}},
  index_diagnostics:{schema:toolSchemas.index_diagnostics,write:false,action:async (env,actor)=>{const [counts,failures,vectorCleanup]=await Promise.all([
      indexOverview(env),
      env.DB.prepare("SELECT id,record_id,revision,indexed_revision,state,stage,attempts,last_error,started_at,next_retry_at,lease_expires_at FROM index_jobs WHERE state IN ('retry','failed') ORDER BY created_at DESC LIMIT 20").all(),
      env.DB.prepare('SELECT record_id AS recordId,state,attempts,last_error AS lastError FROM vector_delete_jobs ORDER BY created_at DESC LIMIT 20').all()
    ]);return {...counts,recentFailures:failures.results,vectorCleanup:vectorCleanup.results};}},
  index_pending:{schema:toolSchemas.index_pending,write:true,action:async (env,actor,x)=>{if(x.recordId)await retryIndex(env,x.recordId,x.rebuild);return {vectorCleanup:await processVectorDeleteJobs(env,x.limit??3),...await processIndexJobs(env,x.limit??3,x.recordId)};}},
  read_many:{schema:toolSchemas.read_many,write:false,action:(env,actor,x)=>agent.readMany(env,x.items,x.maxChars)},
  diff_revisions:{schema:toolSchemas.diff_revisions,write:false,action:(env,actor,x)=>agent.diffRevisions(env,x.id,x.fromRevision,x.toRevision)},
  list_tags:{schema:toolSchemas.list_tags,write:false,action:(env,actor,x)=>queryTags(env,x)},
  list_links:{schema:toolSchemas.list_links,write:false,action:(env,actor,x)=>agent.links(env,x.id,'list',undefined,undefined,actor,x.cursor)},
  related_records:{schema:toolSchemas.related_records,write:false,action:(env,actor,x)=>recordRelations(env,x.id,{semantic:x.semantic!==false,limit:x.limit})},
  get_knowledge_graph:{schema:toolSchemas.get_knowledge_graph,write:false,action:(env,actor,x)=>graphView(env,{focusId:x.focusId,limit:x.limit,semantic:x.semantic!==false})},
  manage_link:{schema:toolSchemas.manage_link,write:true,action:(env,actor,x)=>agent.links(env,x.id,x.action,x.targetId,x.relation,actor)},
  get_overview:{schema:toolSchemas.get_overview,write:false,action:(env,actor,x)=>agent.getOverview(env,x.folderId??null,x.depth,x.budget,x.cursor)},
  get_outline:{schema:toolSchemas.get_outline,write:false,action:(env,actor,x)=>agent.getOutline(env,x.id,x.revision,x.limit,x.cursor)},
  export_snapshot:{schema:toolSchemas.export_snapshot,write:false,action:(env,actor,x)=>agent.exportSnapshot(env,x.cursor??null,x.limit)},
  import_snapshot:{schema:toolSchemas.import_snapshot,write:true,action:(env,actor,x)=>agent.importSnapshot(env,x.bundle,x.dryRun??true,actor)}
};

export function createRecalloomServer(env:Env,scopes:string[],actor='oauth-client',onWrite?:()=>void,requestedTool?:RecalloomToolName) {
  const mcp=new McpServer({name:'recalloom',version:'0.1.0'}, {instructions:SERVER_INSTRUCTIONS,capabilities:{tools:{},resources:{}}});
  // Same canonical Markdown as get_help: MCP clients may discover/read these
  // static resources without accessing D1, Vectorize, or user records.
  for(const doc of requestedTool?[]:listHelpResources()){
    mcp.registerResource('recalloom-help-'+doc.topic,doc.uri,{
      title:doc.title,description:doc.summary,mimeType:'text/markdown'
    },async uri=>{
      if(!scopes.includes('notes:read'))
        throw new StorageError('INSUFFICIENT_SCOPE','Reading help requires notes:read');
      return {contents:[{uri:uri.href,mimeType:'text/markdown',text:doc.content}]};
    });
  }
  const register=(name:RecalloomToolName,schema:z.ZodTypeAny,write:boolean,action:(input:any)=>Promise<unknown>)=>{
    if(requestedTool&&requestedTool!==name)return;
    const guidance=TOOL_GUIDANCE[name];
    mcp.registerTool(name,{
      title:guidance.title,
      description:guidance.description,
      inputSchema:inputSchemas.get(schema) as any,
      // Tool annotations are advisory. Auth scope checks and revision controls remain authoritative.
      annotations:{readOnlyHint:!write,destructiveHint:write&&guidance.destructive,idempotentHint:!write||name==='mutate_tasks'}
    },async (raw:any)=>{
      try {
        if(!scopes.includes('notes:read')||(write&&!scopes.includes('notes:write')))
          throw new StorageError('INSUFFICIENT_SCOPE','This operation requires notes:'+ (write?'write':'read'));
        const data=schema.parse(raw);
        const value=await action(data);
        if(write)onWrite?.();
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
  for(const name of requestedTool?[requestedTool]:Object.keys(toolDefinitions) as RecalloomToolName[]){
    const definition=toolDefinitions[name];
    register(name,definition.schema,definition.write,input=>definition.action(env,actor,input));
  }
  return mcp;
}
