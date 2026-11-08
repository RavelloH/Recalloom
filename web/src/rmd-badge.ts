import {RMD_VARIANTS} from './rmd-schema';

/** The public RMD variant enum is independent of Astryx's visual theme keys.
 * Both preview and the editor must map danger to Astryx error identically.
 */
export const badgeVariants=new Set<string>(RMD_VARIANTS);
export function asAstryBadgeVariant(value:unknown):'neutral'|'info'|'success'|'warning'|'error'{
 const variant=typeof value==='string'&&badgeVariants.has(value)?value:'neutral';
 return variant==='danger'?'error':variant as 'neutral'|'info'|'success'|'warning';
}
