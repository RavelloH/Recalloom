import {Children,isValidElement,useState,type ReactNode} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Card} from '@astryxdesign/core/Card';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {sessionLabel} from './session-label';
import {Icon} from './icon';
import {Empty,ErrorText,LoadingRows,fmt} from './pages/shared';
import type {Session} from './types';

export type AgentGrant={id:string;clientId:string;clientName:string;scope:string[];createdAt:number;expiresAt:number|null;redirectHost:string|null};

function AccessDetails({children,label}:{children:ReactNode;label:string}){
 const [expanded,setExpanded]=useState(false),reduced=useReducedMotion();
 return <div className="access-disclosure">
  <Button label={label} variant="ghost" size="sm" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)} endContent={
   <motion.span className="access-chevron" animate={{rotate:expanded?180:0}} transition={{duration:reduced?0:.18}}><Icon name="chevronDown" size="sm"/></motion.span>
  }/>
  <AutoResizer><AutoTransition transitionKey={expanded?'open':'closed'} duration={.16}>{expanded?<div className="access-details">{children}</div>:null}</AutoTransition></AutoResizer>
 </div>;
}

export function SessionRow({session,current,pending,disabled,onRevoke}:{session:Session;current:boolean;pending:boolean;disabled:boolean;onRevoke:()=>void}){
 const device=sessionLabel(session.userAgent);
 return <div className={'session-row'+(current?' is-current':'')}>
  <span className="access-icon" aria-hidden="true"><Icon name="lock" size="md"/></span>
  <div className="session-details">
   <div className="access-title"><strong>{device.browser} · {device.platform}</strong>{current&&<Badge label="当前会话"/>}</div>
   <p className="access-meta muted small">最近活动 <time dateTime={new Date(session.lastSeenAt).toISOString()}>{fmt(session.lastSeenAt)}</time></p>
   <p className="access-meta muted small">登录于 {fmt(session.createdAt)}</p>
   <AccessDetails label="会话详情"><p className="muted small">到期时间 {fmt(session.expiresAt)}</p><p className="muted small access-agent">{session.userAgent||'未提供浏览器标识'}</p></AccessDetails>
  </div>
  <Button label={current?'退出此会话':'撤销会话'} variant="ghost" size="sm" isLoading={pending} isDisabled={disabled} onClick={onRevoke}/>
 </div>;
}

const scopeLabels:Record<string,string>={'notes:read':'读取内容','notes:write':'修改内容'};
function GrantScopes({scopes}:{scopes:string[]}){
 return <div className="grant-scopes">{scopes.length?scopes.map(scope=><span key={scope} title={scope}><Badge label={scopeLabels[scope]??scope}/></span>):<span className="muted small">未声明权限范围</span>}</div>;
}

export function GrantRow({grant,pending,disabled,onRevoke}:{grant:AgentGrant;pending:boolean;disabled:boolean;onRevoke:()=>void}){
 return <div className="grant-row">
  <span className="access-icon" aria-hidden="true"><Icon name="shield" size="md"/></span>
  <div className="grant-details">
   <div className="access-title"><strong>{grant.clientName}</strong></div>
   <p className="access-meta muted small">{grant.redirectHost||'OAuth 客户端'} · 授权于 {fmt(grant.createdAt*1000)}</p>
   <GrantScopes scopes={grant.scope}/>
   <AccessDetails label="授权详情"><p className="muted small">{grant.expiresAt?'到期时间 '+fmt(grant.expiresAt*1000):'未设置到期时间'}</p><p className="muted small access-agent">客户端标识 <code>{grant.clientId}</code></p></AccessDetails>
  </div>
  <Button label="撤销授权" variant="ghost" size="sm" isLoading={pending} isDisabled={disabled} onClick={onRevoke}/>
 </div>;
}

export function AccessList({children}:{children:ReactNode}){
 const reduced=useReducedMotion();
 return <AutoResizer><div className="access-list"><AnimatePresence initial={false} mode="popLayout">
  {Children.toArray(children).map(child=><motion.div className="access-entry" key={isValidElement(child)?child.key:undefined} layout="position" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:reduced?0:.2}}>{child}</motion.div>)}
 </AnimatePresence></div></AutoResizer>;
}

export function AccessSection({title,description,count,pending,error,refreshing,onRefresh,emptyTitle,emptyDescription,children,footer}:{
 title:string;description:string;count:number;pending:boolean;error:unknown;refreshing:boolean;onRefresh:()=>void;emptyTitle:string;emptyDescription?:string;children:ReactNode;footer?:ReactNode;
}){
 const state=pending?'loading':error&&!count?'error':count?'ready':'empty';
 return <Card className="settings-panel access-panel" padding={5}>
  <header className="access-section-header"><div><h2>{title}</h2><AutoTransition as="span" transitionKey={pending?'pending':count}><span className="muted small">{pending?'正在读取…':count+' 项'}</span></AutoTransition></div><Button label="刷新" size="sm" variant="ghost" icon={<Icon name="refresh" size="sm"/>} isLoading={refreshing&&!pending} isDisabled={pending} onClick={onRefresh}/></header>
  <p className="access-section-description muted small">{description}</p>
  <AutoResizer><AutoTransition transitionKey={state}>
   {state==='loading'?<LoadingRows kind="compact" count={3}/>:state==='error'?<ErrorText error={error}/>:state==='empty'?<Empty title={emptyTitle} description={emptyDescription}/>:<><AutoResizer>{Boolean(error)&&<ErrorText error={error}/>}</AutoResizer><AccessList>{children}</AccessList></>}
  </AutoTransition></AutoResizer>
  <AutoResizer>{footer}</AutoResizer>
 </Card>;
}
