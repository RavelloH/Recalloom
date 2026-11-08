import React,{useMemo,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {BookOpen,Search,X,Code2,Tags} from 'lucide-react';
import {HELP_META,HELP_PAGES,HELP_RMD_COMPONENTS,HELP_RMD_NODES} from '../../src/help/catalog.generated';
import {RMD_REGISTRY} from './rmd-schema';
import './rmd-help-page.css';

type Topic='intro'|'all'|'component'|'node';
const groupOrder=['inline','block','leaf'] as const;
const groupLabels={inline:'行内组件',block:'多行容器',leaf:'独立块组件'};
const intro=[
 '# RMD 1.0 语法帮助',
 '',
 '本页面与 Agent 的 MCP 帮助、RMD 解析器及源码编辑器补全共用同一份注册表。',
 '点击左侧组件查看 **准确的属性、合法值、位置参数、嵌套要求和可复制示例**；选择“完整参考”可一次查看全部语法。',
 '',
 'RMD 无效语法会保留为原文，不会因为识别失败而执行未知组件。文档元信息不来自 Markdown Front Matter。',
 '',
 '## 速查',
 '',
 '- 行内组件：`:: badge 已完成 | success ::`',
 '- 块级组件：`::: info 提示`，正文，独立结束行 `:::`',
 '- 独立块：`::: embed id:550e8400-e29b-41d4-a716-446655440000 :::`',
 '- 修饰块属性：`@ attrs fig-device | width=480 | caption=实验装置 @`',
 '',
 '页面仅展示语法说明，不会修改知识库的任何文档。'
].join('\n');

export default function RmdHelpPage(){
 const [query,setQuery]=useState('');
 const [selected,setSelected]=useState<{type:Topic;name?:string}>({type:'intro'});
 const normalized=query.trim().toLowerCase();
 const groups=useMemo(()=>groupOrder.map(type=>({
  type,label:groupLabels[type],
  items:RMD_REGISTRY.components.filter(c=>c.type===type&&(
   !normalized||(c.name+' '+c.summary+' '+Object.keys(c.attributes).join(' ')).toLowerCase().includes(normalized)
  )).filter((c,i,all)=>all.findIndex(item=>item.name===c.name)===i)
 })),[normalized]);
 const visibleNodes=useMemo(()=>RMD_REGISTRY.nodes.filter(n=>(
  !normalized||(n.node+' '+n.label+' '+n.summary+' '+Object.keys(n.attributes).join(' ')).toLowerCase().includes(normalized)
 )),[normalized]);
 const component=selected.type==='component'?HELP_RMD_COMPONENTS[selected.name as keyof typeof HELP_RMD_COMPONENTS]:undefined;
 const node=selected.type==='node'?HELP_RMD_NODES[selected.name as keyof typeof HELP_RMD_NODES]:undefined;
 const content=selected.type==='all'?HELP_PAGES.markdown.content:
  selected.type==='component'?component?.content:
  selected.type==='node'?node?.content:intro;
 const title=selected.type==='all'?'完整 RMD 参数手册':
  selected.type==='component'?'组件：'+(selected.name??''):
  selected.type==='node'?'块属性：'+(node?.title??selected.name??''):'语法概览';
 const choose=(type:Topic,name?:string)=>setSelected({type,name});
 const isSelected=(type:Topic,name?:string)=>selected.type===type&&selected.name===name;
 return <div className="page rk-help-page">
  <header className="rk-help-header">
   <span className="rk-help-eyebrow"><BookOpen size={15} aria-hidden="true"/> Recalloom Markdown</span>
   <h1>RMD 语法参考</h1>
   <p>全部组件、属性、嵌套约束与可复制示例。来源于实际渲染器的权威 Schema。</p>
  </header>
  <div className="rk-help-layout">
   <nav className="rk-help-navigation" aria-label="RMD 组件导航">
    <div className="rk-help-search">
     <Search size={16} aria-hidden="true"/>
     <input type="search" value={query} onChange={e=>setQuery(e.target.value)} aria-label="搜索 RMD 语法"
       placeholder="搜索组件或属性…" spellCheck={false}/>
     {query&&<button type="button" onClick={()=>setQuery('')} aria-label="清空搜索"><X size={15}/></button>}
    </div>
    <div className="rk-help-links">
     <button type="button" className={isSelected('intro')?'active':''} aria-current={isSelected('intro')?'page':undefined} onClick={()=>choose('intro')}><BookOpen size={15}/> 使用说明</button>
     <button type="button" className={isSelected('all')?'active':''} aria-current={isSelected('all')?'page':undefined} onClick={()=>choose('all')}><Code2 size={15}/> 完整参考手册</button>
    </div>
    {groups.map(group=>group.items.length>0&&<section key={group.type} aria-label={group.label}>
     <h2>{group.label}</h2>
     {group.items.map(item=><button key={group.type+item.name} type="button"
       className={isSelected('component',item.name)?'active':''}
       aria-current={isSelected('component',item.name)?'page':undefined}
       onClick={()=>choose('component',item.name)}>
       {item.name}<span>{Object.keys(item.attributes).length?'参数 '+Object.keys(item.attributes).length:''}</span>
      </button>)}
    </section>)}
    {visibleNodes.length>0&&<section aria-label="Markdown 块属性"><h2><Tags size={13} aria-hidden="true"/> @ attrs</h2>
     {visibleNodes.map(item=><button key={item.node} type="button" className={isSelected('node',item.node)?'active':''}
       aria-current={isSelected('node',item.node)?'page':undefined} onClick={()=>choose('node',item.node)}>
       {item.label}<span>{item.node}</span>
      </button>)}
    </section>}
    {!groups.some(group=>group.items.length>0)&&visibleNodes.length===0&&<p className="rk-help-empty">没有符合条件的语法。</p>}
   </nav>
   <article className="rk-help-document" aria-label={title}>
    <div className="rk-help-document-head"><span>{title}</span><small>帮助版本 {HELP_META.helpVersion}</small></div>
    <div className="rk-help-prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content??intro}</ReactMarkdown></div>
   </article>
  </div>
 </div>;
}
