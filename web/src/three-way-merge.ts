import {diffArrays} from 'diff';

/** Exact, conservative three-way Markdown merge with no normalization. */
export type MergeChoice='local'|'remote'|'custom';
export type MergePiece={
 id:number;kind:'auto'|'conflict';reason?:'overlap'|'structured';
 baseStart:number;baseEnd:number;base:string;local:string;remote:string;text:string;
};
export type MergePlan={pieces:MergePiece[];conflictCount:number;autoContent:string|null;reason?:'limit'};
type Hunk={start:number;end:number;replacement:string[];side:MergeChoice};
const MAX_CHARS=300_000, MAX_LINES=6000, MAX_HUNKS=300;
const lines=(s:string):string[]=>s.match(/[^\n]*\n|[^\n]+$/g)??[];
const asText=(s:string[])=>s.join('');

/** Tiptap's visual serializer may drop a single final newline even when the
 * editor did not touch that last line. Reattach ONLY the saved exact terminator
 * when the entire final line is unchanged; never globally trim/normalize.
 * Source mode must pass its content through unchanged.
 */
export function preserveUnchangedVisualTerminator(base:string,visual:string):string{
 if(!base.endsWith('\n')||visual.endsWith('\n'))return visual;
 const terminator=base.endsWith('\r\n')?'\r\n':'\n';
 const body=base.slice(0,-terminator.length);
 if(!body||body.endsWith('\n'))return visual; // multiple trailing blank lines
 const originalTail=body.slice(body.lastIndexOf('\n')+1);
 const visualTail=visual.slice(visual.lastIndexOf('\n')+1);
 return visualTail===originalTail?visual+terminator:visual;
}
function changes(base:string[],target:string[],side:MergeChoice):Hunk[]|null{
 const diff=diffArrays(base,target,{timeout:150,maxEditLength:1600});
 if(!diff)return null;
 const hunks:Hunk[]=[];let offset=0,active:Hunk|null=null;
 const finish=()=>{
  if(!active)return;
  const h=active;
  const span=h.end-h.start;
  // diffArrays groups adjacent replacements into one hunk. If both sides
  // keep a one-to-one line mapping, split each changed line so choosing one
  // conflicted line never discards a neighboring independent remote edit.
  if(span>1&&span===h.replacement.length){
   for(let i=0;i<span;i++){
    if(base[h.start+i]!==h.replacement[i])hunks.push({
     start:h.start+i,end:h.start+i+1,replacement:[h.replacement[i]!],side:h.side
    });
   }
  }else hunks.push(h);
  active=null;
 };
 for(const part of diff){
  if(!part.added&&!part.removed){finish();offset+=part.count??part.value.length;continue;}
  if(!active)active={start:offset,end:offset,replacement:[],side};
  if(part.removed){active.end+=part.value.length;offset+=part.value.length;}
  else active.replacement.push(...part.value);
 }
 finish();
 return hunks.length<=MAX_HUNKS?hunks:null;
}
function intersects(a:Hunk,b:Hunk):boolean{
 if(a.start===a.end&&b.start===b.end)return a.start===b.start;
 if(a.start===a.end)return a.start>=b.start&&a.start<=b.end;
 if(b.start===b.end)return b.start>=a.start&&b.start<=a.end;
 return a.start<b.end&&b.start<a.end;
}
function apply(base:string[],start:number,end:number,hunks:Hunk[]):string{
 let index=start;const result:string[]=[];
 for(const h of hunks){result.push(...base.slice(index,h.start),...h.replacement);index=h.end;}
 return asText([...result,...base.slice(index,end)]);
}
function protectedLines(parts:string[]):boolean[]{
 const result=parts.map(()=>false);
 let fence:null|{marker:string;length:number}=null;
 let directive=0,math=false,html=false;
 for(let i=0;i<parts.length;i++){
  const line=parts[i].replace(/\r?\n$/,'');
  const trimmed=line.trim();
  if(fence){
   result[i]=true;
   if(new RegExp('^'+fence.marker+'{'+fence.length+',}\\s*$').test(trimmed))fence=null;
   continue;
  }
  const start=new RegExp('^('+String.fromCharCode(96)+'{3,}|~{3,})').exec(trimmed);
  if(start){fence={marker:start[1][0],length:start[1].length};result[i]=true;continue;}
  if(/^:::(?:\s|$)/.test(trimmed)){
   result[i]=true;
   if(trimmed===':::')directive=Math.max(0,directive-1);
   else directive++;
   continue;
  }
  if(/^\$\$/.test(trimmed)){result[i]=true;math=!math;continue;}
  if(/^<(?:div|table|section|details|figure|script|style)\b/i.test(trimmed))html=true;
  if(directive>0||math||html)result[i]=true;
  if(/<\/(?:div|table|section|details|figure|script|style)>/i.test(trimmed))html=false;
  if(/^\s*\|.*\|\s*$/.test(line)||/^\s*:[a-z-]+(?:\s|:)/i.test(line)
   ||/@\s*attrs(?:\s|\|)/i.test(line)||/^\s*(?:\[\[|\{\{)/.test(trimmed)
   ||/:(?:comment|highlight|abbr|tooltip|badge|math|mark|underline|strike|circle|box)\b/i.test(line)
   ||/\[\[[^\]]+\]\]|(?:^|[^\\])\$(?!\$)[^$\n]+\$|\\[\[(]/.test(line)
   ||/<[^>]+>/.test(line))result[i]=true;
 }
 return result;
}
function structuredChange(base:string[],h:Hunk,protect:boolean[]):boolean{
 if(h.start===h.end)return Boolean(protect[h.start-1]&&protect[h.start]);
 if(protect.slice(h.start,h.end).some(Boolean))return true;
 return protectedLines(h.replacement).some(Boolean);
}
export function planThreeWayMerge(baseText:string,localText:string,remoteText:string):MergePlan{
 if([baseText,localText,remoteText].some(s=>s.length>MAX_CHARS))return{pieces:[],conflictCount:0,autoContent:null,reason:'limit'};
 if(localText===remoteText)return{pieces:[],conflictCount:0,autoContent:localText};
 if(localText===baseText)return{pieces:[],conflictCount:0,autoContent:remoteText};
 if(remoteText===baseText)return{pieces:[],conflictCount:0,autoContent:localText};
 const base=lines(baseText),local=lines(localText),remote=lines(remoteText);
 if([base,local,remote].some(s=>s.length>MAX_LINES))return{pieces:[],conflictCount:0,autoContent:null,reason:'limit'};
 const l=changes(base,local,'local'),r=changes(base,remote,'remote');
 if(!l||!r)return{pieces:[],conflictCount:0,autoContent:null,reason:'limit'};
 const all=[...l,...r].sort((a,b)=>a.start-b.start||a.end-b.end);
 const protectedBase=protectedLines(base);
 const pieces:MergePiece[]=[];
 let cursor=0,at=0,conflicts=0;
 while(at<all.length){
  const grouped:Hunk[]=[all[at++]];
  let start=grouped[0].start,end=grouped[0].end;
  while(at<all.length){
   const next=all[at];
   if(!grouped.some(h=>intersects(h,next)))break;
   grouped.push(next);at++;start=Math.min(start,next.start);end=Math.max(end,next.end);
  }
  if(start>cursor){
   const text=asText(base.slice(cursor,start));
   pieces.push({id:pieces.length,kind:'auto',baseStart:cursor,baseEnd:start,
    base:text,local:text,remote:text,text});
  }
  const ls=grouped.filter(h=>h.side==='local');
  const rs=grouped.filter(h=>h.side==='remote');
  const baseSpan=asText(base.slice(start,end));
  const localSpan=ls.length?apply(base,start,end,ls):baseSpan;
  const remoteSpan=rs.length?apply(base,start,end,rs):baseSpan;
  const sensitive=grouped.some(h=>structuredChange(base,h,protectedBase));
  const conflict=sensitive||(ls.length>0&&rs.length>0&&localSpan!==remoteSpan);
  const selected=ls.length?localSpan:remoteSpan;
  pieces.push({id:pieces.length,kind:conflict?'conflict':'auto',
   ...(conflict?{reason:sensitive?'structured' as const:'overlap' as const}:{}),
   baseStart:start,baseEnd:end,base:baseSpan,local:localSpan,remote:remoteSpan,
   text:conflict?'':selected});
  if(conflict)conflicts++;
  cursor=end;
 }
 if(cursor<base.length){
  const text=asText(base.slice(cursor));
  pieces.push({id:pieces.length,kind:'auto',baseStart:cursor,baseEnd:base.length,
   base:text,local:text,remote:text,text});
 }
 return{pieces,conflictCount:conflicts,autoContent:conflicts?null:pieces.map(p=>p.text).join('')};
}
export function resolveThreeWayMerge(plan:MergePlan,choices:Record<number,MergeChoice>,custom:Record<number,string>={}):string|null{
 if(plan.reason==='limit')return null;
 if(plan.autoContent!==null)return plan.autoContent;
 if(plan.pieces.some(p=>p.kind==='conflict'&&(!choices[p.id]||
  choices[p.id]==='custom'&&!Object.hasOwn(custom,p.id))))return null;
 return plan.pieces.map(p=>p.kind==='auto'?p.text:choices[p.id]==='local'?p.local:
  choices[p.id]==='remote'?p.remote:custom[p.id]!).join('');
}
