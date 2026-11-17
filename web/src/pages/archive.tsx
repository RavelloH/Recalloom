import {useEffect,useMemo,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useInfiniteQuery} from '@tanstack/react-query';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '../icon';
import {WorkspaceToolbar,WorkspaceSearch} from '../workspace-toolbar';
import {Selector} from '@astryxdesign/core/Selector';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {archivedRecordsQuery,type ArchivedRecord,type ArchiveFilters} from '../queries';
import {AutoResizer,AutoTransition} from '../motion-primitives';
import {OverlayScroll} from '../scrollbars';
import {useTaskViewHeight,TaskLoadMore} from '../tasks/scroll';
import {ArchiveList} from '../archive/list';
import {ArchivePreview,ArchiveRestore,originalFolder,type ArchivePanelSession} from '../archive/panels';
import {useArchiveActions} from '../archive/actions';
import {PageTitle,ErrorText,LoadingRows,Empty} from './shared';

export function ArchivePage(){
 const [search,setSearch]=useState(''),[filter,setFilter]=useState(''),[kind,setKind]=useState('all'),[sort,setSort]=useState<NonNullable<ArchiveFilters['sort']>>('archived'),[grouped,setGrouped]=useState(false);
 const [selected,setSelected]=useState(new Set<string>()),[removed,setRemoved]=useState(new Set<string>());
 const [panels,setPanels]=useState<ArchivePanelSession[]>([]),sequence=useRef(0);
 const [restore,setRestore]=useState<{items:ArchivedRecord[];open:boolean;key:number}|null>(null);
 const [viewport,setViewport]=useState<HTMLDivElement|null>(null),view=useTaskViewHeight();
 useEffect(()=>{const timer=setTimeout(()=>setFilter(search.trim()),220);return()=>clearTimeout(timer);},[search]);
 const q=useInfiniteQuery(archivedRecordsQuery(filter,{kind:kind==='all'?undefined:kind as 'document'|'task_list',sort:grouped?'path':sort}));
 const items=useMemo(()=>q.data?.pages.flatMap(page=>page.items).filter(item=>!removed.has(item.id))??[],[q.data,removed]);
 const selectedItems=items.filter(item=>selected.has(item.id));
 const openRestore=(items:ArchivedRecord[])=>setRestore({items,open:true,key:++sequence.current});
 const actions=useArchiveActions(ids=>{
  setRemoved(current=>new Set([...current,...ids]));
  setSelected(current=>new Set([...current].filter(id=>!ids.includes(id))));
  setPanels(current=>current.map(panel=>ids.includes(panel.item.id)?{...panel,open:false}:panel));
 },openRestore);
 const scope=filter+'|'+kind+'|'+sort+'|'+grouped;
 useEffect(()=>setSelected(new Set()),[scope]);
 const groups=useMemo(()=>{
  if(!grouped)return [{name:'',items}];
  const groups=new Map<string,ArchivedRecord[]>();
  for(const item of items){
   const name=originalFolder(item),group=groups.get(name);
   if(group)group.push(item);else groups.set(name,[item]);
  }
  return [...groups].map(([name,items])=>({name,items}));
 },[items,grouped]);
 const select=(ids:string[],value:boolean)=>setSelected(current=>{const next=new Set(current);for(const id of ids)if(value)next.add(id);else next.delete(id);return next;});
 const preview=(item:ArchivedRecord)=>{const activation=++sequence.current;setPanels(current=>[...current.filter(panel=>panel.item.id!==item.id),{item,open:true,activation}]);};
 const resultKey=actions.results.map(item=>item.id+item.error).join('|');
 return <div className="page workspace-page archive-page">{actions.confirmation}
  <PageTitle title="归档" description="保留内容与历史版本，随时查看或恢复。" actions={<><IconButton label="刷新" icon={<Icon name="refresh" size="sm"/>} size="sm" variant="ghost" isDisabled={actions.busy} isLoading={q.isRefetching} onClick={()=>{void q.refetch().then(result=>{if(!result.isError)setRemoved(new Set());});}}/><Link to="/library" className="small text-link">返回知识库</Link></>}/>
  <WorkspaceToolbar filters={<>
   <Selector label="内容类型" isLabelHidden size="sm" variant="secondary" value={kind} onChange={setKind} options={[{value:'all',label:'全部类型'},{value:'document',label:'文稿'},{value:'task_list',label:'任务列表'}]}/>
   <Selector label="排序" isLabelHidden size="sm" variant="secondary" value={grouped?'path':sort} isDisabled={grouped} onChange={value=>setSort(value as typeof sort)} options={[{value:'archived',label:'最近归档'},{value:'oldest',label:'最早归档'},{value:'name',label:'按名称'},{value:'path',label:'按原位置'}]}/>
   <CheckboxInput label="按原文件夹分组" size="sm" value={grouped} onChange={setGrouped}/>
  </>} search={<WorkspaceSearch label="搜索归档" placeholder="搜索名称或原路径…" value={search} onChange={setSearch}/>} meta={<AutoTransition as="span" className="archive-count muted small" transitionKey={q.data?.pages[0]?.total??'loading'}>{q.data?q.data.pages[0].total+' 项':'读取中…'}</AutoTransition>}/>
  <AutoResizer><AutoTransition transitionKey={actions.busy?'busy':resultKey||'none'}><div className="archive-feedback" role="status" aria-live="polite">
   {actions.busy?<span className="muted small">{actions.progress}</span>:actions.results.length>0&&<><span className="small">{actions.results.filter(item=>!item.error).length} 项已完成{actions.results.some(item=>item.error)?'，'+actions.results.filter(item=>item.error).length+' 项需要处理':''}</span>{actions.results.filter(item=>item.error).map(item=><p className="archive-result-error small" key={item.id}>{item.name} · {item.error}</p>)}</>}
  </div></AutoTransition></AutoResizer>
  <AutoResizer><AutoTransition transitionKey={selectedItems.length?'selected':'none'}>{selectedItems.length>0&&<div className="archive-selection-bar"><AutoTransition as="span" className="small" transitionKey={selectedItems.length}>已选 {selectedItems.length} 项</AutoTransition>
   <Button label="恢复所选" variant="secondary" size="sm" isDisabled={actions.busy} onClick={()=>void actions.restore(selectedItems)}/>
   <Button label="恢复到…" variant="ghost" size="sm" isDisabled={actions.busy} onClick={()=>openRestore(selectedItems)}/>
   <Button label="永久删除" variant="ghost" size="sm" isDisabled={actions.busy} onClick={()=>void actions.remove(selectedItems)}/>
   <Button label="取消选择" variant="ghost" size="sm" isDisabled={actions.busy} onClick={()=>setSelected(new Set())}/>
  </div>}</AutoTransition></AutoResizer>
  <div className="archive-content" ref={view.ref} style={view.height?{height:view.height}:undefined}>
   <OverlayScroll className="archive-scroll" edges viewportRef={setViewport}>
    <AutoResizer><AutoTransition transitionKey={q.isPending?'loading':q.isError&&!q.data?'error':scope+'|'+items.map(item=>item.id).join(',')}>
     {q.isPending?<LoadingRows kind="files" count={5}/>:q.isError&&!q.data?<div><ErrorText error={q.error}/><Button label="重新加载归档" variant="ghost" onClick={()=>void q.refetch()}/></div>:items.length?<div className="archive-list">{groups.map(group=><section key={group.name} className="archive-group">
      {grouped&&<h2 className="archive-group-title" title={group.name}>{group.name} <span className="muted small">{group.items.length}{q.hasNextPage?' 项已加载':' 项'}</span></h2>}
      <ArchiveList items={group.items} selected={selected} onSelect={select} onPreview={preview} onRestore={item=>void actions.restore([item])} onRestoreTo={item=>openRestore([item])} onDelete={item=>void actions.remove([item])} busy={actions.busy}/>
     </section>)}</div>:<Empty title={filter||kind!=='all'?'没有符合条件的归档内容':'暂无归档内容'} description={filter||kind!=='all'?'调整搜索或类型筛选后重试。':'归档的文稿和任务列表会显示在这里，内容和历史版本都会保留。'}/>}
    </AutoTransition></AutoResizer>
    {q.data&&<TaskLoadMore root={viewport} hasMore={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onLoad={()=>void q.fetchNextPage()} animateWidth={false} loadingLabel="正在加载更多归档…"/>}
   </OverlayScroll>
  </div>
  {panels.map(panel=><ArchivePreview key={panel.item.id} session={panel} busy={actions.busy} onRestore={item=>openRestore([item])} onClose={()=>setPanels(current=>current.map(item=>item.item.id===panel.item.id?{...item,open:false}:item))} onRemove={()=>setPanels(current=>current.filter(item=>item.item.id!==panel.item.id||item.open))}/>) }
  {restore&&<ArchiveRestore key={restore.key} items={restore.items} open={restore.open} busy={actions.busy} results={actions.results.filter(result=>restore.items.some(item=>item.id===result.id))} onClose={()=>setRestore(current=>current?{...current,open:false}:null)} onRemove={()=>setRestore(current=>current?.open?current:null)} onRestore={async target=>{
   const pending=restore.items.filter(item=>!removed.has(item.id)).map(item=>items.find(current=>current.id===item.id)??item);
   const done=await actions.restore(pending,target);
   if(done)setRestore(current=>current?{...current,open:false}:null);
   return done;
  }}/>}
 </div>;
}
