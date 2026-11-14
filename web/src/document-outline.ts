export type DocumentOutlineHeading={key:string;title:string;level:number};
export type DocumentOutline={headings:DocumentOutlineHeading[];totalHeadings:number;activeKey:string|null};
export type ParsedDocumentHeading=DocumentOutlineHeading&{line:number};

/** Read Markdown structure without parsing rich RMD blocks. */
export function parseDocumentHeadings(content:string):ParsedDocumentHeading[]{
 const lines=content.split(/\r\n|\r|\n/);
 const headings:ParsedDocumentHeading[]=[];
 let fenceChar='',fenceLength=0;
 const frontmatterMarker=lines[0]?.replace(/^\uFEFF/,'').trim();
 let frontmatter=frontmatterMarker==='---'||frontmatterMarker==='+++';
 for(let index=0;index<lines.length;index++){
  const line=lines[index]!;
  if(frontmatter){
   if(index>0&&(line.trim()==='---'||line.trim()==='+++'||line.trim()==='...'))frontmatter=false;
   continue;
  }
  const fence=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if(fence){
   if(!fenceChar){fenceChar=fence[1]![0]!;fenceLength=fence[1]!.length;}
   else if(fence[1]![0]===fenceChar&&fence[1]!.length>=fenceLength&&fence[2]!.trim()==='')fenceChar='';
   continue;
  }
  if(fenceChar||/^ {4}|^\t/.test(line))continue;
  const atx=line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
  if(atx){
   const title=atx[2]!.trim().replace(/[ \t]+#+[ \t]*$/,'').trim();
   if(title)headings.push({key:'markdown:'+index,title,level:atx[1]!.length,line:index});
   continue;
  }
  const underline=lines[index+1]?.match(/^ {0,3}(=+|-+)[ \t]*$/);
  if(underline&&line.trim()&&!/^\s*(?:[-+*]\s|\d+[.)]\s|>|<|\||#)/.test(line)){
   headings.push({key:'markdown:'+index,title:line.trim(),level:underline[1]![0]==='='?1:2,line:index});
   index++;
  }
 }
 return headings;
}

export function activeDocumentHeading(headings:ParsedDocumentHeading[],line:number):string|null{
 let active:string|null=null;
 for(const heading of headings){
  if(heading.line>line)break;
  active=heading.key;
 }
 return active;
}

export function documentOutline(headings:ParsedDocumentHeading[],activeKey:string|null):DocumentOutline{
 return {headings:headings.slice(0,200).map(({key,title,level})=>({key,title,level})),totalHeadings:headings.length,activeKey};
}
