import React,{useMemo} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {useQueryClient} from '@tanstack/react-query';
import {CommandPalette,CommandPaletteFooter,useCommandPaletteContext} from '@astryxdesign/core/CommandPalette';
import {IconArrowUpRight,IconFileText,IconChecklist,IconSearch,type TablerIcon} from '@tabler/icons-react';
import {useRecentPages} from './recent-pages';
import {menu} from './navigation';
import {searchQuery,type SearchHit} from './queries';

type PaletteItem={id:string;label:string;auxiliaryData:{group:string;detail?:string;icon:TablerIcon}};
const PALETTE_LIMIT=8;

const navItems=():PaletteItem[]=>menu.map(({to,name,icon})=>({id:'nav:'+to,label:name,auxiliaryData:{group:'跳转',icon}}));
const pageItem=(group:string,hit:{id:string;name:string;kind?:string;path?:string;snippet?:string}):PaletteItem=>({
 id:'record:'+hit.id,label:hit.name,
 auxiliaryData:{group,detail:hit.snippet?hit.snippet.replace(/\s+/g,' ').trim().slice(0,90):hit.path,icon:hit.kind==='task_list'?IconChecklist:IconFileText}
});
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 const id=setTimeout(resolve,ms);
 signal.addEventListener('abort',()=>{clearTimeout(id);reject(signal.reason);},{once:true});
});

/** Footer action: the same query, opened as the full search page. */
function PaletteFooter({onOpenSearch}:{onOpenSearch:(q:string)=>void}){
 const term=(useCommandPaletteContext()?.search??'').trim();
 return <CommandPaletteFooter className="palette-footer">
  <span className="palette-hints"><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>↵</kbd> 打开 <kbd>Esc</kbd> 关闭</span>
  <button type="button" className="palette-open-search" onClick={()=>onOpenSearch(term)}>{term?'在搜索页查看全部结果':'打开搜索页'}<IconArrowUpRight size="1em"/></button>
 </CommandPaletteFooter>;
}

/** Ctrl/⌘ K: one search for the whole workspace. Results come from the same
 *  query as the search page, which adds filters and the complete list. */
export function QuickSwitcher({isOpen,onOpenChange}:{isOpen:boolean;onOpenChange:(open:boolean)=>void}){
 const navigate=useNavigate();
 const qc=useQueryClient();
 const recent=useRecentPages();
 const source=useMemo(()=>{
  let controller:AbortController|null=null;
  const bootstrap=()=>[...recent.slice(0,6).map(page=>pageItem('最近访问',page)),...navItems()];
  return {
   bootstrap,
   cancel:()=>controller?.abort(),
   async search(query:string){
    const term=query.trim();
    if(!term)return bootstrap();
    controller?.abort();
    const current=controller=new AbortController();
    const lower=term.toLowerCase();
    const commands=navItems().filter(item=>item.label.toLowerCase().includes(lower));
    let hits:SearchHit[]=[];
    try{
     await pause(180,current.signal);
     hits=(await qc.fetchQuery(searchQuery(term,'auto',PALETTE_LIMIT))).items;
    }catch{ /* offline or superseded: navigation and full search stay available */ }
    const seen=new Set<string>();
    const knownPaths=new Map(recent.map(page=>[page.id,page.path]));
    const pages=hits.filter(hit=>!seen.has(hit.id)&&seen.add(hit.id)).map(hit=>pageItem('搜索结果',{...hit,path:hit.path??knownPaths.get(hit.id)}));
    return [...pages,{id:'search:'+term,label:'在搜索页查看「'+term+'」的全部结果',auxiliaryData:{group:'搜索',icon:IconSearch}},...commands];
   }
  };
 },[recent,qc]);
 const openSearch=(q:string)=>{onOpenChange(false);void navigate({to:'/search',search:q?{q}:{}});};
 const select=(value:string)=>{
  const [type,...rest]=value.split(':');
  const target=rest.join(':');
  if(type==='record')void navigate({to:'/records/$recordId',params:{recordId:target}});
  else if(type==='search')openSearch(target);
  else if(type==='nav')void navigate({to:target});
 };
 return <CommandPalette<PaletteItem> isOpen={isOpen} onOpenChange={onOpenChange} label="快速导航" width={600} maxHeight="min(72vh,560px)"
  searchSource={source} onValueChange={select} footer={<PaletteFooter onOpenSearch={openSearch}/>}
  emptySearchText="没有匹配的页面" emptyBootstrapText="搜索标题与正文，或跳转到页面"
  renderItem={item=>{const Icon=item.auxiliaryData.icon;return <span className="palette-item"><Icon size="1.125em" className="palette-icon"/><span className="palette-copy"><span className="palette-label truncate">{item.label}</span>{item.auxiliaryData.detail&&<span className="palette-detail truncate">{item.auxiliaryData.detail}</span>}</span></span>;}}/>;
}
