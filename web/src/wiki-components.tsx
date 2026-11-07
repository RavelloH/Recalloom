import React from 'react';
import {Link} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {FileInput,Link2,AlertCircle,ExternalLink} from 'lucide-react';
import {api,record} from './api';
import {queryString} from './api';
import type {RecordDetail} from './types';
import {slugHeading,headingAnchor} from './wiki-slug';

export type ResolvedWiki={
 target:string;targetId:string|null;status:'resolved'|'missing'|'path_changed';
 name?:string;path?:string;kind?:string;revision?:number
};
const decode=(text:string)=>{try{return decodeURIComponent(text)}catch{return text}};
export const wikiResolution=(target:string,sourceId?:string)=>({
 queryKey:['wiki-resolve',sourceId??'',target],
 queryFn:()=>api<ResolvedWiki>('/wiki/resolve?'+queryString({target,sourceId})),
 staleTime:30_000
});
const makeHash=(anchor?:string|null)=>slugHeading(anchor??'');
function section(content:string,anchor?:string|null):string{
 if(!anchor)return content;
 const slug=makeHash(anchor);
 const lines=content.split(/\r?\n/);
 let from=-1,level=0;
 for(let i=0;i<lines.length;i++){
  const h=/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]??'');
  if(!h)continue;
  if(from<0&&makeHash(h[2])===slug){from=i;level=h[1].length;continue;}
  if(from>=0&&h[1].length<=level)return lines.slice(from,i).join('\n');
 }
 return from>=0?lines.slice(from).join('\n'):'';
}

/** Browser-side resolver is deliberately read-only. A path reference with a
 * known source binding continues pointing at the original UUID after rename. */
export function WikiInline({target,alias,anchor,sourceId,plain=false}:{
 target:string;alias?:string|null;anchor?:string|null;sourceId?:string;plain?:boolean
}){
 const q=useQuery(wikiResolution(target,sourceId));
 const label=alias||q.data?.name||(target.startsWith('id:')?'文档 '+target.slice(3,11):target);
 if(q.isPending)return <span className="wiki-link is-loading" title={target}>{label}</span>;
 if(q.isError||!q.data?.targetId)return <span className="wiki-link is-missing" title={'引用未解析：'+target}>
  <AlertCircle size={12}/>{alias||target}
 </span>;
 return <Link to="/records/$recordId" params={{recordId:q.data.targetId}} hash={anchor?headingAnchor(anchor):''}
  className={'wiki-link'+(q.data.status==='path_changed'?' is-stale':'')+(plain?' is-plain':'')}
  title={q.data.status==='path_changed'?'原路径已变更，链接仍指向首次绑定的文档':'打开 '+q.data.name}>
  <Link2 size={13}/>{label}{anchor&&<span className="wiki-link-anchor">#{anchor}</span>}
 </Link>;
}
export function WikiEmbed({target,anchor,sourceId,trail=[],depth=0,render}:{
 target:string;anchor?:string|null;sourceId?:string;trail?:string[];depth?:number;
 render:(content:string,id:string,trail:string[],depth:number)=>React.ReactNode
}){
 const q=useQuery(wikiResolution(target,sourceId));
 const id=q.data?.targetId??null;
 const cycle=Boolean(id&&trail.includes(id));
 const tooDeep=depth>=3;
 const detail=useQuery({
  queryKey:['wiki-embed',id],
  queryFn:()=>record(id!),
  enabled:Boolean(id&&!cycle&&!tooDeep),
  staleTime:20_000
 });
 const data=detail.data as RecordDetail|undefined;
 let body=data?section(data.content,anchor):'';
 const sectionMissing=Boolean(data&&anchor&&!body);
 const truncated=body.length>50000;
 if(truncated)body=body.slice(0,50000)+'\n\n> 嵌入内容过长，剩余部分请打开源文档查看。';
 return <section className="wiki-embed" aria-label="嵌入文档">
  <header className="wiki-embed-heading">
   <FileInput size={16}/>
   {id?<Link to="/records/$recordId" params={{recordId:id}} className="wiki-embed-title">
    {q.data?.name??target}{anchor?' #'+anchor:''}<ExternalLink size={12}/>
   </Link>:<span className="wiki-embed-title">{target}</span>}
   <span className="wiki-embed-pill">只读嵌入</span>
  </header>
  <div className="wiki-embed-body">
   {q.isPending?'正在查找源文档…':
    q.isError||!id?'源文档不存在或引用路径无法解析。':
    cycle?'检测到循环嵌入，已停止递归。':
    tooDeep?'嵌入层级已达上限，请打开源文档查看。':
    detail.isPending?'正在加载嵌入内容…':
    detail.isError?'源文档加载失败，请直接打开原文档。':
    sectionMissing?'找不到所引用的章节，可能已被重命名。':
    data?.kind!=='document'?'任务列表暂不支持正文嵌入，请打开源记录。':
    render(body,id,[...trail,id],depth+1)}
   {q.data?.status==='path_changed'&&<p className="wiki-embed-note">
    原路径已发生变化；仍按首次解析的 UUID 引用原文档。</p>}
  </div>
 </section>;
}
export const wikiDecode=decode;
