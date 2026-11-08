/** Runtime code block properties shared with the presentation layer.
 * Filename/wrap/expand are parsed only from schema-checked RMD @ attrs.
 */
export type CodeMeta={
 id?:string;
 language:string|null;
 filename:string;
 wrap:boolean;
 expand:boolean;
};
