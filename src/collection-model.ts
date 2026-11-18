import { z } from 'zod';
import { tagIdPattern } from './tag-model.js';

export const collectionTaskStatuses = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export const collectionDescription = z.string().trim().max(1200);
const scopeName = z.string().trim().min(1).max(512);
const folderInput = z.string().trim().max(512).transform(value => value === '' || value === '/' ? undefined : value).optional();
const tagName = z.string().trim().min(1).max(64);
const keyword = z.string().trim().min(1).max(200).optional();
const folder = z.object({ id: z.string().uuid(), name: scopeName }).strict();
const tag = z.object({ id: z.string().regex(tagIdPattern), name: tagName }).strict();

const docFields = {
  keyword,
  topic: keyword,
  updatedWithinDays: z.number().int().min(1).max(3650).optional(),
  archive: z.enum(['active', 'archived', 'all']).default('active'),
  tagMatch: z.enum(['all', 'any']).default('all')
};
const taskFields = { keyword, statuses: z.array(z.enum(collectionTaskStatuses)).min(1).max(5).optional() };

export const collectionDraftSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('document'), ...docFields, folder: folderInput, tags: z.array(tagName).max(8).optional() }).strict(),
  z.object({ target: z.literal('task'), ...taskFields, folder: folderInput, taskList: scopeName.optional() }).strict()
]);
export const collectionRuleSchema = z.discriminatedUnion('target', [
  z.object({ version: z.literal(1), target: z.literal('document'), ...docFields, folder: folder.optional(), tags: z.array(tag).max(8).optional() }).strict(),
  z.object({ version: z.literal(1), target: z.literal('task'), ...taskFields, folder: folder.optional(), taskList: folder.optional() }).strict()
]).superRefine((value, context) => {
  if (value.target === 'task' && value.folder && value.taskList)
    context.addIssue({ code: 'custom', path: ['taskList'], message: '目录与任务列表只能选择一个' });
  if (value.target === 'document' && value.topic && value.archive !== 'active')
    context.addIssue({ code: 'custom', path: ['archive'], message: '语义主题仅支持未归档文稿' });
});
export const collectionInputSchema = z.object({ name: z.string().trim().min(1).max(100), description: collectionDescription.default(''), rule: collectionRuleSchema }).strict();

export type CollectionDraft = z.infer<typeof collectionDraftSchema>;
export type CollectionRule = z.infer<typeof collectionRuleSchema>;
export type DocumentCollectionRule = Extract<CollectionRule, { target: 'document' }>;
export type CollectionInput = z.infer<typeof collectionInputSchema>;
export type CollectionItem = CollectionInput & { id: string; revision: number; updatedAt: string };
export type CollectionHit = { id: string; name: string; location?: string; text?: string; status?: string; updatedAt?: string; taskId?: string; snippetFormat?: 'markdown' | 'text' };
export type CollectionResults = { items: CollectionHit[]; mode: 'filtered' | 'semantic' | 'unavailable'; page: { nextCursor: string | null } };
