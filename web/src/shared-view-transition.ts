/**
 * One temporary, verified shared element per navigation. The route viewport
 * always keeps its normal crossfade. Never name unrelated text globally.
 */
export type SharedResourceKind='record'|'folder'|'task';
export type LocationPath={pathname:string;search?:Record<string,unknown>};
export type PairDirection='forward'|'back';
export type PairCandidate={kind:SharedResourceKind;id:string;direction:PairDirection};

type SourceKind='library'|'recent'|'updated'|'activity'|'search'|'archive'|'todo';
type Pair={
 kind:SharedResourceKind;id:string;direction:PairDirection;sourceKey:string;
 token:number;label:string;sourceKind:SourceKind;source:HTMLElement;
 from:string;to:string;
};
type PreviousPair=Omit<Pair,'token'|'direction'|'source'> &{scrollTop:number};
let active:Pair|null=null;
let previous:PreviousPair|null=null;
let selectedKey:string|null=null;
let sequence=0;

export function resourceViewTransitionIdentity(kind:SharedResourceKind,id:string):string{
 return 'rk-'+kind+'-'+Array.from(id,char=>
  /^[a-z\d_-]$/i.test(char)?char:'_'+char.codePointAt(0)!.toString(16)+'_'
 ).join('');
}
/** Old global naming API deliberately remains disabled. */
export function sharedViewTransitionName(_kind:SharedResourceKind,_id:string):undefined{return undefined;}

/** The header on the destination is the only incoming name on a forward trip. */
export function sharedTitleAttributes(kind:SharedResourceKind,id:string){
 return {
  'data-rk-vt-kind':kind,
  'data-rk-vt-id':id,
  'data-rk-vt-active':active?.direction==='forward'&&active.kind===kind&&active.id===id?'true':undefined
 } as const;
}
/** Each row/link gets its own source key: activity and search may repeat IDs. */
export function sharedSourceAttributes(kind:SharedResourceKind,id:string,key:string){
 return {
  'data-rk-vt-kind':kind,
  'data-rk-vt-id':id,
  'data-rk-vt-source':key,
  'data-rk-vt-active':active?.direction==='back'&&active.kind===kind&&active.id===id&&active.sourceKey===key?'true':undefined
 } as const;
}
export function markSharedNavigationSource(key:string){selectedKey=key;}

type Route={type:'library'|'record'|'home'|'search'|'activity'|'archive'|'other';id?:string;folderId?:string|null};
function parse(path:string):Route{
 if(path==='/')return {type:'home'};
 if(path==='/library')return {type:'library',folderId:null};
 let match=/^\/library\/([^/]+)$/.exec(path);
 if(match)return {type:'library',id:decodeURIComponent(match[1]),folderId:decodeURIComponent(match[1])};
 match=/^\/records\/([^/]+)$/.exec(path);
 if(match)return {type:'record',id:decodeURIComponent(match[1])};
 for(const type of ['search','activity','archive'] as const)if(path==='/'+type)return {type};
 return {type:'other'};
}
function selectedKind(key:string|null):SourceKind|null{
 const part=key?.split(':',1)[0];
 return part&&['library','recent','updated','activity','search','archive','todo'].includes(part)?part as SourceKind:null;
}

export function candidateForRoutes(fromPath:string,toPath:string):PairCandidate|null{
 const from=parse(fromPath),to=parse(toPath);
 if(from.type==='record'&&from.id&&to.type==='library')
  return {kind:'record',id:from.id,direction:'back'};
 if(to.type==='record'&&to.id&&['library','home','search','activity','archive','record'].includes(from.type))
  return {kind:'record',id:to.id,direction:'forward'};
 if(to.type==='library'&&to.id&&['library','home','activity','record','search','archive'].includes(from.type))
  return {kind:'folder',id:to.id,direction:'forward'};
 if(from.type==='library'&&from.id&&to.type==='library'&&(!to.id||previous?.from===toPath&&previous?.to===fromPath))
  return {kind:'folder',id:from.id,direction:'back'};
 return null;
}
function stop(token?:number){
 if(token!==undefined&&active?.token!==token)return;
 document.querySelectorAll('[data-rk-vt-active="true"]').forEach(el=>el.removeAttribute('data-rk-vt-active'));
 active=null;
}
function visible(element:HTMLElement):boolean{
 const viewport=document.querySelector('.main-scroll');
 if(!viewport||!element.isConnected)return false;
 const rect=element.getBoundingClientRect(),bounds=viewport.getBoundingClientRect();
 const css=getComputedStyle(element);
 return rect.width>0&&rect.height>0&&css.visibility==='visible'&&
  rect.top>=bounds.top-2&&rect.bottom<=bounds.bottom+2&&
  rect.left>=bounds.left-2&&rect.right<=bounds.right+2;
}
const sourceQuery='[data-rk-vt-source]';
function findSource(kind:SharedResourceKind,id:string,key:string):HTMLElement|null{
 const matches=Array.from(document.querySelectorAll<HTMLElement>(sourceQuery)).filter(el=>
  el.dataset.rkVtKind===kind&&el.dataset.rkVtId===id&&el.dataset.rkVtSource===key);
 return matches.length===1?matches[0]:null;
}
function findHeader(kind:SharedResourceKind,id:string):HTMLElement|null{
 const matches=Array.from(document.querySelectorAll<HTMLElement>('.doc-header [data-rk-vt-kind]')).filter(el=>
  el.dataset.rkVtKind===kind&&el.dataset.rkVtId===id);
 // A task targets its own inline row, not the enclosing task-list filename.
 if(kind==='task'){
  const tasks=Array.from(document.querySelectorAll<HTMLElement>('.embedded-tasks .task-title [data-rk-vt-kind="task"]')).filter(el=>
   el.dataset.rkVtId===id);
  return tasks.length===1?tasks[0]:null;
 }
 return matches.length===1?matches[0]:null;
}
export type ResolveSharedLabel=(
 kind:SharedResourceKind,id:string,direction:PairDirection,
 sourceKind:SourceKind,destination:LocationPath,sourceKey:string
)=>string|undefined;

export function preparePairedNavigation(fromLocation:LocationPath|null|undefined,toLocation:LocationPath,resolveLabel:ResolveSharedLabel):string[]{
 if(typeof document==='undefined')return [];
 stop();
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){selectedKey=null;return [];}
 const from=fromLocation?.pathname??'',to=toLocation.pathname;
 const fromRoute=parse(from),toRoute=parse(to);
 const clicked=selectedKey;selectedKey=null;
 // Sidebar navigation persists across routes. Suppress text-sharing even if
 // a previous library/record route pair happens to match.
 if(clicked==='sidebar'){previous=null;return [];}
 // An exact previous route pair is required for return navigation. Don't
 // try to pair a random record name in the sidebar or a repeated search hit.
 const last=previous;
 const reverse=last!==null&&last.to===from&&last.from===to;
 let candidate:PairCandidate|null=null;
 let sourceKind:SourceKind;
 let sourceKey:string;
 if(reverse){
  candidate={kind:last!.kind,id:last!.id,direction:'back'};
  sourceKind=last!.sourceKind;sourceKey=last!.sourceKey;
 }else{
  candidate=candidateForRoutes(from,to);
  if(!candidate||candidate.direction!=='forward')return [];
  if(clicked?.startsWith('todo:')&&fromRoute.type==='home'&&toRoute.type==='record'){
   const taskId=toLocation.search?.task;
   if(typeof taskId!=='string'||clicked!==('todo:'+taskId))return [];
   candidate={kind:'task',id:taskId,direction:'forward'};
  }
  // Preserve browser-forward pairing for an already visible library row,
  // even without a click. Sidebar clicks carry the explicit 'sidebar'
  // suppression marker above and can never borrow that library row.
  sourceKind=selectedKind(clicked)??(fromRoute.type==='library'?'library':null)!;
  if(!sourceKind)return [];
  if(sourceKind==='todo'){
   if(candidate.kind!=='task'||fromRoute.type!=='home')return [];
  }else if((sourceKind==='recent'||sourceKind==='updated')&&fromRoute.type!=='home'
   ||sourceKind==='search'&&fromRoute.type!=='search'
   ||sourceKind==='archive'&&fromRoute.type!=='archive'
   ||sourceKind==='activity'&&!['home','activity'].includes(fromRoute.type)
   ||sourceKind==='library'&&fromRoute.type!=='library')return [];
  sourceKey=clicked??('library:'+candidate.kind+':'+candidate.id);
 }
 const {kind,id,direction}=candidate;
 // Never join unrelated task and document names (or a stale record title).
 if(kind==='task'&&(toRoute.type==='record'&&typeof toLocation.search?.task!=='string'&&direction==='forward'))return [];
 const expected=resolveLabel(kind,id,direction,sourceKind,toLocation,sourceKey);
 if(expected===undefined)return [];
 const source=direction==='forward'?findSource(kind,id,sourceKey):findHeader(kind,id);
 const cardPair=sourceKind==='recent'||sourceKind==='updated';
 // Inline card labels include rects for text hidden by the parent's clamp.
 // Validate the visible title box; capture CSS clamps the named text itself.
 const visibleSource=cardPair&&direction==='forward'
  ?source?.closest<HTMLElement>('.recent-page-name'):source;
 if(!source||source.textContent?.trim()!==expected||!visibleSource||!visible(visibleSource))return [];
 if(source.scrollWidth>source.clientWidth+1||document.activeElement===source)return [];
 // Cards have a bounded two-line snapshot on either side, so their filename
 // can pair with a larger heading, including after a cold home-page reload.
 // Other source layouts retain the conservative single-line requirement.
 const sourceStyle=getComputedStyle(source);
 const lineHeight=parseFloat(sourceStyle.lineHeight);
 if(!cardPair&&Number.isFinite(lineHeight)&&lineHeight>0&&source.getBoundingClientRect().height>lineHeight*1.55)return [];
 if(direction==='forward'){
  const row=source.closest('.file-row,.recent-page,.search-result,.archive-item,.compact-row,.recent-entry,.activity-row');
  if(row?.getAnimations().some(animation=>
   'animationName' in animation&&animation.animationName==='data-row-fade-in'&&animation.playState==='running'))return [];
  const scroll=document.querySelector('.main-scroll')?.scrollTop??0;
  previous={kind,id,from,to,sourceKind,sourceKey,label:expected,scrollTop:scroll};
 }else{
  if(!previous||previous.kind!==kind||previous.id!==id||previous.sourceKey!==sourceKey)return [];
  // Only return-pair when the origin is near its original viewport position.
  // Otherwise an offscreen destination would produce a single floating ghost.
  if(previous.scrollTop>8)return [];
 }
 const token=++sequence;
 active={kind,id,direction,sourceKey,token,label:expected,sourceKind,source,from,to};
 source.setAttribute('data-rk-vt-active','true');
 return ['rk-paired-navigation'];
}
export function clearPairedNavigation(){if(typeof document!=='undefined')stop();}
/** Cleanup is attached to the native transition lifecycle, including skips. */
export function installPairedTransitionLifecycle(){
 if(typeof document==='undefined'||typeof document.startViewTransition!=='function')return;
 const native=document.startViewTransition.bind(document);
 document.startViewTransition=((...args:Parameters<Document['startViewTransition']>)=>{
  const token=active?.token;
  const transition=native(args[0] as typeof args[0]);
  if(token!==undefined){
   void transition.finished.then(()=>stop(token),()=>stop(token));
   void transition.ready.catch(()=>stop(token));
  }
  return transition;
 }) as Document['startViewTransition'];
}
