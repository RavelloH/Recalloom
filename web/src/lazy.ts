import React,{useState} from 'react';

/** A lazy component whose chunk can be warmed by a route loader. Once loaded,
 *  it renders synchronously, so no Suspense fallback flashes between pages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function preloadable<C extends React.ComponentType<any>>(factory:()=>Promise<{default:C}>){
 let loaded:C|null=null;
 let promise:Promise<unknown>|null=null;
 const preload=()=>promise??=factory().then(module=>{loaded=module.default;}).catch(error=>{promise=null;throw error;});
 const Lazy=React.lazy(()=>factory().then(module=>{loaded=module.default;return module;}));
 function Preloadable(props:React.ComponentProps<C>){
  // Decide once per mount: switching component type later would remount the editor.
  const [Ready]=useState(()=>loaded);
  return React.createElement((Ready??Lazy) as React.ComponentType<React.ComponentProps<C>>,props);
 }
 return Object.assign(Preloadable as unknown as C,{preload});
}
