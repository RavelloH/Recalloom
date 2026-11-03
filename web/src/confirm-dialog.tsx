import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';

export type ConfirmationOptions={
 title:string;
 description:string;
 actionLabel:string;
 destructive?:boolean;
};

/**
 * Promise-based controller over Astryx AlertDialog.
 * Pending callers resolve false if the owning page unmounts or is dismissed.
 * All destructive operations remain in the caller, after explicit approval.
 */
export function useConfirmDialog(){
 const [options,setOptions]=useState<ConfirmationOptions|null>(null);
 const pending=useRef<((confirmed:boolean)=>void)|null>(null);

 const decide=useCallback((approved:boolean)=>{
  const done=pending.current;
  pending.current=null;
  setOptions(null);
  done?.(approved);
 },[]);
 const confirm=useCallback((next:ConfirmationOptions):Promise<boolean>=>new Promise(resolve=>{
  if(pending.current){resolve(false);return;}
  pending.current=resolve;
  setOptions(next);
 }),[]);
 useEffect(()=>()=>{const done=pending.current;pending.current=null;done?.(false);},[]);

 // Avoid mounting dormant modal dialogs; only the active confirmation exists.
 const confirmation=options?<AlertDialog
  isOpen
  onOpenChange={open=>{if(!open)decide(false);}}
  title={options.title}
  description={options.description}
  actionLabel={options.actionLabel}
  cancelLabel="取消"
  actionVariant={options.destructive?'destructive':'primary'}
  onAction={()=>decide(true)}
 />:null;
 return {confirm,confirmation};
}
