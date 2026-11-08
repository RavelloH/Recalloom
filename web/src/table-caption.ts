/** Explicit Markdown table title: a single-line caption immediately after a GFM table.
 *
 * | Column | Value |
 * | ------ | ----- |
 * | A      | 1     |
 *
 * : Table caption {#tbl-parameters}
 *
 * The title and ID remain Markdown source; there is no separate table table or
 * persistent index. The optional presentation number is computed at display.
 */
export type TableCaption={id:string;caption:string};
const idPattern=/^tbl-[a-z][a-z0-9-]{0,63}$/;
export function safeTableId(value:unknown):value is string{
 return typeof value==='string'&&idPattern.test(value);
}
export function cleanTableCaption(raw:unknown):string{
 return String(raw??'').replace(/[\r\n]/g,' ').slice(0,240).trim();
}
export function parseTableCaption(source:string):TableCaption|null{
 if(source.length>360||/[\r\n\u0000-\u001f]/.test(source))return null;
 const m=/^:[ \t]+(.{1,240}?)[ \t]+\{#(tbl-[a-z][a-z0-9-]{0,63})\}[ \t]*$/i.exec(source);
 if(!m)return null;
 const caption=m[1]!.trim(),id=m[2]!.toLowerCase();
 return caption&&safeTableId(id)?{caption,id}:null;
}
export function serializeTableCaption(attrs:{caption?:unknown;tableId?:unknown}):string{
 const id=attrs.tableId,caption=cleanTableCaption(attrs.caption);
 return safeTableId(id)&&caption?': '+caption+' {#'+id+'}':'';
}
