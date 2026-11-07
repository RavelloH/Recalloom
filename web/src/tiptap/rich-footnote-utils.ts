export function safeFootnoteId(raw:string):string{
 return raw.replace(/[\r\n\[\]]/g,'').trim().slice(0,128);
}

/** Extract the Markdown body without changing the label or indentation rules.
 * GFM requires continuation lines to be indented four spaces.
 */
export function extractFootnoteBody(fragment:string):string{
 const body=fragment.replace(/^\[\^[^\]\r\n]{1,128}\]:[ \t]*/,'');
 return body.replace(/\n {4}/g,'\n').replace(/\n\t/g,'\n').trim();
}
