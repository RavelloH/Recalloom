import {useEffect,useState} from 'react';
import {useNavigate,useRouterState} from '@tanstack/react-router';
import {useQuery,useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';
import {TabList,Tab} from '@astryxdesign/core/TabList';
import {Icon,type IconName} from '../icon';
import {SessionRow,GrantRow,AccessSection,type AgentGrant} from '../settings-access';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {api,sessions,queryString} from '../api';
import {useAppearance} from '../theme';
import {useConfirmDialog} from '../confirm-dialog';
import {SettingsIndexing} from '../settings-indexing';
import {SettingsStorage} from '../settings-storage';
import {PageTitle,ErrorText} from './shared';

const destinations:Array<{to:string;name:string;icon:IconName}>=[
 {to:'/settings',name:'偏好',icon:'settings'},
 {to:'/settings/oauth',name:'Agent 授权',icon:'shield'},
 {to:'/settings/sessions',name:'登录会话',icon:'lock'},
 {to:'/settings/indexing',name:'索引',icon:'database'},
 {to:'/settings/storage',name:'存储',icon:'database'},
 {to:'/settings/backup',name:'备份',icon:'backup'}
];

export function SettingsPage(){
 const {confirm,confirmation}=useConfirmDialog();
 const {density,setDensity}=useAppearance();
 // Read committed matches so outgoing native view-transition snapshots retain
 // their original section while the next destination is being prepared.
 const pathname=useRouterState({select:state=>state.matches.at(-1)?.pathname??state.location.pathname});
 const qc=useQueryClient(),navigate=useNavigate();
 const [error,setError]=useState<unknown>(null),[pending,setPending]=useState<string|null>(null);
 const oauth=pathname.endsWith('/oauth'),ses=pathname.endsWith('/sessions');
 const idx=pathname.endsWith('/indexing'),storage=pathname.endsWith('/storage'),backup=pathname.endsWith('/backup');
 const ss=useQuery({queryKey:['sessions'],queryFn:sessions,enabled:ses});
 const grants=useInfiniteQuery({
  queryKey:['oauth-grants'],initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>api<{items:AgentGrant[];cursor:string|null}>('/auth/oauth-grants'+(pageParam?'?'+queryString({cursor:pageParam}):''),{signal}),
  getNextPageParam:last=>last.cursor??undefined,enabled:oauth
 });
 const grantItems=grants.data?.pages.flatMap(page=>page.items)??[];
 const sessionItems=[...(ss.data?.items??[])].sort((a,b)=>Number(b.id===ss.data?.currentSessionId)-Number(a.id===ss.data?.currentSessionId)||b.lastSeenAt-a.lastSeenAt);
 useEffect(()=>setError(null),[pathname]);

 const revoke=async(id:string)=>{
  if(pending)return;
  const current=id===ss.data?.currentSessionId;
  if(!await confirm({title:current?'退出当前会话？':'撤销登录会话？',description:current?'退出后会返回登录页，下次访问需要重新登录。':'撤销后，对应浏览器需要重新登录。',actionLabel:current?'退出此会话':'撤销会话',destructive:true}))return;
  setPending(id);setError(null);
  try{
   await api('/auth/sessions/'+id,{method:'DELETE'});
   if(current){qc.clear();await navigate({to:'/login'});}
   else await qc.invalidateQueries({queryKey:['sessions']});
  }catch(error){setError(error);}finally{setPending(null);}
 };
 const revokeGrant=async(id:string)=>{
  if(pending)return;
  if(!await confirm({title:'撤销 Agent 授权？',description:'此操作将使该 Agent 的访问和刷新令牌失效，重新使用时必须再次完成 OAuth 授权。',actionLabel:'撤销授权',destructive:true}))return;
  setPending(id);setError(null);
  try{await api('/auth/oauth-grants/'+encodeURIComponent(id),{method:'DELETE'});await qc.invalidateQueries({queryKey:['oauth-grants']});}
  catch(error){setError(error);}finally{setPending(null);}
 };

 return <div className="page">{confirmation}
  <PageTitle title={oauth?'Agent 授权':ses?'登录会话':idx?'索引状态':storage?'存储':backup?'备份':'设置'} description="管理个人使用体验和本实例状态"/>
  <TabList className="settings-nav" aria-label="设置页面" value={pathname} onChange={()=>{}} size="md" overflow="scroll">
   {destinations.map(({to,name,icon})=><Tab key={to} href={to} value={to} label={name} className={'settings-tab'+(pathname===to?' active':'')} icon={<Icon name={icon} size="sm"/>}/>)}
  </TabList>
  <AutoResizer><AutoTransition transitionKey={error?'error':'none'}>{Boolean(error)&&<ErrorText error={error}/>}</AutoTransition></AutoResizer>
  {pathname==='/settings'&&<Card className="settings-panel" padding={5}>
   <h2>显示偏好</h2><p className="muted small">主题可在侧边栏底部切换：跟随系统、浅色、深色。</p>
   <div className="settings-field"><Selector label="界面密度" width="100%" value={density} onChange={value=>setDensity(value as typeof density)} options={[{value:'comfortable',label:'标准'},{value:'compact',label:'紧凑'}]}/></div>
  </Card>}
  {oauth&&<AccessSection title="已授权的 Agent" description="查看客户端及其访问权限。撤销授权后，相关访问和刷新令牌会失效。"
   count={grantItems.length} pending={grants.isPending} error={grants.error} refreshing={grants.isFetching}
   onRefresh={()=>void grants.refetch()} emptyTitle="暂无已授权 Agent" emptyDescription="Agent 通过 OAuth 连接后会显示在这里。"
   footer={<AutoTransition transitionKey={grants.hasNextPage?'more':'done'}>{grants.hasNextPage&&<div className="access-load-more"><Button label={grants.isFetchNextPageError?'加载失败，重试':'加载更多授权'} size="sm" variant="ghost" isLoading={grants.isFetchingNextPage} onClick={()=>void grants.fetchNextPage()}/></div>}</AutoTransition>}
  >{grantItems.map(grant=><GrantRow key={grant.id} grant={grant} pending={pending===grant.id} disabled={Boolean(pending)&&pending!==grant.id} onRevoke={()=>void revokeGrant(grant.id)}/>)}</AccessSection>}
  {ses&&<AccessSection title="已登录的会话" description="当前会话置顶，其余按最近活动排序。撤销后，对应浏览器需要重新登录。"
   count={sessionItems.length} pending={ss.isPending} error={ss.error} refreshing={ss.isFetching}
   onRefresh={()=>void ss.refetch()} emptyTitle="暂无登录会话"
  >{sessionItems.map(session=><SessionRow key={session.id} session={session} current={session.id===ss.data?.currentSessionId} pending={pending===session.id} disabled={Boolean(pending)&&pending!==session.id} onRevoke={()=>void revoke(session.id)}/>)}</AccessSection>}
  {idx&&<SettingsIndexing/>}
  {storage&&<SettingsStorage/>}
  {backup&&<Card className="settings-panel" padding={5}><h2>备份</h2><p className="muted">网页备份管理尚未开放。当前可通过 MCP 快照工具或 Cloudflare D1 官方备份完成备份。为了安全，网页不会提供尚未验证的恢复按钮。</p></Card>}
 </div>;
}
