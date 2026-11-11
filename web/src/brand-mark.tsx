import {useId} from 'react';

/** The same single-stroke, interwoven R used for the site favicon. */
export function BrandMark({className}:{className?:string}){
 const prefix=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 const id=(name:string)=>prefix+'-'+name;
 return <svg className={className} viewBox="110 110 804 804" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="89.4" strokeLinecap="round" strokeLinejoin="round">
  <defs>
   <path id={id('a')} d="M390.0 819.4 L390.0 400.2 A223.5 223.5 0 1 1 660.0 618.9"/>
   <path id={id('b')} d="M660.0 618.9 L353.8 684.0 A138.2 138.2 0 0 1 186.9 548.8"/>
   <path id={id('c')} d="M186.9 548.8 A138.2 138.2 0 0 1 420.6 449.0"/>
   <path id={id('d')} d="M420.6 449.0 L807.9 819.4"/>
   <path id={id('oa')} d="M227.4 451.1 A138.2 138.2 0 0 1 420.6 449.0 L501.4 526.2"/>
   <path id={id('ob')} d="M390.0 819.4 L390.0 400.2"/>
   <path id={id('od')} d="M837.0 400.2 A223.5 223.5 0 0 1 660.0 618.9 L353.8 684.0"/>
   <mask id={id('ma')} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><use href={'#'+id('oa')} fill="none" stroke="#000" strokeWidth="125.4" strokeLinecap="butt" strokeLinejoin="round"/></mask>
   <mask id={id('mb')} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><use href={'#'+id('ob')} fill="none" stroke="#000" strokeWidth="125.4" strokeLinecap="butt" strokeLinejoin="round"/></mask>
   <mask id={id('md')} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><use href={'#'+id('od')} fill="none" stroke="#000" strokeWidth="125.4" strokeLinecap="butt" strokeLinejoin="round"/></mask>
  </defs>
  <use href={'#'+id('a')} mask={'url(#'+id('ma')+')'}/>
  <use href={'#'+id('b')} mask={'url(#'+id('mb')+')'}/>
  <use href={'#'+id('c')}/>
  <use href={'#'+id('d')} mask={'url(#'+id('md')+')'}/>
 </svg>;
}
