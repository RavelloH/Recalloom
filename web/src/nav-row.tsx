import React from 'react';
import {Link} from '@tanstack/react-router';
import {Icon,type IconName} from './icon';
type Props={icon:IconName;label:string;trailing?:React.ReactNode;className?:string;onClick?:()=>void}&({to:string;exact?:boolean}|{to?:never;title?:string});
export function NavRow(props:Props){
 const {icon,label,trailing,className='',onClick}=props;
 const content=<><Icon name={icon}/><span className="rk-nav-row-label">{label}</span>{trailing&&<span className="rk-nav-row-trailing">{trailing}</span>}</>;
 const classes='nav-link rk-nav-row'+(className?' '+className:'');
 if(props.to!==undefined)return <Link to={props.to as '/'} activeOptions={{exact:props.exact??false}} activeProps={{className:classes+' active'}} className={classes} onClick={onClick}>{content}</Link>;
 return <button type="button" title={props.title} className={classes} onClick={onClick}>{content}</button>;
}
