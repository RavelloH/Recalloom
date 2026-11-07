import {extractWikiReferences} from '../../src/wiki-syntax.js';
const safeAttr=(value:string)=>encodeURIComponent(value).replace(/'/g,'%27');

/** Replace only validated, syntax-aware Wiki tokens before remark-directive
 * parses Markdown. Otherwise the colon inside [[id:UUID]] or
 * {{embed:id:UUID}} is incorrectly parsed as a directive, breaking
 * inline references and nested readonly transclusions.
 *
 * These generated HTML-like custom elements are not user HTML: all values
 * come from the shared Wiki parser and are URI-encoded before insertion.
 * rehype-raw + rehype-sanitize still restrict the tags/attributes.
 */
export function prepareWikiMarkdown(raw:string):string{
 const source=raw.replace(/\r\n/g,'\n');
 const references=extractWikiReferences(source);
 if(!references.length)return source;
 let result='',cursor=0,embeds=0;
 for(const ref of references){
  if(ref.offset<cursor)continue;
  result+=source.slice(cursor,ref.offset);
  if(ref.kind==='link'){
   result+='<wiki-ref data-target="'+safeAttr(ref.target)+
    '" data-alias="'+safeAttr(ref.alias??'')+
    '" data-anchor="'+safeAttr(ref.anchor??'')+'"></wiki-ref>';
  }else if(embeds++<8){
   result+='<wiki-embed data-target="'+safeAttr(ref.target)+
    '" data-anchor="'+safeAttr(ref.anchor??'')+'"></wiki-embed>';
  }else result+='嵌入内容过多，已折叠后续嵌入。';
  cursor=ref.offset+ref.raw.length;
 }
 return result+source.slice(cursor);
}
