import {slugHeading,explicitHeadingAnchor,explicitBlockAnchor} from './wiki-slug';

/** Select an explicit heading section, a generated heading section or an
 * explicitly anchored paragraph for a read-only Wiki transclusion.
 * Never executes Markdown; caller still uses safe Markdown rendering.
 */
export function extractWikiSection(content:string,anchor?:string|null):string{
 if(!anchor)return content;
 const lines=content.split(/\r?\n/);
 if(anchor.startsWith('^')){
  const id=anchor.slice(1).toLowerCase();
  if(!/^[a-z][a-z0-9-]{0,79}$/.test(id))return '';
  let found=-1;
  for(let index=0;index<lines.length;index++){
   const parsed=explicitBlockAnchor(lines[index]??'');
   if(parsed?.id===id){found=index;break;}
  }
  if(found<0)return '';
  let from=found;
  while(from>0&&lines[from-1]?.trim())from--;
  let end=found+1;
  while(end<lines.length&&lines[end]?.trim())end++;
  const body=lines.slice(from,end);
  body[found-from]=explicitBlockAnchor(body[found-from]??'')!.body;
  return body.join('\n');
 }
 const slug=slugHeading(anchor);
 let from=-1,level=0;
 for(let i=0;i<lines.length;i++){
  const heading=/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]??'');
  if(!heading)continue;
  const explicit=explicitHeadingAnchor(heading[2]??'');
  const headingSlug=slugHeading(explicit?.body??heading[2]??'');
  if(from<0&&(headingSlug===slug||explicit?.id===slug)){
   from=i;level=(heading[1]??'').length;continue;
  }
  if(from>=0&&(heading[1]??'').length<=level)return lines.slice(from,i).join('\n');
 }
 return from>=0?lines.slice(from).join('\n'):'';
}
