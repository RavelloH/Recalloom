import React,{useEffect,useRef,useState,type AnchorHTMLAttributes,type ReactNode} from 'react';
import {IconLink} from '@tabler/icons-react';
import {normalizedLinkOrigin,resolveRemoteIcon} from './link-metadata-client';

/** Displays the source website's favicon without storing its image in Recalloom. */
export function SmartLink({href,children,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&{children?:ReactNode}){
 const anchor=useRef<HTMLAnchorElement>(null);
 const [icon,setIcon]=useState<string|null>(null);
 const [failed,setFailed]=useState(false);
 const external=normalizedLinkOrigin(href??'')!==null;
 const hasImage=React.Children.toArray(children).some(child=>React.isValidElement(child)&&child.type==='img');
 useEffect(()=>{
  setIcon(null);setFailed(false);
  if(!external||hasImage)return;
  const node=anchor.current;
  if(!node)return;
  let active=true;
  const start=()=>void resolveRemoteIcon(href??'').then(url=>{if(active)setIcon(url);});
  if(typeof IntersectionObserver==='undefined'){start();return()=>{active=false;};}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();start();}},{rootMargin:'180px'});
  observer.observe(node);
  return()=>{active=false;observer.disconnect();};
 },[href,external,hasImage]);
 return <a {...props} href={href} ref={anchor} className={['rk-smart-link',props.className??''].join(' ')}>
  {external&&!hasImage&&(icon&&!failed
   ?<img src={icon} alt="" className="rk-site-favicon" aria-hidden="true" decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
   :<IconLink size="1em" aria-hidden="true" className="rk-link-fallback"/>)}
  {children}
 </a>;
}
