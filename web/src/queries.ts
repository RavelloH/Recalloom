import {QueryClient,infiniteQueryOptions,queryOptions} from '@tanstack/react-query';
import {api,activity,browse,queryString,record,tasks} from './api';
import type {Event} from './types';

/** One client for React and route loaders, so a loader-warmed cache is what pages read. */
export const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:15_000,refetchOnWindowFocus:false}}});

export type FolderDetail={id:string;name:string;parentId:string|null;description?:string;metadataRevision:number};
export type SearchMode='auto'|'literal'|'metadata'|'semantic'|'hybrid';
export type SearchHit={id:string;name:string;kind?:string;description?:string;snippet?:string;path?:string;score?:number;source?:'literal'|'metadata'|'semantic'|'hybrid'};
export type SearchResult={items:SearchHit[];indexMayLag?:boolean;degraded?:boolean};

export const recordQuery=(id:string)=>queryOptions({queryKey:['record',id],queryFn:()=>record(id)});
export const folderQuery=(id:string)=>queryOptions({queryKey:['folder',id],queryFn:()=>api<FolderDetail>('/folders/'+id)});
export const folderPagesQuery=(folderId:string|null)=>infiniteQueryOptions({
 queryKey:['browse-pages',folderId],
 initialPageParam:undefined as string|undefined,
 queryFn:({pageParam})=>browse(folderId,pageParam),
 getNextPageParam:last=>last.page.hasMore&&last.page.nextCursor!=null?String(last.page.nextCursor):undefined
});
export const tasksQuery=(recordId?:string)=>queryOptions({queryKey:['tasks',recordId??'all'],queryFn:()=>tasks(recordId?{recordId}:undefined)});
export const activityQuery=()=>queryOptions({queryKey:['activity'],queryFn:activity});
export const activityPagesQuery=()=>infiniteQueryOptions({
 queryKey:['recent-activity'],
 initialPageParam:undefined as number|undefined,
 queryFn:({pageParam})=>api<{items:Event[];page:{hasMore:boolean;nextCursor:number|null}}>('/activity?'+queryString({cursor:pageParam,limit:50})),
 getNextPageParam:last=>last.page.hasMore?last.page.nextCursor??undefined:undefined
});

/** The quick switcher and the search page share this query, so both show the same ranking. */
export const searchQuery=(query:string,mode:SearchMode='auto',limit=30)=>queryOptions({
 queryKey:['search',query,mode,limit],
 queryFn:async({signal})=>{
  const run=(m:SearchMode)=>api<SearchResult>('/search?'+queryString({query,mode:m,limit}),{signal});
  if(mode!=='auto')return run(mode);
  // Semantic search depends on Workers AI; when it is unavailable, keyword results still answer.
  try{return await run('auto');}catch(error){if(signal.aborted)throw error;return {...(await run('literal')),degraded:true};}
 },
 staleTime:30_000,
 enabled:query.trim().length>0
});
export const searchModes:Array<{value:SearchMode;label:string;hint:string}>=[
 {value:'auto',label:'智能',hint:'关键词与语义结合'},
 {value:'literal',label:'关键词',hint:'标题与正文中的精确文本'},
 {value:'metadata',label:'名称',hint:'只匹配名称与描述'},
 {value:'semantic',label:'语义',hint:'按含义查找相关片段'}
];
export const isSearchMode=(value:unknown):value is SearchMode=>typeof value==='string'&&['auto','literal','metadata','semantic','hybrid'].includes(value);
