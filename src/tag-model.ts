export const tagIdPattern =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export const tagColors = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'cyan',
  'teal'
] as const;
export type TagColor = (typeof tagColors)[number];
export type TagSummary = {
  id: string;
  name: string;
  color: TagColor;
  metadataRevision: number;
  source?: 'manual' | 'auto';
  reason?: string;
  evidence?: string;
  sourceRevision?: number | null;
  generatedAt?: string | null;
};
export type Tag = TagSummary & {
  kind: 'smart' | 'fixed';
  description: string;
  aliases: string[];
  activeCount: number;
  archivedCount: number;
  count: number;
  createdAt: string;
  updatedAt: string;
};
export type TagSnapshot = {
  id: string;
  name: string;
  kind?: 'smart' | 'fixed';
  // Legacy snapshots are still accepted when importing.
  smartEnabled?: boolean;
  propagate?: boolean;
  description: string;
  color: TagColor;
  metadataRevision: number;
  createdAt: string;
  updatedAt: string;
  aliases: string[];
  mergedInto: string | null;
};
export const normalizeTagKey = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
export const displayTagName = (value: string) => value.trim().replace(/\s+/gu, ' ');

/** Client-side suggestions keep typing independent of server round trips. */
export function tagSimilarity(input: string, candidate: string) {
  const left = normalizeTagKey(input),
    right = normalizeTagKey(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.includes(left) || left.includes(right))
    return (Math.min(left.length, right.length) / Math.max(left.length, right.length)) * 0.4 + 0.5;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++)
      current.push(
        Math.min(
          current[column - 1]! + 1,
          previous[column]! + 1,
          previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1)
        )
      );
    previous = current;
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length);
}
