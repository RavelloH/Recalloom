import React,{memo,useCallback,useEffect,useMemo,useState} from 'react';
import ReactMarkdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {motion,useReducedMotion} from 'motion/react';
import {HELP_SYNTAX_GUIDES,HELP_RMD_REFERENCE,HELP_RMD_COMPONENTS,HELP_RMD_NODES} from '../../src/help/catalog.generated';
import {RMD_REGISTRY} from './rmd-schema';
import {RmdHelpPre} from './rmd-help-example';
import {AutoResizer,AutoTransition} from './motion-primitives';
import {OverlayScroll} from './scrollbars';
import {useMediaQuery} from './use-media';
import {useTaskViewHeight} from './tasks/scroll';
import {PageTitle} from './pages/shared';
import {Icon} from './icon';
import {helpSections} from './rmd-help-content';
import './rmd-help-page.css';

const groupOrder=['inline','block','leaf'] as const;
const groupLabels={inline:'行内组件与标记',block:'多行容器',leaf:'链接与嵌入'};
const guides=[{id:'intro',label:'使用说明',icon:'helpBook'},{id:'math',label:'数学公式',icon:'math'},{id:'wiki',label:'链接与嵌入',icon:'link'},{id:'all',label:'完整参考手册',icon:'code'}] as const;

const markdownComponents:Components={
 pre:RmdHelpPre,
 h1:({children,node})=><h2 className="rk-help-title" id={'help-heading-'+node?.position?.start.line} tabIndex={-1}>{children}</h2>,
 h2:({children,node})=><h3 className="rk-help-section-title" id={'help-heading-'+node?.position?.start.line} tabIndex={-1}>{children}</h3>,
 h3:({children,node})=><h4 className="rk-help-subtitle" id={'help-heading-'+node?.position?.start.line} tabIndex={-1}>{children}</h4>,
 table:({children})=><OverlayScroll axis="x" edges className="rk-help-table"><table>{children}</table></OverlayScroll>
};
const HelpDocument=memo(function HelpDocument({content,viewport,onReady}:{content:string;viewport:HTMLElement|null;onReady:()=>void}){
 useEffect(()=>{
  if(viewport)viewport.scrollTop=0;
  onReady();
 },[content,viewport,onReady]);
 return <div className="rk-help-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown></div>;
});

export default function RmdHelpPage(){
 const [query,setQuery]=useState(''),[selected,setSelected]=useState('intro'),[navigationOpen,setNavigationOpen]=useState(false);
 const [viewport,setViewport]=useState<HTMLDivElement|null>(null),[ready,setReady]=useState(''),[section,setSection]=useState('');
 const compact=useMediaQuery('(max-width:860px)'),reduced=useReducedMotion(),view=useTaskViewHeight();
 const normalized=query.trim().toLowerCase();
 const groups=useMemo(()=>{
  const seen=new Set<string>();
  return groupOrder.map(type=>({type,label:groupLabels[type],items:RMD_REGISTRY.components.filter(item=>{
   if(item.type!==type||seen.has(item.name))return false;
   seen.add(item.name);
   const forms=RMD_REGISTRY.components.filter(component=>component.name===item.name);
   return !normalized||forms.some(component=>(component.name+' '+component.summary+' '+Object.keys(component.attributes).join(' ')).toLowerCase().includes(normalized));
  })}));
 },[normalized]);
 const nodes=useMemo(()=>RMD_REGISTRY.nodes.filter(item=>!normalized||(item.node+' '+item.label+' '+item.summary+' '+Object.keys(item.attributes).join(' ')).toLowerCase().includes(normalized)),[normalized]);
 const component=selected.startsWith('component:')?HELP_RMD_COMPONENTS[selected.slice(10) as keyof typeof HELP_RMD_COMPONENTS]:undefined;
 const node=selected.startsWith('node:')?HELP_RMD_NODES[selected.slice(5) as keyof typeof HELP_RMD_NODES]:undefined;
 const content=component?.content??node?.content??(selected==='all'?HELP_RMD_REFERENCE:HELP_SYNTAX_GUIDES[selected as keyof typeof HELP_SYNTAX_GUIDES]??HELP_SYNTAX_GUIDES.intro);
 const title=component?.title??node?.title??guides.find(guide=>guide.id===selected)?.label??'使用说明';
 const detailed=Boolean(component||node);
 const sections=useMemo(()=>helpSections(content,detailed),[content,detailed]);
 const onReady=useCallback(()=>{setReady(selected);setSection('');},[selected]);
 const choose=(value:string)=>{setSelected(value);if(compact)setNavigationOpen(false);};
 const jump=(id:string)=>{
  const heading=document.getElementById(id);
  if(!heading||!viewport)return;
  viewport.scrollTo({top:viewport.scrollTop+heading.getBoundingClientRect().top-viewport.getBoundingClientRect().top-18,behavior:reduced?'auto':'smooth'});
  heading.focus({preventScroll:true});setSection(id);
 };

 return <div className="page rk-help-page">
  <PageTitle title="RMD 语法帮助" description="查阅 Markdown 写法、组件参数与可复制示例。"/>
  <div className="rk-help-layout" ref={view.ref} style={view.height?{height:view.height,'--rk-help-height':view.height+'px'} as React.CSSProperties:undefined}>
   <nav className="rk-help-navigation" aria-label="RMD 组件导航">
    {compact&&<Button label={title} variant="secondary" className="rk-help-mobile-toggle" width="100%" aria-expanded={navigationOpen} onClick={()=>setNavigationOpen(value=>!value)} endContent={<motion.span className="rk-help-chevron" animate={{rotate:navigationOpen?180:0}} transition={{duration:reduced?0:.18}}><Icon name="chevronDown" size="sm"/></motion.span>}/>}
    <AutoResizer className="rk-help-navigation-resizer"><AutoTransition transitionKey={compact&&!navigationOpen?'closed':'open'}>{(!compact||navigationOpen)&&<div className="rk-help-navigation-body">
     <div className="rk-help-search"><TextInput label="搜索 RMD 语法" isLabelHidden role="searchbox" width="100%" value={query} onChange={setQuery} startIcon={<Icon name="search" size="sm"/>} placeholder="搜索组件或属性…"/>{query&&<IconButton label="清空搜索" size="sm" variant="ghost" onClick={()=>setQuery('')} icon={<Icon name="x" size="sm"/>}/>}</div>
     <OverlayScroll className="rk-help-navigation-scroll" edges>
      <div className="rk-help-links">{guides.map(guide=><Button key={guide.id} label={guide.label} icon={<Icon name={guide.icon} size="sm"/>} width="100%" className="rk-help-nav-action" variant={selected===guide.id?'secondary':'ghost'} aria-current={selected===guide.id?'page':undefined} onClick={()=>choose(guide.id)}/>)}</div>
      <AutoResizer><AutoTransition transitionKey={normalized} duration={.12}><div>
       {groups.map(group=>group.items.length>0&&<section key={group.type} aria-label={group.label}><h2>{group.label}</h2>{group.items.map(item=><Button key={item.name} label={item.name} width="100%" className="rk-help-nav-action" variant={selected==='component:'+item.name?'secondary':'ghost'} aria-current={selected==='component:'+item.name?'page':undefined} onClick={()=>choose('component:'+item.name)} endContent={<span className="rk-help-nav-meta">{HELP_RMD_COMPONENTS[item.name as keyof typeof HELP_RMD_COMPONENTS].forms.length>1?'多种写法':''}</span>}/>)}</section>)}
       {nodes.length>0&&<section aria-label="Markdown 块属性"><h2>块属性 · @ attrs</h2>{nodes.map(item=><Button key={item.node} label={item.label} width="100%" className="rk-help-nav-action" variant={selected==='node:'+item.node?'secondary':'ghost'} aria-current={selected==='node:'+item.node?'page':undefined} onClick={()=>choose('node:'+item.node)} endContent={<span className="rk-help-nav-meta">{item.node}</span>}/>)}</section>}
       {!groups.some(group=>group.items.length)&&!nodes.length&&<p className="rk-help-empty" role="status">没有符合条件的语法。</p>}
      </div></AutoTransition></AutoResizer>
     </OverlayScroll>
    </div>}</AutoTransition></AutoResizer>
   </nav>
   <article className="rk-help-document" aria-label={title}>
    <div className="rk-help-document-head"><AutoTransition as="span" transitionKey={selected}><span className="muted small">{component?'组件参考':node?'块属性':selected==='all'?'完整参考':'使用指南'}</span></AutoTransition><Selector label="本页目录" isLabelHidden size="sm" value={section} placeholder="本页目录" hasSearch options={sections.map(item=>({value:item.id,label:item.label}))} isDisabled={ready!==selected||!sections.length} onChange={jump}/></div>
    <OverlayScroll className="rk-help-document-scroll" edges viewportRef={setViewport}>
     <AutoResizer><AutoTransition transitionKey={selected} type="fade" duration={.18}><HelpDocument content={content} viewport={viewport} onReady={onReady}/></AutoTransition></AutoResizer>
    </OverlayScroll>
   </article>
  </div>
 </div>;
}
