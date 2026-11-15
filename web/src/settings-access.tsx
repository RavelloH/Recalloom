import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {sessionLabel} from './session-label';
import {fmt} from './pages/shared';
import type {Session} from './types';

export function SessionRow({session,current,pending,onRevoke}:{session:Session;current:boolean;pending:boolean;onRevoke:()=>void}){
 const [expanded,setExpanded]=useState(false),device=sessionLabel(session.userAgent);
 return <div className="session-row"><div className="session-details">
  <div className="access-title"><strong>{device.browser} · {device.platform}</strong>{current&&<Badge label="当前会话"/>}</div>
  <p className="muted small">最近活动 {fmt(session.lastSeenAt)} · 登录于 {fmt(session.createdAt)}</p>
  <Collapsible trigger="会话详情" isOpen={expanded} onOpenChange={setExpanded}><div className="access-details"><p className="muted small">到期时间 {fmt(session.expiresAt)}</p><p className="muted small access-agent">{session.userAgent||'未提供浏览器标识'}</p></div></Collapsible>
 </div><Button label={current?'退出此会话':'撤销会话'} variant="secondary" size="sm" isLoading={pending} onClick={onRevoke}/></div>;
}

export function AccessList({children,count}:{children:React.ReactNode;count:number}){
 return <AutoResizer><AutoTransition transitionKey={count} duration={.16}><div className="access-list">{children}</div></AutoTransition></AutoResizer>;
}

const scopeLabels:Record<string,string>={'notes:read':'读取内容','notes:write':'修改内容'};
export function GrantScopes({scopes}:{scopes:string[]}){
 return <div className="grant-scopes">{scopes.length?scopes.map(scope=><span key={scope} title={scope}><Badge label={scopeLabels[scope]??scope}/></span>):<span>未声明权限范围</span>}</div>;
}
