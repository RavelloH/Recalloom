import React from 'react';
import {Link} from '@tanstack/react-router';
import {History} from 'lucide-react';
import type {Event} from './types';
const verbs:Record<string,string>={create:'创建',update:'更新',metadata:'修改信息',folder_update:'修改文件夹',tag_add:'添加标签',tag_remove:'移除标签',task_add:'新增任务',task_update:'更新任务',task_remove:'移除任务',restore:'恢复版本',link_add:'添加关联',link_remove:'移除关联',link_restore:'恢复关联',kind_migrate:'转换为文档'};
export function ActivityEntry({item,compact=false}:{item:Event;compact?:boolean}){
 const name=item.resourceName||'已移除的资源';
 const who=item.actorName||(item.actor?.startsWith('web:')?'本人（Web）':item.actor?.startsWith('grant:')?'未识别 Agent':item.actor?.startsWith('system:')?'系统':'未识别的历史操作方');
 const verb=verbs[item.operation||'']||item.operation||'修改';
 const time=item.createdAt?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(item.createdAt)):'—';
 const entity=item.entityId||item.recordId;
 const destination=item.entityType==='folder'?'/library/$folderId':'/records/$recordId';
 return <div className={compact?'recent-entry':'activity-row'} data-activity-seq={item.seq}>
   <span className="activity-icon"><History size={15}/></span>
   <div className="activity-main"><div className="activity-summary"><span className="activity-actor">{who}</span> <span className="muted">{verb}</span> {entity&&item.resourceName&&item.resourceName!=='已移除的资源'?(item.entityType==='folder'?<Link to="/library/$folderId" params={{folderId:entity}} className="activity-resource">{name}</Link>:<Link to="/records/$recordId" params={{recordId:entity}} className="activity-resource">{name}</Link>):<span className="activity-resource">{name}</span>}</div>
   {!compact&&<div className="muted tiny activity-description">{item.actorKind==='system'?'系统操作':item.entityType==='folder'?'文件夹':'记录'}{item.revision!=null?' · R'+item.revision:''}{item.clientName&&item.actorName!==item.clientName?' · '+item.clientName:''}</div>}</div>
   <time className="muted tiny" title={item.createdAt||''}>{time}</time>
 </div>;
}
