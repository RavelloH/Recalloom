import React from 'react';
import {Icon} from './icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {ContextPanel} from './context-panel';
import {InlineTitle,Properties,Property,TagEditor} from './page-chrome';
import {RecordRelations} from './record-relations';
import {ago,statusNames} from './pages/shared';
import type {RecordDetail} from './types';
import {sharedViewTransitionName} from './shared-view-transition';
import {documentDisplayName} from './document-filename';
import {AutoResizer,AutoTransition} from './motion-primitives';
import type {DocumentOutline} from './document-outline';

export const documentPanels=[
 {id:'info',label:'信息',icon:'infoCircle'},
 {id:'outline',label:'目录',icon:'outline'},
 {id:'history',label:'历史',icon:'versionHistory'}
] as const;
export type DocumentPanel=typeof documentPanels[number]['id'];

export type DocumentPresentation={
 id:string;
 revision:number;
 characters:number;
};

export function DocumentWorkbenchHeader({item,characters,editors,focusTitle,onRename}:{
 item:RecordDetail;
 characters:number;
 editors:string[]|null;
 focusTitle:boolean;
 onRename:(name:string)=>Promise<void>;
}){
 const sharedName=sharedViewTransitionName('record',item.id);
 return <header className="doc-header workbench-header">
  <div className="workbench-identity">
   <span className="workbench-document-kind"><Icon name="document" size="sm" aria-hidden="true"/> Markdown 文档</span>
   <span className="workbench-revision" title={'当前正文版本 R'+item.revision}>R{item.revision}</span>
  </div>
  <InlineTitle value={documentDisplayName(item.name)} onRename={onRename}
   placeholder="未命名" autoFocus={focusTitle} transitionName={sharedName}
   transitionResource={{kind:'record',id:item.id}}/>
  {item.tags?.length>0&&<div className="workbench-tag-line" aria-label="文档标签">
   {item.tags.map(tag=><span className="workbench-summary-tag" key={tag}>{tag}</span>)}
  </div>}
  <div className="workbench-summary">
   <AutoResizer className="workbench-summary-resizer">
    <div className="workbench-summary-details">
     <time dateTime={item.updatedAt} title={item.updatedAt}>更新于 {ago(item.updatedAt)||'刚刚'}</time>
     <span className="workbench-meta-separator" aria-hidden="true">·</span>
     <span className="workbench-character-count" aria-label={'字数 '+characters}>{characters.toLocaleString('zh-CN')} 字</span>
     <AutoTransition as="span" transitionKey={editors===null?'loading':'ready'} duration={.2}>
      {editors!==null&&<span className="workbench-editor-entry">
       <span className="workbench-meta-separator" aria-hidden="true">·</span>
       <span className="workbench-editors" title={editors.join('，')}>编辑者：{editors.length?editors.join('，'):'—'}</span>
      </span>}
     </AutoTransition>
    </div>
   </AutoResizer>
  </div>
 </header>;
}

export function DocumentWorkbenchPanel({open,panel,onClose,item,outline,onJump,onChangeTag,onHistoryTarget,characters,editors}:{
 open:boolean;
 panel:DocumentPanel;
 onClose:()=>void;
 item:RecordDetail;
 outline:DocumentOutline|null;
 onJump:(key:string)=>void;
 onChangeTag:(tag:string,action:'add'|'remove')=>Promise<void>;
 onHistoryTarget:React.Dispatch<React.SetStateAction<HTMLDivElement|null>>;
 characters:number;
 editors:string[];
}){
 const label=documentPanels.find(section=>section.id===panel)!.label;
 return <ContextPanel id="document-panel" open={open} onOpenChange={next=>{if(!next)onClose();}} label={label} modal={false}>
  <div className="record-inspector workbench-inspector" data-document-panel={panel}>
   <div className="panel-heading">
    <h2 id="document-panel-title">{label}</h2>
    <IconButton variant="ghost" label="关闭" icon={<Icon name="x" size="sm"/>} onClick={onClose}/>
   </div>
   <p className="workbench-panel-document">{documentDisplayName(item.name)}</p>
   <section key={panel} className="workbench-inspector-content" aria-labelledby="document-panel-title">
    {panel==='info'&&<div className="workbench-inspector-details">
     <Properties>
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
     {open&&<RecordRelations recordId={item.id} onNavigate={onClose}/>}
    </div>}
    {panel==='outline'&&<div className="outline-panel">
     {!outline?<p className="muted small" role="status">加载目录…</p>:
      outline.headings.length?<nav aria-label="文档目录"><ol className="outline-items">{outline.headings.map(heading=>
       <li className="outline-indent" key={heading.key} style={{paddingInlineStart:(heading.level-1)*12}}>
        <Button className="outline-item" variant="ghost" size="sm" width="100%" label={heading.title}
         aria-current={outline.activeKey===heading.key?'location':undefined} onClick={()=>onJump(heading.key)}/>
       </li>)}
       </ol>{outline.totalHeadings>outline.headings.length&&<p className="muted small">仅显示前 200 个标题</p>}
      </nav>:<p className="muted small">暂无 Markdown 标题</p>}
    </div>}
    {panel==='history'&&<div className="workbench-history-target" ref={onHistoryTarget}/>}
   </section>
  </div>
 </ContextPanel>;
}
