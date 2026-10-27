import { TextVersion } from 'text-version';
import { editText } from './edit-text.js';
import type { EditInput } from './types.js';
import { StorageError } from './types.js';

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((n)=>n.toString(16).padStart(2,'0')).join('');
}
export interface VersionBlob { content: string; metadata: string; }
export function initialVersion(content: string): VersionBlob {
  const tv = new TextVersion();
  if(content.includes('\u0000')) throw new StorageError('BINARY_TEXT_UNSUPPORTED');
  tv.commit(content || '\u0000', '1');
  const x = tv.export('separate');
  return { content, metadata: x.metadata };
}
export function nextVersion(old: VersionBlob, content: string, revision: number): VersionBlob {
  if(content.includes('\u0000')) throw new StorageError('BINARY_TEXT_UNSUPPORTED');
  const tv = new TextVersion(old.metadata, old.content || '\u0000');
  tv.commit(content || '\u0000', String(revision));
  const x = tv.export('separate');
  // Latest repeated content can be stored as a reference rather than a snapshot.
  return { content, metadata: x.metadata };
}
export function historicalVersion(current: VersionBlob, revision: number): string {
  const tv = new TextVersion(current.metadata, current.content || '\u0000');
  const content = tv.show(String(revision));
  if (content === null) throw new StorageError('REVISION_NOT_FOUND');
  return content === '\u0000' ? '' : content;
}
export function applyLineChanges(original: string, operations: Extract<EditInput,{mode:'lines'}>['operations']): string {
  const ending = original.includes('\r\n') ? '\r\n' : '\n';
  const normalized = original.replace(/\r\n?/g,'\n');
  const trailing = normalized.endsWith('\n');
  const lines = normalized.length ? normalized.split('\n') : [];
  if (trailing) lines.pop();
  const len = lines.length;
  const intervals: Array<{start: number;end:number;content:string;action:string}> = [];
  for (const op of operations) {
    const start = op.start, end = op.end ?? op.start;
    if (!Number.isInteger(start) || start < 1 || start > len + (op.action === 'insert' ? 1 : 0))
      throw new StorageError('INVALID_LINE_RANGE');
    if (op.action !== 'insert' && (!Number.isInteger(end) || end < start || end > len))
      throw new StorageError('INVALID_LINE_RANGE');
    if (op.action === 'insert' && op.end !== undefined && op.end !== start)
      throw new StorageError('INVALID_LINE_RANGE');
    intervals.push({start, end: op.action === 'insert' ? start-1 : end, content:op.content ?? '',action:op.action});
  }
  const sorted = [...intervals].sort((a,b)=>a.start-b.start || a.end-b.end);
  for (let i=1;i<sorted.length;i++) if (sorted[i]!.start <= sorted[i-1]!.end ||
     (sorted[i]!.start === sorted[i-1]!.start && sorted[i]!.action === 'insert' && sorted[i-1]!.action === 'insert'))
      throw new StorageError('OVERLAPPING_LINE_RANGES');
  for (const op of intervals.sort((a,b)=>b.start-a.start || b.end-a.end)) {
    const items = op.action==='delete' ? [] : op.content.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n');
    if (op.action==='insert') lines.splice(op.start-1,0,...items);
    else lines.splice(op.start-1, op.end-op.start+1, ...items);
  }
  return (lines.join(ending) + (trailing && lines.length ? ending : ''));
}
export function editContent(content: string, input: EditInput): {content:string; replacements:number} {
  if (input.mode === 'lines') return {content:applyLineChanges(content,input.operations),replacements:input.operations.length};
  const result = editText(content,input);
  return {content:result.text,replacements:result.replacements};
}
