import { z } from 'zod';
import { collectionDescription, collectionDraftSchema } from './collection-model.js';
import type { Env } from './types.js';
import { StorageError } from './types.js';

export const COLLECTION_MODEL = '@cf/google/gemma-4-26b-a4b-it' as const;
const parseOutput = z.object({ draft: collectionDraftSchema.nullable(), issues: z.array(z.string().trim().min(1).max(120)).max(4).default([]) }).strict();
const instructions = `Convert the description to JSON with keys draft and issues. Every non-null draft MUST have a "target" key: "document" (文稿/文章) or "task" (individual tasks). For mixed or unclear targets return {"draft":null,"issues":["clarify in the user's language"]}.
Both targets allow folder (verbatim name/path) and keyword (explicit literal text to find in title/body). Document fields: topic (semantic topic), tags (array of at most 8 verbatim tag names), tagMatch ("all" default or "any"), updatedWithinDays (1–3650, rolling update windows only), archive ("active" default, "archived", "all"). Topics require active. A tag is always in tags, never keyword.
Task fields: taskList (verbatim name/path, cannot combine with folder), statuses (array of todo,in_progress,blocked,done,cancelled). No task dates. Omit absent fields. List ambiguous or unsupported conditions in issues in the user's language, including negation and due/creation dates. Never invent names or IDs. JSON only.
Example: 文稿，位于 /Guide，标签为「规范」，排除归档 → {"draft":{"target":"document","folder":"/Guide","tags":["规范"],"archive":"active"},"issues":[]}
Example: 进行中或阻塞的任务 → {"draft":{"target":"task","statuses":["in_progress","blocked"]},"issues":[]}`;

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
