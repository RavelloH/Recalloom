import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {motion,useReducedMotion} from 'motion/react';
import {Button} from '@astryxdesign/core/Button';
import {ContextPanel} from './context-panel';
import {InlineTitle,Properties,Property,TagEditor} from './page-chrome';
import {RecordRelations} from './record-relations';
import {ago,statusNames} from './pages/shared';
import type {RecordDetail} from './types';
import {sharedViewTransitionName} from './shared-view-transition';

export type DocumentInspectorTab='details'|'outline'|'relations'|'history';

const sections=[
 {id:'details',label:'信息'},
 {id:'outline',label:'目录'},
 {id:'relations',label:'关联'},
 {id:'history',label:'版本'}
] as const;

type OutlineResult={
 headings:Array<{title:string;level:number;lineStart:number;lineEnd:number}>;
 totalHeadings:number
};

export type DocumentPresentation={
 id:string;
 revision:number;
 headingTitle:string|null;
 characters:number;
};

const displayFileName=(name:string)=>/\.md$/i.test(name)?name:name+'.md';

function FilenameField({name,onRename}:{name:string;onRename:(value:string)=>Promise<void>}){
 const [value,setValue]=useState(name),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const cancelOnBlur=useRef(false);
 useEffect(()=>setValue(name),[name]);
 const commit=async()=>{
  if(cancelOnBlur.current){cancelOnBlur.current=false;return;}
  const next=value.trim();
  if(next===name)return;
  if(!next||next.length>180||/[\\/]/.test(next)){
   setError('文件名需为 1–180 个字符，且不能包含 / 或 \\。');setValue(name);return;
  }
  setPending(true);setError('');
  try{await onRename(next);}catch(e){setError(e instanceof Error?e.message:'重命名失败');setValue(name);}
  finally{setPending(false);}
 };
 return <div className="workbench-filename-field">
  <input type="text" aria-label="文件名" className="workbench-filename-input" value={value} disabled={pending} spellCheck={false}
   onChange={event=>setValue(event.target.value)}
   onBlur={()=>void commit()} onKeyDown={event=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
    if(event.key==='Escape'){event.preventDefault();cancelOnBlur.current=true;setError('');setValue(name);event.currentTarget.blur();}
   }}/>
  {error&&<span role="alert" className="page-title-error">{error}</span>}
 </div>;
}

export function DocumentWorkbenchHeader({item,title,usesHeading,characters,editors,focusTitle,onRename,onDetails}:{
 item:RecordDetail;
 title:string;
 usesHeading:boolean;
 characters:number;
 editors:string[];
 focusTitle:boolean;
 onRename:(name:string)=>Promise<void>;
 onDetails:()=>void;
}){
 const sharedName=sharedViewTransitionName('record',item.id);
 return <header className="doc-header workbench-header">
  <div className="workbench-identity">
   <span className="workbench-document-kind"><Icon name="document" size="sm" aria-hidden="true"/> Markdown 文档
    {usesHeading&&<span className="workbench-document-filename" title={item.name}> · <span className="workbench-file-identity" style={sharedName?{viewTransitionName:sharedName}:undefined}>{displayFileName(item.name)}</span></span>}
   </span>
   <span className="workbench-revision" title={'当前正文版本 R'+item.revision}>R{item.revision}</span>
  </div>
  <InlineTitle key={usesHeading?'heading':'filename'} value={title} onRename={onRename}
   placeholder={usesHeading?'未命名标题':'未命名'} autoFocus={focusTitle&&!usesHeading} allowSlash={usesHeading} transitionName={usesHeading?undefined:sharedName}/>
  {item.tags?.length>0&&<div className="workbench-tag-line" aria-label="文档标签">
   {item.tags.map(tag=><span className="workbench-summary-tag" key={tag}>{tag}</span>)}
  </div>}
  <div className="workbench-summary">
   <div className="workbench-summary-details">
    <time dateTime={item.updatedAt} title={item.updatedAt}>更新于 {ago(item.updatedAt)||'刚刚'}</time>
    <span className="workbench-meta-separator" aria-hidden="true">·</span>
    <span className="workbench-editors" title={editors.join('，')}>编辑者：{editors.length?editors.join('，'):'—'}</span>
    <span className="workbench-meta-separator" aria-hidden="true">·</span>
    <span className="workbench-character-count" aria-label={'字数 '+characters}>{characters.toLocaleString('zh-CN')} 字</span>
   </div>
   <button type="button" className="workbench-details-trigger" onClick={onDetails}>
    详细信息 <Icon name="chevronRight" size="sm" aria-hidden="true"/>
   </button>
  </div>
 </header>;
}

export function DocumentWorkbenchInspector({open,tab,onChangeTab,onClose,item,outline,onJump,onChangeTag,onRenameFilename,onHistoryTarget,characters,editors}:{
 open:boolean;
 tab:DocumentInspectorTab;
 onChangeTab:(tab:DocumentInspectorTab)=>void;
 onClose:()=>void;
 item:RecordDetail;
 outline:{isPending:boolean;isError:boolean;data?:OutlineResult};
 onJump:(line:number)=>void;
 onChangeTag:(tag:string,action:'add'|'remove')=>Promise<void>;
 onRenameFilename:(name:string)=>Promise<void>;
 onHistoryTarget:React.Dispatch<React.SetStateAction<HTMLDivElement|null>>;
 characters:number;
 editors:string[];
}){
 const currentIndex=sections.findIndex(section=>section.id===tab);
 const reduceMotion=useReducedMotion();
 return <ContextPanel open={open} onOpenChange={next=>{if(!next)onClose();}} label="文档检查器">
  <div className="record-inspector workbench-inspector">
   <div className="panel-heading">
    <h2>文档检查器</h2>
    <IconButton variant="ghost" label="关闭" icon={<Icon name="x" size="sm"/>} onClick={onClose}/>
   </div>
   <div className="workbench-inspector-tabs" role="tablist" aria-label="文档信息分类">
    {sections.map((section,index)=><button type="button" key={section.id}
     role="tab" id={'workbench-tab-'+section.id} aria-selected={tab===section.id}
     aria-controls="workbench-inspector-panel" tabIndex={tab===section.id?0:-1}
     onClick={()=>onChangeTab(section.id)}
     onKeyDown={event=>{
      let next=-1;
      if(event.key==='ArrowRight')next=(index+1)%sections.length;
      else if(event.key==='ArrowLeft')next=(index+sections.length-1)%sections.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=sections.length-1;
      if(next>=0){event.preventDefault();onChangeTab(sections[next].id);const id=sections[next].id;requestAnimationFrame(()=>document.getElementById('workbench-tab-'+id)?.focus());}
     }}>{tab===section.id&&<motion.span className="workbench-tab-indicator" layoutId="rk-workbench-selected-tab" aria-hidden="true" transition={reduceMotion?{duration:0}:{type:'spring',stiffness:430,damping:38}}/>}<span className="workbench-tab-label">{section.label}</span></button>)}
   </div>
   <section className="workbench-inspector-content" id="workbench-inspector-panel" role="tabpanel"
    aria-labelledby={'workbench-tab-'+sections[currentIndex].id}>
    {tab==='details'&&<div className="workbench-inspector-details">
     <Properties>
      <Property label="文件名"><FilenameField name={item.name} onRename={onRenameFilename}/></Property>
      <Property label="类型">Markdown 文档</Property>
      <Property label="标签"><TagEditor tags={item.tags??[]} onChange={onChangeTag}/></Property>
      <Property label="更新时间"><time dateTime={item.updatedAt} title={item.updatedAt}>{ago(item.updatedAt)||'刚刚'}</time></Property>
      <Property label="编辑者"><span className="workbench-inspector-path">{editors.length?editors.join('，'):'—'}</span></Property>
      <Property label="字数">{characters.toLocaleString('zh-CN')} 字</Property>
      <Property label="版本">R{item.revision}</Property>
      <Property label="状态">{statusNames[item.status??'']??item.status}</Property>
      <Property label="路径"><span className="workbench-inspector-path">{item.path}</span></Property>
      <Property label="行数">{item.totalLines}</Property>
     </Properties>
    </div>}
    {tab==='outline'&&<div className="outline-panel">
     {outline.isPending?<p className="muted small">加载目录…</p>:
      outline.isError?<p className="muted small">文档大纲暂不可用</p>:
      outline.data?.headings.length?<div className="outline-items">{outline.data.headings.map((heading,index)=>
       <div className="outline-indent" key={index} style={{paddingInlineStart:(heading.level-1)*12}}>
        <Button className="outline-item" variant="ghost" size="sm" width="100%" label={heading.title}
         tooltip={'第 '+heading.lineStart+' 行至第 '+heading.lineEnd+' 行'}
         endContent={<small>L{heading.lineStart}</small>} onClick={()=>onJump(heading.lineStart)}/>
       </div>)}
       {outline.data.totalHeadings>outline.data.headings.length&&<p className="muted small">仅显示前 200 个标题</p>}
      </div>:<p className="muted small">暂无 Markdown 标题</p>}
    </div>}
    {tab==='relations'&&<RecordRelations recordId={item.id} onNavigate={onClose}/>}
    {tab==='history'&&<div className="workbench-history-target" ref={onHistoryTarget}/>}
   </section>
  </div>
 </ContextPanel>;
}
