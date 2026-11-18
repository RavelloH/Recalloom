import { z } from 'zod';
import { collectionDescription, collectionDraftSchema } from './collection-model.js';
import type { Env } from './types.js';
import { StorageError } from './types.js';

export const COLLECTION_MODEL = '@cf/google/gemma-4-26b-a4b-it' as const;
const parseOutput = z.object({ draft: collectionDraftSchema.nullable(), issues: z.array(z.string().trim().min(1).max(120)).max(4).default([]) }).strict();
const instructions = `Turn the user's description into compact JSON only: {"draft":{...},"issues":[]}.
One target: "document" or "task" (individual tasks, not lists). If mixed or unclear, use draft:null and explain in the user's language in issues.
Both targets allow optional folder (exact supplied name/path) and keyword (literal text). Document also allows topic (semantic topic), tags (supplied names, at most 8), tagMatch ("all" default or "any"), updatedWithinDays (integer 1–3650, only explicit rolling update windows), archive ("active" default, "archived", "all"). Semantic topic only works with active.
Task also allows taskList (supplied name/path, mutually exclusive with folder), statuses (array from todo,in_progress,blocked,done,cancelled). No task dates. No made-up names or IDs. Omit absent fields. Use issues for ambiguous or unsupported conditions; never silently drop an exclusion or convert due/creation time to update time. No SQL, commentary, or Markdown.`;

function readResponse(value: unknown): string {
  const result = value as { response?: unknown; choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> } | null;
  const choice = result?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new StorageError('COLLECTION_PARSE_INVALID', '描述生成的规则太长，可以缩短描述或手动填写');
  const content = choice?.message?.content ?? result?.response;
  if (typeof content !== 'string' || content.length > 4096) throw new StorageError('COLLECTION_PARSE_INVALID', '未能生成可用规则，可以手动填写');
  return content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
}

export async function parseCollectionDescription(env: Env, input: string) {
  const description = collectionDescription.min(1).parse(input);
  let response: unknown;
  try {
    response = await env.AI.run(COLLECTION_MODEL, {
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: description }],
      chat_template_kwargs: { enable_thinking: false }, max_completion_tokens: 256, temperature: 0
    } as never);
  } catch {
    throw new StorageError('COLLECTION_PARSE_UNAVAILABLE', '暂时无法生成规则，可以手动填写或稍后再试');
  }
  try {
    const parsed = parseOutput.parse(JSON.parse(readResponse(response)));
    if (!parsed.draft && !parsed.issues.length) throw Error('Missing clarification');
    return parsed;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('COLLECTION_PARSE_INVALID', '未能生成可用规则，可以修改描述或手动填写');
  }
}
