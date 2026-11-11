/** A Markdown document title is its file name without a trailing .md suffix.
 * Body headings never determine or rename the file. */
export const documentDisplayName=(name:string)=>name.replace(/\.md$/i,'');

/** Preserve the current file naming convention on an inline title rename. */
export function filenameFromDocumentTitle(originalName:string,title:string){
 const base=documentDisplayName(title.trim());
 return /\.md$/i.test(originalName)?base+originalName.slice(-3):base;
}
