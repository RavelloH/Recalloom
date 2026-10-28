import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  MCP_AUTH_SECRET: string;
  WEB_ADMIN_SECRET?: string;
  MCP_BASE_URL?: string;
}
export type RecordKind = 'document' | 'task_list' | 'checkpoint';
export type RecordStatus = 'draft' | 'active' | 'completed' | 'superseded' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export interface StoredRecord {
  id: string;
  folder_id: string | null;
  name: string;
  kind: RecordKind;
  status: RecordStatus;
  description: string;
  created_at: string;
  updated_at: string;
  metadata_revision: number;
  content: string;
  history_metadata: string;
  revision: number;
  content_sha256: string;
}
export interface Task {
  id: string;
  title: string;
  details: string;
  status: TaskStatus;
  priority: number;
}
export type EditInput =
  | { mode: 'replace'; oldText: string; newText: string; expectedReplacements?: number }
  | { mode: 'replace_many'; replacements: Array<{oldText: string;newText: string;expectedReplacements?: number}> }
  | { mode: 'patch'; patch: string }
  | { mode: 'lines'; operations: Array<{action: 'insert' | 'replace' | 'delete'; start: number; end?: number; content?: string}> };

export class StorageError extends Error {
  constructor(public code: string, message = code) { super(message); this.name = 'StorageError'; }
}
