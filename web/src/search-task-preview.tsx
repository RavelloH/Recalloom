import {useQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {api,queryString} from './api';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {SearchHighlight} from './search-highlight';
import {TaskStatusIcon} from './tasks/items';
import {statusLabels,type TaskItemsPage} from './tasks/data';

export default function SearchTaskPreview({recordId,revision,query,exact}:{recordId:string;revision?:number;query:string;exact:boolean}){
 const tasks=useQuery({
  queryKey:['task-workspace','search-preview',recordId,revision,query,exact],
  queryFn:async({signal})=>{
   const load=(text?:string)=>api<TaskItemsPage>('/tasks/view?'+queryString({recordId,query:text,limit:6,order:'board'}),{signal});
   const matches=await load(exact?query:undefined);
   return matches.items.length||!exact||!query?matches:load();
  },
  staleTime:15000
 });
 return <AutoResizer><AutoTransition transitionKey={tasks.isPending?'loading':tasks.isError?'error':'ready'} duration={.16}>
  {tasks.isPending?<div className="search-snippet-skeleton" role="status" aria-label="正在加载任务"><Skeleton width="85%" height={16}/><Skeleton width="70%" height={14}/></div>
   :tasks.isError?<div className="search-task-error"><span className="muted small">任务预览加载失败</span><Button label="重试加载任务" variant="ghost" size="sm" onClick={()=>void tasks.refetch()}>重试</Button></div>
   :<ul className="search-task-list" aria-label="任务预览">
    {tasks.data.items.map(task=><li key={task.id}>
     <TaskStatusIcon status={task.status}/>
     <div><strong><SearchHighlight text={task.title} query={query} enabled={exact}/></strong>
      {task.details&&<p><SearchHighlight text={task.details} query={query} enabled={exact}/></p>}
     </div>
     <span className="muted small">{statusLabels[task.status]}</span>
    </li>)}
    {!tasks.data.items.length&&<li className="muted small">暂无任务</li>}
   </ul>}
 </AutoTransition></AutoResizer>;
}
