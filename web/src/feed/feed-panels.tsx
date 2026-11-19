import {useCallback} from 'react';
import {useQuery} from '@tanstack/react-query';
import {WorkspacePanel} from '../workspace-panels';
import {api} from '../api';
import {ErrorText,LoadingRows} from '../pages/shared';
import {FeedDetail,type FeedDetailItem} from './feed-detail';
import type {FeedStateInput} from '../../../src/feed-model';

export type FeedPanelSession={id:string;open:boolean;activation:number};

function FeedDetailPanel({session,busy,onClose,onAfterClose,onAction}:{
 session:FeedPanelSession;busy:boolean;onClose:(id:string)=>void;onAfterClose:(id:string)=>void;
 onAction:(id:string,input:FeedStateInput)=>void;
}){
 const {id}=session;
 const detail=useQuery({
  queryKey:['feed','item',id],
  enabled:session.open,
  queryFn:({signal})=>api<{item:FeedDetailItem}>('/feed/'+id,{signal})
 });
 const handleOpenChange=useCallback((open:boolean)=>{if(!open)onClose(id);},[id,onClose]);
 const handleAfterClose=useCallback(()=>onAfterClose(id),[id,onAfterClose]);
 return <WorkspacePanel id={'feed-detail-'+id} label="动态详情"
  title={detail.data?.item.title??'动态详情'}
  reserveSpace={false} open={session.open} activationKey={session.activation}
  onOpenChange={handleOpenChange} onAfterClose={handleAfterClose}>
  {detail.isPending?<div className="feed-panel-loading"><LoadingRows kind="activity" count={3}/></div>:
   detail.isError?<div className="feed-panel-error"><ErrorText error={detail.error}/></div>:
   detail.data?<FeedDetail item={detail.data.item} busy={busy}
    onAction={input=>onAction(id,input)}/>:null}
 </WorkspacePanel>;
}

/** Each Feed item owns a separate panel, like the independent task editors. */
export function FeedPanels({sessions,busy,onClose,onAfterClose,onAction}:{
 sessions:FeedPanelSession[];busy:string|null;
 onClose:(id:string)=>void;onAfterClose:(id:string)=>void;
 onAction:(id:string,input:FeedStateInput)=>void;
}){
 return <>{sessions.map(session=><FeedDetailPanel key={session.id} session={session}
  busy={busy===session.id} onClose={onClose} onAfterClose={onAfterClose} onAction={onAction}/>)}</>;
}
