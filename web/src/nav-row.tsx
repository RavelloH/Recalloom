import React from 'react';
import {Link} from '@tanstack/react-router';
import {Icon,type IconName} from './icon';
import type {menu} from './navigation';

type NavigationPath=(typeof menu)[number]['to'];
type RowProps={
 icon:IconName;
 label:string;
 className?:string;
 title?:string;
 trailing?:React.ReactNode;
 onClick?:()=>void;
 to?:NavigationPath;
 exact?:boolean;
};

/** Link and button share the same icon/text/trailing slots and geometry.
 * Avoid Astryx Button internal wrappers in sidebar navigation. */
export function NavRow({icon,label,className='',title,trailing,onClick,to,exact}:RowProps){
 const classes=['nav-link','rk-nav-row',className].filter(Boolean).join(' ');
 const content=<><Icon name={icon} size="md"/><span className="rk-nav-row-label">{label}</span>{trailing&&<span className="rk-nav-row-trailing">{trailing}</span>}</>;
 if(to!==undefined) return <Link to={to} className={classes} activeProps={{className:classes+' active'}} activeOptions={{exact}} title={title} onClick={onClick}>{content}</Link>;
 return <button type="button" className={classes} title={title} onClick={onClick}>{content}</button>;
}
