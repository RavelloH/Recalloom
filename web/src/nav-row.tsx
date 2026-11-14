import React from 'react';
import {Link} from '@tanstack/react-router';
import {Button} from '@astryxdesign/core/Button';
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
 onPointerEnter?:()=>void;
 onFocus?:()=>void;
 to?:NavigationPath;
 exact?:boolean;
};

/** Route links retain router navigation; actions use the shared button control. */
export function NavRow({icon,label,className='',title,trailing,onClick,onPointerEnter,onFocus,to,exact}:RowProps){
 const classes=['nav-link','rk-nav-row',className].filter(Boolean).join(' ');
 const content=<><Icon name={icon} size="md"/><span className="rk-nav-row-label">{label}</span>{trailing&&<span className="rk-nav-row-trailing">{trailing}</span>}</>;
 if(to!==undefined) return <Link to={to} className={classes} activeProps={{className:classes+' active'}} activeOptions={{exact}} title={title} onPointerEnter={onPointerEnter} onFocus={onFocus} onClick={onClick}>{content}</Link>;
 return <Button label={label} className={classes+' rk-nav-row-action'}
  variant={className.split(/\s+/).includes('is-danger')?'destructive':'ghost'} width="100%"
  icon={<Icon name={icon} size="md"/>} endContent={trailing&&<span className="rk-nav-row-trailing">{trailing}</span>}
  tooltip={title} onPointerEnter={onPointerEnter} onFocus={onFocus} onClick={onClick}/>;
}
