import React,{createContext,useContext} from 'react';
import {createPortal} from 'react-dom';

type Slots={start:HTMLElement|null;end:HTMLElement|null};
const SlotContext=createContext<Slots>({start:null,end:null});

export function TopbarSlotProvider({slots,children}:{slots:Slots;children:React.ReactNode}){
 return <SlotContext.Provider value={slots}>{children}</SlotContext.Provider>;
}

/** Renders page-owned breadcrumbs and actions into the shell's sticky top bar. */
export function TopbarPortal({slot,children}:{slot:'start'|'end';children:React.ReactNode}){
 const target=useContext(SlotContext)[slot];
 return target?createPortal(children,target):null;
}
