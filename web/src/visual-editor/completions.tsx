import React,{useCallback,useId,useLayoutEffect,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {useLayer} from '@astryxdesign/core/Layer';
import {Icon} from '../icon';
import type {SearchHit} from '../queries';
import {groupSlashCommands,type SlashCommand} from '../tiptap/slash-commands';
import type {SlashState,WikiState} from './types';
import {SLASH_MENU_WIDTH} from './geometry';

type Props={
 editor:Editor;
 surfaceRef:React.RefObject<HTMLDivElement|null>;
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

// Preserve the editor's existing surface-relative caret geometry while the
// library owns a fixed native popover. Re-read on ancestor scroll, resize and
// mobile keyboard viewport changes; the layer never receives editor focus.
function useCompletionPosition(surfaceRef:Props['surfaceRef'],state:SlashState|null){
 const [box,setBox]=useState({left:0,top:0,bottom:0,width:SLASH_MENU_WIDTH+8});
 useLayoutEffect(()=>{
  if(!state)return;
  const surface=surfaceRef.current;
  if(!surface)return;
  const measure=()=>{
   const {left,top,bottom,width}=surface.getBoundingClientRect();
   setBox(current=>current.left===left&&current.top===top&&current.bottom===bottom&&current.width===width?current:{left,top,bottom,width});
  };
  measure();
  const observer=new ResizeObserver(measure);observer.observe(surface);
  window.addEventListener('scroll',measure,true);window.addEventListener('resize',measure);
  window.visualViewport?.addEventListener('scroll',measure);window.visualViewport?.addEventListener('resize',measure);
  return()=>{
   observer.disconnect();window.removeEventListener('scroll',measure,true);window.removeEventListener('resize',measure);
   window.visualViewport?.removeEventListener('scroll',measure);window.visualViewport?.removeEventListener('resize',measure);
  };
 },[surfaceRef,Boolean(state)]);
 return {x:box.left+(state?.left??0),y:state?.placement==='above'?box.bottom-state.offset:box.top+(state?.offset??0),
  style:{width:Math.min(SLASH_MENU_WIDTH,Math.max(0,box.width-8)),maxWidth:'calc(100vw - 16px)',
   transform:state?.placement==='above'?'translateY(-100%)':undefined}};
}

export function EditorCompletions({editor,surfaceRef,slash,slashItems,slashGroups,slashListRef,setSlash,onRunSlash,wiki,wikiMatches,wikiFetching,setWiki,onChooseWiki}:Props){
 const prefix=useId();
 const slashId=prefix+'-commands',wikiId=prefix+'-references';
 const slashOption=(id:string)=>slashId+'-'+encodeURIComponent(id);
 const wikiOption=(id:string)=>wikiId+'-'+encodeURIComponent(id);
 const showSlash=Boolean(slash&&slashItems.length);
 const hideSlash=useCallback(()=>setSlash(null),[setSlash]);
 const hideWiki=useCallback(()=>setWiki(null),[setWiki]);
 const slashLayer=useLayer({mode:'fixed',lightDismiss:true,onHide:hideSlash});
 const wikiLayer=useLayer({mode:'fixed',lightDismiss:true,onHide:hideWiki});
 const slashPosition=useCompletionPosition(surfaceRef,showSlash?slash:null);
 const wikiPosition=useCompletionPosition(surfaceRef,wiki);
 useLayoutEffect(()=>{if(showSlash)slashLayer.show();else slashLayer.hide();},[showSlash,slashLayer.show,slashLayer.hide]);
 useLayoutEffect(()=>{if(wiki)wikiLayer.show();else wikiLayer.hide();},[Boolean(wiki),wikiLayer.show,wikiLayer.hide]);
 const listId=wiki?wikiId:showSlash?slashId:null;
 const slashActive=slash&&slashItems[Math.min(slash.index,slashItems.length-1)];
 const wikiActive=wiki&&wikiMatches[Math.min(wiki.index,wikiMatches.length-1)];
 const activeId=wiki?wikiActive?wikiOption(wikiActive.id):null:slashActive?slashOption(slashActive.id):null;
 useLayoutEffect(()=>{
  if(!listId)return;
  const element=editor.view.dom;
  const values={'aria-autocomplete':'list','aria-haspopup':'listbox','aria-controls':listId,'aria-activedescendant':activeId};
  const previous=Object.keys(values).map(name=>[name,element.getAttribute(name)] as const);
  for(const [name,value] of Object.entries(values)){
   if(value===null)element.removeAttribute(name);else element.setAttribute(name,value);
  }
  return()=>{for(const [name,value] of previous){if(value===null)element.removeAttribute(name);else element.setAttribute(name,value);}};
 },[editor,listId,activeId]);
 return <>
  {slashLayer.render(showSlash&&slash?<div id={slashId} className="slash-menu" ref={slashListRef} role="listbox" aria-label="插入内容"
   style={{position:'relative',width:'100%',maxWidth:'100%'}} onMouseDown={event=>event.preventDefault()}>
   <div className="slash-menu-heading">{slash.query?'匹配的命令':'插入内容'}</div>
   {slashGroups.map(group=><div className="slash-category" key={group.id} role="group" aria-labelledby={slashId+'-group-'+group.id}>
    <div className="slash-category-heading" id={slashId+'-group-'+group.id}>{group.label}</div>
    {group.commands.map(command=>{const index=slashItems.findIndex(item=>item.id===command.id);const icon=command.icon;const selected=index===Math.min(slash.index,slashItems.length-1);return <div id={slashOption(command.id)} key={command.id} role="option" aria-selected={selected} className={'slash-item'+(selected?' is-selected':'')}
     onMouseEnter={()=>setSlash(current=>current&&{...current,index})} onClick={()=>onRunSlash(command)}>
     <span className="slash-icon"><Icon name={icon} size="md"/></span><span className="slash-copy"><strong>{command.title}</strong><small>{command.description}</small></span></div>;})}
   </div>)}
  </div>:null,slashPosition)}
  {wikiLayer.render(wiki?<div id={wikiId} className="slash-menu wiki-completion" role="listbox" aria-label="引用文档"
   style={{position:'relative',width:'100%',maxWidth:'100%'}} onMouseDown={event=>event.preventDefault()}>
   <div className="slash-menu-heading">{wiki.kind==='embed'?'嵌入文档':'引用文档'} · {wiki.query?'搜索结果':'输入名称搜索'}</div>
   {wikiFetching&&<p role="status" className="muted small wiki-completion-status">搜索中…</p>}
   {wikiMatches.map((hit,index)=><div id={wikiOption(hit.id)} key={hit.id} role="option" aria-selected={index===Math.min(wiki.index,wikiMatches.length-1)}
    className={'slash-item'+(index===Math.min(wiki.index,wikiMatches.length-1)?' is-selected':'')}
    onMouseEnter={()=>setWiki(state=>state?{...state,index}:state)} onClick={()=>onChooseWiki(hit)}>
    <span className="slash-copy"><strong>{hit.name}</strong><small>{hit.path??hit.id}</small></span>
   </div>)}
   {Boolean(wiki.query)&&!wikiFetching&&!wikiMatches.length&&<p role="status" className="muted small wiki-completion-status">没有匹配文档，请更换关键词。</p>}
  </div>:null,wikiPosition)}
 </>;
}
