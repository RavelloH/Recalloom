/**
 * Tab-scoped emergency drafts. Scoped by authenticated session ID so a later
 * account/session on the same device cannot read the previous session's drafts.
 * Never persist clean content or overwrite remote revisions without confirmation.
 */
export type SessionDraft={recordId:string;revision:number;content:string;updatedAt:number};
const prefix='recalloom:draft:';
const mergeBackupPrefix='recalloom:merge-backup:';
const maxAge=24*60*60*1000;
const key=(sessionId:string,recordId:string)=>prefix+sessionId+':'+recordId;
export function readSessionDraft(sessionId:string,recordId:string):SessionDraft|null{
 if(!sessionId)return null;
 try{
  const raw=sessionStorage.getItem(key(sessionId,recordId));
  if(!raw)return null;
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=='object')return null;
  const candidate=parsed as Partial<SessionDraft>;
  if(candidate.recordId!==recordId||!Number.isSafeInteger(candidate.revision)||typeof candidate.content!=='string'||typeof candidate.updatedAt!=='number'||Date.now()-candidate.updatedAt>maxAge||candidate.updatedAt>Date.now()+60_000){
   clearSessionDraft(sessionId,recordId);return null;
  }
  return candidate as SessionDraft;
 }catch{return null;}
}
export function writeSessionDraft(sessionId:string,recordId:string,revision:number,content:string):boolean{
 if(!sessionId)return false;
 try{
  sessionStorage.setItem(key(sessionId,recordId),JSON.stringify({recordId,revision,content,updatedAt:Date.now()} satisfies SessionDraft));
  return true;
 }catch{return false;}
}
export function clearSessionDraft(sessionId:string,recordId:string){
 if(!sessionId)return;
 try{sessionStorage.removeItem(key(sessionId,recordId));}catch{ /* storage may be disabled */ }
}
/** A separate tab-scoped safety copy when resolving a merge conflict.
 * It is not the active draft: never silently restore or overwrite the server.
 */
export type SessionMergeBackup={
 recordId:string;baseRevision:number;baseContent:string;localContent:string;updatedAt:number
};
const mergeKey=(sessionId:string,recordId:string)=>mergeBackupPrefix+sessionId+':'+recordId;
export function readSessionMergeBackup(sessionId:string,recordId:string):SessionMergeBackup|null{
 if(!sessionId)return null;
 try{
  const raw=sessionStorage.getItem(mergeKey(sessionId,recordId));
  if(!raw)return null;
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object')return null;
  const x=value as Partial<SessionMergeBackup>;
  if(x.recordId!==recordId||!Number.isSafeInteger(x.baseRevision)||Number(x.baseRevision)<1
   ||typeof x.baseContent!=='string'||typeof x.localContent!=='string'
   ||typeof x.updatedAt!=='number'||x.updatedAt>Date.now()+60_000
   ||Date.now()-x.updatedAt>maxAge){
   clearSessionMergeBackup(sessionId,recordId);return null;
  }
  return x as SessionMergeBackup;
 }catch{return null;}
}
export function writeSessionMergeBackup(sessionId:string,recordId:string,
 baseRevision:number,baseContent:string,localContent:string):boolean{
 if(!sessionId)return false;
 try{
  sessionStorage.setItem(mergeKey(sessionId,recordId),JSON.stringify({
   recordId,baseRevision,baseContent,localContent,updatedAt:Date.now()
  } satisfies SessionMergeBackup));
  return true;
 }catch{return false;}
}
export function clearSessionMergeBackup(sessionId:string,recordId:string){
 if(!sessionId)return;
 try{sessionStorage.removeItem(mergeKey(sessionId,recordId));}catch{}
}
export function clearAllSessionDrafts(){
 try{
  for(let i=sessionStorage.length-1;i>=0;i--){
   const candidate=sessionStorage.key(i);
   if(candidate?.startsWith(prefix)||candidate?.startsWith(mergeBackupPrefix))sessionStorage.removeItem(candidate);
  }
 }catch{ /* browser storage may be disabled */ }
}

export function hasSessionDrafts():boolean{
 try{for(let i=0;i<sessionStorage.length;i++)if(sessionStorage.key(i)?.startsWith(prefix)||sessionStorage.key(i)?.startsWith(mergeBackupPrefix))return true;}catch{}
 return false;
}

// Transient UI flag: explicit logout confirmation must not trigger a second SPA navigation blocker.
let logoutNavigationApproved=false;
export function approveLogoutNavigation(value:boolean){logoutNavigationApproved=value;}
export function isLogoutNavigationApproved(){return logoutNavigationApproved;}

// Track unsaved content even when sessionStorage is unavailable (private mode/quota).
let activeEditorDirty=false;
export function setActiveEditorDirty(value:boolean){activeEditorDirty=value;}
export function hasActiveEditorDirty(){return activeEditorDirty;}
