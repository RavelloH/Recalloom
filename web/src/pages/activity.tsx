import {Icon} from '../icon';
import {useInfiniteQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {ActivityEntry} from '../activity-entry';
import {activityPagesQuery} from '../queries';
import {PageTitle,ErrorText,Loading,Empty} from './shared';

export function ActivityPage(){const q=useInfiniteQuery(activityPagesQuery());const items=q.data?.pages.flatMap(p=>p.items)??[];return <div className="page"><PageTitle title="活动" description="用户与 Agent 对知识库的修改记录" actions={<Button label="刷新" size="sm" icon={<Icon name="refresh" size="sm"/>} onClick={()=>q.refetch()}/>}/>{q.isPending?<Loading/>:q.isError?<ErrorText error={q.error}/>:items.length?<Card className="activity-list" padding={4}>{items.map(event=><ActivityEntry key={event.seq} item={event}/>)}</Card>:<Empty title="暂无活动记录"/>}{q.hasNextPage&&<div className="load-more"><Button label="加载更多" size="sm" variant="ghost" onClick={()=>q.fetchNextPage()} isLoading={q.isFetchingNextPage}/></div>}</div>}
