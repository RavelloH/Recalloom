import {slugHeading} from './wiki-slug';
import {lexRmd,protectedRmdRanges} from './rmd-lexer';

/** Resolve RMD 1.0 heading anchors and paragraph block IDs from the same
 * schema-validated @ attrs tokens consumed by preview and the visual editor.
 * This is a pure source read: it never writes or backfills metadata.
 */
export function extractWikiSection(content:string,anchor?:string|null):string{
 if(!anchor)return content;
 const source=content.replace(/\r\n/g,'\n');
 const lines=source.split('\n');
 const protectedRanges=protectedRmdRanges(source);
 const starts:number[]=[0];
 for(let i=0;i<source.length;i++)if(source[i]==='\n')starts.push(i+1);
 const lineAt=(offset:number)=>{
  let lo=0,hi=starts.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(starts[mid]!<=offset)lo=mid;else hi=mid-1;}
  return lo;
 };
 const modifiers=lexRmd(source).filter(token=>token.type==='attrs'&&token.attributes.id)
  .map(token=>{
   const line=lineAt(token.start);
   const standalone=lines[line]?.trimStart().startsWith('@ attrs')??false;
   return {...token,line:standalone?line-1:line,modifierLine:line};
  }).filter(token=>token.line>=0);
 const requested=anchor.startsWith('^')?anchor.slice(1).toLowerCase():slugHeading(anchor);
 if(!requested)return '';
 if(anchor.startsWith('^')){
  if(!/^[a-z][a-z0-9-]{0,79}$/.test(requested))return '';
  const token=modifiers.find(item=>item.name==='paragraph'&&item.attributes.id===requested);
  if(!token)return '';
  let from=token.line,to=Math.max(token.line,token.modifierLine);
  while(from>0&&lines[from-1]?.trim())from--;
  while(to+1<lines.length&&lines[to+1]?.trim())to++;
  return lines.slice(from,to+1).join('\n');
 }
 let from=-1,level=0;
 for(let i=0;i<lines.length;i++){
  if(protectedRanges.some(range=>starts[i]!>=range.start&&starts[i]!<range.end))continue;
  const match=/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[i]??'');
  if(!match)continue;
  const attr=modifiers.find(token=>token.name==='heading'&&token.line===i);
  const title=attr&&attr.modifierLine===i?match[2]!.replace(attr.raw,'').trim():match[2]!;
  const headingSlug=slugHeading(title);
  if(from<0&&(headingSlug===requested||attr?.attributes.id===requested)){
   from=i;level=match[1]!.length;continue;
  }
  if(from>=0&&match[1]!.length<=level)return lines.slice(from,i).join('\n');
 }
 return from>=0?lines.slice(from).join('\n'):'';
}
