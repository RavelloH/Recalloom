/**
 * Browser View Transitions pair old/new snapshots by view-transition-name,
 * not by the React reconciliation key or the navigation event.
 *
 * A resource has one stable identity across detail, folder listing, search
 * and recent results. Keep sidebars unnamed: the same record can appear in
 * both the sidebar and the page, and duplicate names skip the entire transition.
 */
export type SharedResourceKind='record'|'folder';

export function sharedViewTransitionName(kind:SharedResourceKind,id:string):string {
 return 'rk-'+kind+'-'+Array.from(id,character=>
  /^[a-z\d_-]$/i.test(character)?character:'_'+character.codePointAt(0)!.toString(16)+'_'
 ).join('');
}
