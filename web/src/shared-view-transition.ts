/**
 * A shared title may be captured only when a library row and its destination
 * header represent the same document/folder. Never globally name text nodes:
 * unmatched snapshots were the cause of floating ghosts and early text loss.
 */
export type SharedResourceKind='record'|'folder';
export type LocationPath={pathname:string};

export function resourceViewTransitionIdentity(kind:SharedResourceKind,id:string):string{
 return 'rk-'+kind+'-'+Array.from(id,character=>
  /^[a-z\d_-]$/i.test(character)?character:'_'+character.codePointAt(0)!.toString(16)+'_'
 ).join('');
}

/** Remaining legacy call sites intentionally participate in no shared capture. */
export function sharedViewTransitionName(_kind:SharedResourceKind,_id:string):undefined{
 return undefined;
}

type Pair={kind:SharedResourceKind;id:string;from:string;to:string;token:number;source:HTMLElement};
let active:Pair|null=null;
let previousList:{kind:SharedResourceKind;id:string;from:string;to:string;scrollTop:number}|null=null;
let sequence=0;

export function sharedTitleAttributes(kind:SharedResourceKind,id:string){
 return {
  'data-rk-vt-kind':kind,
  'data-rk-vt-id':id,
  'data-rk-vt-active':active?.kind===kind&&active?.id===id?'true':undefined
 } as const;
}

function parse(path:string):
 |{type:'library';folderId:string|null}
 |{type:'resource';kind:SharedResourceKind;id:string}
 |null{
 if(path==='/library')return {type:'library',folderId:null};
 const folder=/^\/library\/([^/]+)$/.exec(path);
 if(folder)return {type:'library',folderId:decodeURIComponent(folder[1])};
 const record=/^\/records\/([^/]+)$/.exec(path);
 if(record)return {type:'resource',kind:'record',id:decodeURIComponent(record[1])};
 return null;
}

export type PairCandidate={kind:SharedResourceKind;id:string;direction:'forward'|'back'};
export function candidateForRoutes(fromPath:string,toPath:string):PairCandidate|null{
 const from=parse(fromPath),to=parse(toPath);
 if(!from||!to)return null;
 if(from.type==='library'&&to.type==='resource')return {kind:to.kind,id:to.id,direction:'forward'};
 if(from.type==='resource'&&to.type==='library')return {kind:from.kind,id:from.id,direction:'back'};
 if(from.type==='library'&&to.type==='library'){
  if(from.folderId&&previousList?.to===fromPath&&previousList?.from===toPath)
   return {kind:'folder',id:from.folderId,direction:'back'};
  if(to.folderId&&to.folderId!==from.folderId)
   return {kind:'folder',id:to.folderId,direction:'forward'};
  if(from.folderId&&!to.folderId)
   return {kind:'folder',id:from.folderId,direction:'back'};
 }
 return null;
}

const activeSelector='[data-rk-vt-active="true"]';
function candidates(kind:SharedResourceKind,id:string):HTMLElement[]{
 return Array.from(document.querySelectorAll<HTMLElement>('[data-rk-vt-kind][data-rk-vt-id]'))
  .filter(el=>el.dataset.rkVtKind===kind&&el.dataset.rkVtId===id);
}
function visible(el:HTMLElement):boolean{
 const viewport=document.querySelector('.main-scroll');
 if(!viewport||!el.isConnected)return false;
 const rect=el.getBoundingClientRect(),bounds=viewport.getBoundingClientRect();
 const style=getComputedStyle(el);
 return rect.width>0&&rect.height>0&&style.visibility==='visible'&&
  rect.top>=bounds.top-2&&rect.bottom<=bounds.bottom+2&&
  rect.left>=bounds.left-2&&rect.right<=bounds.right+2;
}
function stop(token?:number){
 if(token!==undefined&&active?.token!==token)return;
 document.querySelectorAll(activeSelector).forEach(el=>el.removeAttribute('data-rk-vt-active'));
 active=null;
}

export function preparePairedNavigation(fromLocation:LocationPath|null|undefined,toLocation:LocationPath,targetLabel:(kind:SharedResourceKind,id:string,direction:PairCandidate['direction'],destinationFolderId:string|null)=>string|undefined):string[]{
 if(typeof document==='undefined')return [];
 // The previous screenshot must not be altered by an interrupted transition.
 stop();
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return [];
 const from=fromLocation?.pathname??'',to=toLocation.pathname;
 const candidate=candidateForRoutes(from,to);
 if(!candidate)return [];
 const {kind,id,direction}=candidate;
 const destination=parse(to);
 const destinationFolderId=destination?.type==='library'?destination.folderId:null;
 // The loader has finished before this callback. A missing query or a stale
 // rename must not animate two different title strings as one shared snapshot.
 const expectedLabel=targetLabel(kind,id,direction,destinationFolderId);
 if(expectedLabel===undefined)return [];
 // Only main library rows, never recents, search, sidebar or breadcrumbs.
 const eligible=candidates(kind,id).filter(el=>el.closest(direction==='forward'?'.file-table':'.doc-header'));
 if(eligible.length!==1)return [];
 const source=eligible[0];
 if(source.textContent?.trim()!==expectedLabel||!visible(source))return [];
 // Avoid animating a truncated filename snapshot into a full heading or
 // capturing a title while its contentEditable field is actively being edited.
 if(source.scrollWidth>source.clientWidth+1||document.activeElement===source)return [];
 if(direction==='forward'){
  if(!source.closest('.file-row'))return [];
  // The row itself must already be painted; the title may still be entering.
  const row=source.closest('.file-row');
  if(row?.getAnimations().some(animation=>('animationName' in animation)&&animation.animationName==='data-row-fade-in'&&animation.playState==='running'))return [];
  const viewport=document.querySelector('.main-scroll');
  previousList={kind,id,from,to,scrollTop:viewport?.scrollTop??0};
 }else{
  // Route history may bring the user back to a different or off-screen list.
  // Only animate a matching recent library/detail pair near the list top.
  if(!previousList||previousList.kind!==kind||previousList.id!==id||
   previousList.from!==to||previousList.to!==from||previousList.scrollTop>8)return [];
  // A backwards pair is permitted only for the recent list/detail origin.
  // Its target membership and label were checked above.
 }
 const token=++sequence;
 active={kind,id,from,to,token,source};
 source.setAttribute('data-rk-vt-active','true');
 return ['rk-paired-navigation'];
}

export function clearPairedNavigation(){stop();}

/** Attach cleanup to the browser's real transition lifecycle, not an arbitrary
 * timer. Return history navigation and interrupted transitions use this too. */
export function installPairedTransitionLifecycle(){
 if(typeof document==='undefined'||typeof document.startViewTransition!=='function')return;
 const native=document.startViewTransition.bind(document);
 document.startViewTransition=((...args:Parameters<Document['startViewTransition']>)=>{
  const token=active?.token;
  const transition=native(...args);
  if(token!==undefined){
   void transition.finished.then(()=>stop(token),()=>stop(token));
   void transition.ready.catch(()=>stop(token));
  }
  return transition;
 }) as Document['startViewTransition'];
}
