/**
 * Resource identity is stable across routes, but a name on every text node
 * extracts that text from the page snapshot even when the next page has no
 * matching element. It then vanishes ahead of the page, or leaves floating
 * snapshots over the content crossfade.
 *
 * Route transitions deliberately use ONE atomic content snapshot. Keep the
 * identity helper for a future opt-in to verified, paired transitions; do not
 * turn on broad page/list/heading naming again.
 */
export type SharedResourceKind='record'|'folder';

const ENABLE_PAIRED_RESOURCE_TRANSITIONS=false;

export function resourceViewTransitionIdentity(kind:SharedResourceKind,id:string):string {
 return 'rk-'+kind+'-'+Array.from(id,character=>
  /^[a-z\d_-]$/i.test(character)?character:'_'+character.codePointAt(0)!.toString(16)+'_'
 ).join('');
}

export function sharedViewTransitionName(kind:SharedResourceKind,id:string):string|undefined {
 return ENABLE_PAIRED_RESOURCE_TRANSITIONS?resourceViewTransitionIdentity(kind,id):undefined;
}
