import React,{useMemo} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {CommandPalette} from '@astryxdesign/core/CommandPalette';
import {FileText,ListTodo,Search,type LucideIcon} from 'lucide-react';
import {api,queryString} from './api';
import {useRecentPages} from './recent-pages';
import {menu} from './navigation';

type PaletteItem={id:string;label:string;auxiliaryData:{group:string;detail?:string;icon:LucideIcon}};
type SearchHit={id:string;name:string;kind?:string};

const navItems=():PaletteItem[]=>menu.map(({to,name,icon})=>({id:'nav:'+to,label:name,auxiliaryData:{group:'跳转',icon}}));
const pageItem=(group:string,hit:{id:string;name:string;kind?:string;path?:string}):PaletteItem=>({
 id:'record:'+hit.id,label:hit.name,
 auxiliaryData:{group,detail:hit.path,icon:hit.kind==='task_list'?ListTodo:FileText}
});

export function QuickSwitcher({isOpen,onOpenChange}:{isOpen:boolean;onOpenChange:(open:boolean)=>void}){
 const navigate=useNavigate();
 const recent=useRecentPages();
 const source=useMemo(()=>{
  let controller:AbortController|null=null;
  return {
   bootstrap:()=>[...recent.slice(0,6).map(page=>pageItem('最近访问',page)),...navItems()],
   cancel:()=>controller?.abort(),
   async search(query:string){
    const term=query.trim();
    if(!term)return [...recent.slice(0,6).map(page=>pageItem('最近访问',page)),...navItems()];
    controller?.abort();
    controller=new AbortController();
    const lower=term.toLowerCase();
    const commands=navItems().filter(item=>item.label.toLowerCase().includes(lower));
    let hits:SearchHit[]=[];
    try{
     hits=(await api<{items:SearchHit[]}>('/search?'+queryString({query:term,mode:'metadata',limit:10}),{signal:controller.signal})).items;
    }catch{ /* offline or aborted: still offer navigation and full-text search */ }
    const seen=new Set<string>();
    const knownPaths=new Map(recent.map(page=>[page.id,page.path]));
    const pages=hits.filter(hit=>!seen.has(hit.id)&&seen.add(hit.id)).map(hit=>pageItem('页面',{...hit,path:knownPaths.get(hit.id)}));
    return [...pages,{id:'search:'+term,label:'全文搜索「'+term+'」',auxiliaryData:{group:'搜索',icon:Search}},...commands];
   }
  };
 },[recent]);
 const select=(value:string)=>{
  const [type,...rest]=value.split(':');
  const target=rest.join(':');
  if(type==='record')void navigate({to:'/records/$recordId',params:{recordId:target}});
  else if(type==='search')void navigate({to:'/search',search:{q:target}});
  else if(type==='nav')void navigate({to:target});
 };
 return <CommandPalette<PaletteItem> isOpen={isOpen} onOpenChange={onOpenChange} label="快速导航" width={560} maxHeight="min(70vh,520px)"
  searchSource={source} onValueChange={select}
  emptySearchText="没有匹配的结果" emptyBootstrapText="输入页面名称快速跳转"
  renderItem={item=>{const Icon=item.auxiliaryData.icon;return <span className="palette-item"><Icon size={16} className="palette-icon"/><span className="palette-label truncate">{item.label}</span>{item.auxiliaryData.detail&&<span className="palette-detail truncate">{item.auxiliaryData.detail}</span>}</span>;}}/>;
}
