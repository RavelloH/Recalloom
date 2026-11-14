import {Icon} from '../icon';
import {useState} from 'react';
import {useNavigate,useLocation} from '@tanstack/react-router';
import {useQuery,useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Banner} from '@astryxdesign/core/Banner';
import {Selector} from '@astryxdesign/core/Selector';
import {TabList,Tab} from '@astryxdesign/core/TabList';
import {api,sessions,queryString} from '../api';
import {useAppearance} from '../theme';
import {useConfirmDialog} from '../confirm-dialog';
import {WikiIndexPanel} from '../wiki-index-panel';
import {PageTitle,ErrorText,Loading,Empty,fmt} from './shared';

export function SettingsPage(){const {confirm:askConfirm,confirmation}=useConfirmDialog();const {density,setDensity}=useAppearance();const pathname=useLocation({select:state=>state.pathname});const qc=useQueryClient(),navigate=useNavigate();const [error,setError]=useState<unknown>(null);const ss=useQuery({queryKey:['sessions'],queryFn:sessions,enabled:pathname==='/settings/sessions'});
 const oauth=pathname.endsWith('/oauth');
 const grants=useInfiniteQuery({queryKey:['oauth-grants'],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>api<{items:Array<{id:string;clientId:string;clientName:string;scope:string[];createdAt:number;expiresAt:number|null;redirectHost:string|null}>;cursor:string|null}>('/auth/oauth-grants'+(pageParam?'?'+queryString({cursor:pageParam}):'')),getNextPageParam:last=>last.cursor??undefined,enabled:oauth});const index=useQuery({queryKey:['index'],queryFn:()=>api<{counts:Array<{state:string;count:number}>;recentFailures:Array<{id:string;lastError:string}>}>('/index'),enabled:pathname==='/settings/indexing'});
 const revoke=async(id:string)=>{if(!(await askConfirm({title:'撤销登录会话？',description:'撤销后对应浏览器需要重新登录，当前会话也可能随即退出。',actionLabel:'撤销会话',destructive:true})))return;try{await api('/auth/sessions/'+id,{method:'DELETE'});if(id===ss.data?.currentSessionId){qc.clear();navigate({to:'/login'});}else qc.invalidateQueries({queryKey:['sessions']});}catch(e){setError(e);}};
 const ses=pathname.endsWith('sessions'),idx=pathname.endsWith('indexing'),backup=pathname.endsWith('backup');const grantItems=grants.data?.pages.flatMap(page=>page.items)??[];
 const revokeGrant=async(id:string)=>{if(!(await askConfirm({title:'撤销 Agent 授权？',description:'此操作将使该 Agent 的访问和刷新令牌失效，重新使用时必须再次完成 OAuth 授权。',actionLabel:'撤销授权',destructive:true})))return;try{await api('/auth/oauth-grants/'+encodeURIComponent(id),{method:'DELETE'});await qc.invalidateQueries({queryKey:['oauth-grants']});}catch(e){setError(e);}};
 return <div className="page">{confirmation}<PageTitle title={oauth?'Agent 授权':ses?'登录会话':idx?'索引状态':backup?'备份':'设置'} description="管理个人使用体验和本实例状态"/><TabList className="settings-nav" aria-label="设置页面" value={pathname} onChange={()=>{}} size="md" overflow="scroll">{[{to:'/settings',name:'偏好',icon:"settings"},{to:'/settings/oauth',name:'Agent 授权',icon:"shield"},{to:'/settings/sessions',name:'登录会话',icon:"lock"},{to:'/settings/indexing',name:'索引状态',icon:"database"},{to:'/settings/backup',name:'备份',icon:"backup"}].map(({to,name,icon})=><Tab key={to} href={to} value={to} label={name} className="settings-tab" icon={<Icon name={icon as import("../icon").IconName} size="sm"/>}/>)}</TabList>{Boolean(error)&&<ErrorText error={error}/>}
 {pathname==='/settings'?<Card className="settings-panel" padding={5}><h2>显示偏好</h2><p className="muted small">主题可在侧边栏底部切换：跟随系统、浅色、深色。</p><div className="settings-field"><Selector label="界面密度" width="100%" value={density} onChange={v=>setDensity(v as typeof density)} options={[{value:"comfortable",label:"标准"},{value:"compact",label:"紧凑"}]}/></div></Card>:null}
 {oauth&&<Card className="settings-panel oauth-panel" padding={5}><h2>已授权的 Agent</h2><p className="muted small">在此撤销 OAuth 授权。撤销后相关令牌失效；重新连接时需要再次授权。</p>{grants.isPending?<Loading/>:grants.isError?<ErrorText error={grants.error}/>:grantItems.length?grantItems.map(g=><div className="grant-row" key={g.id}><div className="grant-details"><strong>{g.clientName}</strong><p className="muted small">{g.redirectHost||'OAuth 客户端'} · 授权于 {fmt(g.createdAt*1000)}</p><p className="grant-scopes">{g.scope.length?g.scope.join(' · '):'未声明权限范围'}</p></div><Button label="撤销授权" variant="secondary" size="sm" onClick={()=>revokeGrant(g.id)}/></div>):<Empty title="暂无已授权 Agent" description="Agent 通过 OAuth 连接后会显示在这里。"/>}{grants.hasNextPage&&<Button label="加载更多授权" size="sm" variant="secondary" isLoading={grants.isFetchingNextPage} onClick={()=>grants.fetchNextPage()}/>} </Card>}
 {ses&&<Card className="settings-panel" padding={5}><h2>已登录的会话</h2><p className="muted small">撤销后，对应浏览器需要重新输入 OAuth 授权密钥。</p>{ss.isPending?<Loading/>:ss.isError?<ErrorText error={ss.error}/>:ss.data?.items.map(s=><div className="session-row" key={s.id}><div><strong>{s.id===ss.data?.currentSessionId?'当前会话':'其他会话'}</strong><p className="muted small">{s.userAgent||'未知浏览器'} · {fmt(s.createdAt)}</p></div><Button label="撤销" variant="secondary" size="sm" onClick={()=>revoke(s.id)}/></div>)}</Card>}
 {idx&&<Card className="settings-panel" padding={5}><h2>向量索引状态</h2>{index.isPending?<Loading/>:index.isError?<ErrorText error={index.error}/>:<><div className="dashboard-stats">{index.data?.counts.map(x=><div className="stat" key={x.state}><Icon name="database" size="md"/><strong>{x.count}</strong><span>{x.state}</span></div>)}</div>{index.data?.recentFailures?.length>0&&<><h3>最近失败</h3>{index.data.recentFailures.map(x=><Banner key={x.id} status="error" container="section" title="索引失败" description={x.lastError}/>)}</>}</>}</Card>}
 {idx&&<WikiIndexPanel/>}
 {backup&&<Card className="settings-panel" padding={5}><h2>备份</h2><p className="muted">网页备份管理尚未开放。当前可通过 MCP 快照工具或 Cloudflare D1 官方备份完成备份。为了安全，网页不会提供尚未验证的恢复按钮。</p></Card>}
 </div>;
}
