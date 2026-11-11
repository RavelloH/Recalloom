/**
 * Shared element identity must be based on the resource ID, never its editable
 * name. The same document may appear in library, search, and recent results.
 * Prefix ensures a valid CSS <custom-ident> even for numeric IDs.
 */
export type SharedResourceKind = 'record' | 'folder';

export function sharedViewTransitionName(kind: SharedResourceKind, id: string): string {
 return 'rk-' + kind + '-' + Array.from(id, character =>
  /^[a-z\d_-]$/i.test(character) ? character : '_' + character.codePointAt(0)!.toString(16) + '_'
 ).join('');
}
