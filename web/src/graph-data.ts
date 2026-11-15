import {useEffect,useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {graphQuery} from './queries';
import {mergeGraphNodes,visibleGraphEdges} from './graph-layout';
import type {KnowledgeNode} from './graph-types';

export function useGraphData(focus:string|undefined,semantic:boolean){
 const overview=useQuery(graphQuery(undefined,false));
 const focused=useQuery({...graphQuery(focus,false),enabled:Boolean(focus)});
 const enrichment=useQuery({...graphQuery(focus,true),enabled:semantic});
 const local=focus?focused.data:undefined,extra=semantic?enrichment.data:undefined;
 const [visited,setVisited]=useState<KnowledgeNode[]>([]);
 useEffect(()=>{
  if(!focus)return;
  setVisited(current=>{
   const next=mergeGraphNodes(current,local?.nodes,extra?.nodes).slice(-240);
   return next.length===current.length&&next.every((node,index)=>node===current[index])?current:next;
  });
 },[focus,local,extra]);
 const nodes=useMemo(()=>mergeGraphNodes(visited,overview.data?.nodes,local?.nodes,extra?.nodes),[visited,overview.data,local,extra]);
 const edges=useMemo(()=>visibleGraphEdges([
  ...(overview.data?.edges??[]),...(local?.edges??[]),...(extra?.edges??[])
 ],semantic,focus),[overview.data,local,extra,semantic,focus]);
 const error=overview.error??(focus?focused.error:null);
 const loading=overview.isFetching||Boolean(focus&&focused.isFetching);
 const semanticStatus=semantic?enrichment.isError?'unavailable':extra?.semanticStatus??'indexing':'disabled';
 const refresh=()=>Promise.allSettled([overview.refetch(),...(focus?[focused.refetch()]:[]),...(semantic?[enrichment.refetch()]:[])]);
 return {nodes,edges,error,loading,semanticStatus,semanticLoading:semantic&&enrichment.isFetching,refresh};
}
