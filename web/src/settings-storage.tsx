import './styles/features/index-workspace.css';
import {useQuery} from '@tanstack/react-query';
import {Card} from '@astryxdesign/core/Card';
import {Button} from '@astryxdesign/core/Button';
import {api} from './api';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {Loading,ErrorText,fmt} from './pages/shared';
import {IndexChart} from './index-status-chart';
import {bytes,type StorageSummary} from './index-status-data';

export function SettingsStorage(){
 const report=useQuery({queryKey:['storage-summary'],queryFn:()=>api<StorageSummary>('/storage'),staleTime:60_000}),data=report.data;
 const dimensions=data?.remote.dimensions;
 return <div className="index-workspace"><div className="index-toolbar"><div><h2>存储容量</h2><p className="muted small">查询于 {fmt(data?.sampledAt)} · 远端指标可能延迟</p></div><Button size="sm" variant="secondary" label="刷新" isLoading={report.isFetching} onClick={()=>void report.refetch()}/></div>
  {report.isError&&<ErrorText error={report.error}/>}<AutoResizer><AutoTransition transitionKey={data?'ready':'loading'}>{!data?<Loading/>:<div className="storage-sections">
   <div className="index-metrics">{[
    {title:'文稿',value:data.documents.count+' 篇',hint:'其中 '+data.documents.archived+' 篇已归档'},
    {title:'索引文本块',value:data.chunks.count+' 块',hint:'覆盖 '+data.chunks.documents+' 篇文稿'},
    {title:'远端向量',value:data.remote.count==null?'暂不可用':data.remote.count+' 条',hint:'查询于 '+fmt(data.remote.sampledAt)},
    {title:'D1 实际总大小',value:bytes(data.databaseBytes),hint:'包含正文、历史、索引及数据库结构'}
   ].map(metric=><Card padding={4} key={metric.title}><span className="muted small">{metric.title}</span><AutoTransition transitionKey={metric.value}><strong className="storage-value">{metric.value}</strong></AutoTransition><p className="muted small">{metric.hint}</p></Card>)}</div>
   <Card padding={4}><h3>逻辑数据量</h3><dl className="index-properties"><dt>当前正文</dt><dd>{bytes(data.documents.bytes)}</dd><dt>版本历史元数据</dt><dd>{bytes(data.histories.bytes)} · {data.histories.revisions} 个版本</dd><dt>索引文本</dt><dd>{bytes(data.chunks.bytes)}</dd><dt>原始向量数据量估算</dt><dd>{data.remote.count!=null&&dimensions?bytes(data.remote.count*dimensions*4):'暂不可用'}</dd></dl><p className="muted small">文本按 UTF-8 字节统计。索引文本包含分块重叠；历史采用项目的版本元数据格式。向量估算按每维 4 字节计算，不含元数据、检索结构及服务端开销。这些口径不同，不能相加作为实际占用。</p></Card>
   <IndexChart title="文稿大小分布" description="按当前正文 UTF-8 字节统计，包含归档文稿；不含历史和索引" data={data.documents.count?data.sizeBuckets:[]} kind="bar" fields={[{key:'count',label:'文稿数'}]}/>

  </div>}</AutoTransition></AutoResizer>
 </div>;
}
