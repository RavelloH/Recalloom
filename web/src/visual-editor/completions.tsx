import React from 'react';
import {Icon} from '../icon';
import type {SearchHit} from '../queries';
import {groupSlashCommands,type SlashCommand} from '../tiptap/slash-commands';
import type {SlashState,WikiState} from './types';
import {SLASH_MENU_WIDTH} from './geometry';

type Props={
 slash:SlashState|null;
 slashItems:SlashCommand[];
 slashGroups:ReturnType<typeof groupSlashCommands>;
 slashListRef:React.Ref<HTMLDivElement>;
 setSlash:React.Dispatch<React.SetStateAction<SlashState|null>>;
 onRunSlash:(command:SlashCommand)=>void;
 wiki:WikiState|null;
 wikiMatches:SearchHit[];
 wikiFetching:boolean;
 setWiki:React.Dispatch<React.SetStateAction<WikiState|null>>;
 onChooseWiki:(hit:SearchHit)=>void;
};
export function EditorCompletions({slash,slashItems,slashGroups,slashListRef,setSlash,onRunSlash,wiki,wikiMatches,wikiFetching,setWiki,onChooseWiki}:Props){
 return <>
  {slash&&slashItems.length>0&&<div className="slash-menu" ref={slashListRef} role="listbox" aria-label="插入内容" style={{...(slash.placement==='above'?{bottom:slash.offset}:{top:slash.offset}),left:slash.left,width:SLASH_MENU_WIDTH}} onMouseDown={event=>event.preventDefault()}>
   <div className="slash-menu-heading">{slash.query?'匹配的命令':'插入内容'}</div>
   {slashGroups.map(group=><div className="slash-category" key={group.id}>
    <div className="slash-category-heading">{group.label}</div>
    {group.commands.map(command=>{const index=slashItems.findIndex(item=>item.id===command.id);const icon=command.icon;const selected=index===Math.min(slash.index,slashItems.length-1);return <div key={command.id} role="option" aria-selected={selected} className={'slash-item'+(selected?' is-selected':'')}
     onMouseEnter={()=>setSlash(current=>current&&{...current,index})} onClick={()=>onRunSlash(command)}>
     <span className="slash-icon"><Icon name={icon} size="md"/></span><span className="slash-copy"><strong>{command.title}</strong><small>{command.description}</small></span></div>;})}
   </div>)}
  </div>}
  {wiki&&<div className="slash-menu wiki-completion" role="listbox" aria-label="引用文档"
   style={{...(wiki.placement==='above'?{bottom:wiki.offset}:{top:wiki.offset}),left:wiki.left,width:SLASH_MENU_WIDTH}}
   onMouseDown={event=>event.preventDefault()}>
   <div className="slash-menu-heading">{wiki.kind==='embed'?'嵌入文档':'引用文档'} · {wiki.query?'搜索结果':'输入名称搜索'}</div>
   {wikiFetching&&<p className="muted small wiki-completion-status">搜索中…</p>}
   {wikiMatches.map((hit,index)=><div key={hit.id} role="option" aria-selected={index===Math.min(wiki.index,wikiMatches.length-1)}
    className={'slash-item'+(index===Math.min(wiki.index,wikiMatches.length-1)?' is-selected':'')}
    onMouseEnter={()=>setWiki(state=>state?{...state,index}:state)}
    onClick={()=>onChooseWiki(hit)}>
    <span className="slash-copy"><strong>{hit.name}</strong><small>{hit.path??hit.id}</small></span>
   </div>)}
   {Boolean(wiki.query)&&!wikiFetching&&!wikiMatches.length&&<p className="muted small wiki-completion-status">没有匹配文档，请更换关键词。</p>}
  </div>}
 </>;
}
