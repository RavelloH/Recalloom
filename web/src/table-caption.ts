import {validCrossRefId} from './cross-reference';

/** RMD @ attrs is the only table caption source syntax.
 * This module validates non-persistent presentation values.
 */
export function safeTableId(value:unknown):value is string{
 return validCrossRefId(value,'tbl');
}
export function cleanTableCaption(raw:unknown):string{
 return String(raw??'').replace(/[\r\n]/g,' ').slice(0,240).trim();
}
