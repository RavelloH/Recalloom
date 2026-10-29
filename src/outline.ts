import type { Env } from './types.js';
import { StorageError } from './types.js';
import { getRecord } from './storage.js';
import { historicalVersion } from './version.js';

export type MarkdownHeading={level:number;title:string;lineStart:number;lineEnd:number};

/** Extract structural Markdown headings without evaluating MDX, HTML or embedded code. */
export function parseMarkdownOutline(content:string,limit=100,cursor=0){
  const lines=content.split(/\r\n|\r|\n/);
  const headings:Array<Omit<MarkdownHeading,'lineEnd'>>=[];
  let fenceChar='',fenceLength=0;
  let frontmatter=lines[0]?.trim()==='---';
  for(let i=0;i<lines.length;i++){
    const line=lines[i]!;
    if(frontmatter){
      if(i>0&&(line.trim()==='---'||line.trim()==='...'))frontmatter=false;
      continue;
    }
    const fenced=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(fenced){
      if(!fenceChar){fenceChar=fenced[1]![0]!;fenceLength=fenced[1]!.length;}
      else if(fenced[1]![0]===fenceChar&&fenced[1]!.length>=fenceLength&&fenced[2]!.trim()===''){fenceChar='';}
      continue;
    }
    if(fenceChar||/^ {4}|^\t/.test(line))continue;
    const atx=line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
    if(atx){
      const title=atx[2]!.trim().replace(/[ \t]+#+[ \t]*$/,'').trim();
      if(title)headings.push({level:atx[1]!.length,title,lineStart:i+1});
      continue;
    }
    const underline=lines[i+1]?.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if(underline&&line.trim()&&!/^\s*(?:[-+*]\s|\d+[.)]\s|>|<|\||#)/.test(line)){
      headings.push({level:underline[1]![0]==='='?1:2,title:line.trim(),lineStart:i+1});
      i++;
    }
  }
  const expanded:MarkdownHeading[]=headings.map((h,i)=>{
    const next=headings.slice(i+1).find(n=>n.level<=h.level);
    return {...h,lineEnd:next?next.lineStart-1:lines.length};
  });
  const size=Math.min(200,Math.max(1,limit));
  if(!Number.isInteger(cursor)||cursor<0||cursor>expanded.length)throw new StorageError('INVALID_CURSOR');
  const items=expanded.slice(cursor,cursor+size);
  const nextCursor=cursor+items.length<expanded.length?cursor+items.length:null;
  return {headings:items,totalHeadings:expanded.length,totalLines:lines.length,page:{hasMore:nextCursor!==null,nextCursor}};
}
export async function getOutline(env:Env,id:string,revision?:number,limit=100,cursor=0){
  const row=await getRecord(env,id);
  if(row.kind==='task_list')throw new StorageError('OUTLINE_NOT_SUPPORTED');
  const currentRevision=row.revision;
  const selected=revision??currentRevision;
  if(!Number.isInteger(selected)||selected<1||selected>currentRevision)throw new StorageError('REVISION_NOT_FOUND');
  const content=selected===currentRevision?row.content:historicalVersion({content:row.content,metadata:row.history_metadata},selected);
  return {id,revision:selected,currentRevision,...parseMarkdownOutline(content,limit,cursor)};
}
