/** Section locations use source lines so Markdown headings and the jump menu agree. */
export function helpSections(content:string,includeSubsections=false){
 const sections:Array<{id:string;label:string}>=[];
 let fence:{marker:string;length:number}|null=null;
 let parent='';
 for(const [index,line] of content.split('\n').entries()){
  const marker=/^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
  if(marker){
   if(!fence)fence={marker:marker[0],length:marker.length};
   else if(marker[0]===fence.marker&&marker.length>=fence.length&&line.trim()===marker)fence=null;
   continue;
  }
  if(fence)continue;
  const heading=/^(#{2,3})\s+(.+?)(?:\s+#+)?$/.exec(line);
  if(!heading)continue;
  const label=heading[2].replace(/`/g,'');
  if(heading[1].length===2){parent=label;sections.push({id:'help-heading-'+(index+1),label});}
  else if(includeSubsections)sections.push({id:'help-heading-'+(index+1),label:parent?parent+' · '+label:label});
 }
 return sections;
}
