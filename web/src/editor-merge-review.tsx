import React,{useMemo,useState} from 'react';
import {createTwoFilesPatch} from 'diff';
import {Dialog} from '@astryxdesign/core/Dialog';
import {Button} from '@astryxdesign/core/Button';
import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';
import {Banner} from '@astryxdesign/core/Banner';
import {Icon} from './icon';
import {checkMergeStructure} from './merge-structure-check';
import {
 resolveThreeWayMerge,type MergeChoice,type MergePlan
} from './three-way-merge';

const MarkdownPreview=React.lazy(()=>import('./markdown-preview'));
const MAX_RENDER_CHARS=20_000;

export type MergeReview={
 fromRevision:number;remoteRevision:number;remote:string;local:string;
 plan:MergePlan;choices:Record<number,MergeChoice>;custom:Record<number,string>;
};
/** Controlled review; never writes until the parent revalidates the remote CAS. */
export function EditorMergeReview({review,busy,onChoose,onEdit,onClose,onApply}:{
 review:MergeReview;busy:boolean;
 onChoose:(id:number,choice:MergeChoice)=>void;
 onEdit:(id:number,value:string)=>void;
 onClose:()=>void;
 onApply:(output:string,mode:'save'|'stage')=>void;
}){
 const [view,setView]=useState<'diff'|'render'>('diff');
 const conflicts=review.plan.pieces.filter(piece=>piece.kind==='conflict');
 const output=resolveThreeWayMerge(review.plan,review.choices,review.custom);
 const manual=conflicts.length>0;
 const diagnostics=useMemo(()=>output===null?[]:checkMergeStructure(output),[output]);
 const structuralErrors=diagnostics.some(issue=>issue.severity==='error');
 const stageOnly=manual||structuralErrors;
 const preview=useMemo(()=>{
  if(output===null)return null;
  if(output.length+review.remote.length>120_000)
   return{text:'合并结果较长，请在源码编辑器中复核全部内容。',truncated:true};
  const patch=createTwoFilesPatch('服务器 R'+review.remoteRevision,'待合并内容',review.remote,output);
  return{text:patch.length>20_000?patch.slice(0,20_000):patch,truncated:patch.length>20_000};
 },[output,review.remote,review.remoteRevision]);

 return <Dialog isOpen onOpenChange={open=>{if(!open&&!busy)onClose();}} purpose="form"
  width={840} padding={4} aria-label="三方合并审查">
  <div className="rk-merge-review">
   <header className="rk-merge-header">
    <span className="rk-merge-icon"><Icon name="arrowsDiff" size="md"/></span>
    <div><h2>三方合并审查</h2>
     <p className="muted">编辑基线 R{review.fromRevision} · 服务器 R{review.remoteRevision}</p>
    </div>
   </header>
   <div className="rk-merge-scroll">
    {review.plan.reason==='limit'
     ?<Banner status="warning" container="section" title="无法安全计算合并"
       description="文档过大或差异过于复杂。保留本地草稿，请通过历史与源码手动比较，不会自动覆盖服务器内容。"/>
     :<Banner status={manual?'warning':'info'} container="section"
       title={manual?'有 '+conflicts.length+' 处需要明确处理':'已找到可安全合并的独立修改'}
       description={manual?'同一区域被修改或涉及 RMD 结构。可保留一方，也可以直接编写最终内容。结果先进入源码编辑器审核，不立即提交。':'修改位于互不重叠的普通 Markdown 行。请核对差异和结构，再确认保存。'}/>}

    {manual&&conflicts.map((piece,i)=><section className="rk-merge-conflict" data-merge-conflict={piece.id} key={piece.id}>
     <div className="rk-merge-conflict-head"><strong>冲突 {i+1}</strong>
      <span className="muted">{piece.reason==='structured'?'RMD / 结构性修改':'同一位置的不同修改'} · 基线第 {piece.baseStart+1} 行</span>
     </div>
     <div className="rk-merge-variants">
      <div><h3>原始版本</h3><pre>{piece.base||'（空）'}</pre></div>
      <div><h3>我的修改</h3><pre>{piece.local||'（已删除）'}</pre></div>
      <div><h3>服务器修改</h3><pre>{piece.remote||'（已删除）'}</pre></div>
     </div>
     <div className="rk-merge-choices">
      <Button label="保留本地" size="sm" variant={review.choices[piece.id]==='local'?'primary':'secondary'}
       onClick={()=>onChoose(piece.id,'local')}/>
      <Button label="采用远端" size="sm" variant={review.choices[piece.id]==='remote'?'primary':'secondary'}
       onClick={()=>onChoose(piece.id,'remote')}/>
      <Button label="手动编辑结果" size="sm" variant={review.choices[piece.id]==='custom'?'primary':'secondary'}
       onClick={()=>onEdit(piece.id,review.custom[piece.id]??(review.choices[piece.id]==='remote'?piece.remote:piece.local))}/>
      <span className="muted">{review.choices[piece.id]==='custom'?'手动结果':review.choices[piece.id]?'已选择':'尚未选择'}</span>
     </div>
     {review.choices[piece.id]==='custom'&&<div className="rk-merge-custom">
      <label htmlFor={'rk-merge-custom-'+piece.id}>冲突 {i+1} 的最终 Markdown（可修改或留空以删除）</label>
      <textarea id={'rk-merge-custom-'+piece.id} aria-label={'冲突 '+(i+1)+' 的最终内容'}
       spellCheck={false} rows={4} value={review.custom[piece.id]??''}
       onChange={event=>onEdit(piece.id,event.currentTarget.value)}/>
      <p className="muted">只修改这一处冲突；其余已合并的独立内容保持不变。</p>
     </div>}
    </section>)}

    {output!==null&&<>
     <section className="rk-merge-validation" aria-label="合并结构检查">
      <div className="rk-merge-section-title"><h3>Markdown / RMD 结构预检</h3>
       <span className="muted">仅检查可确定的语法边界，不代替完整编辑器校验</span>
      </div>
      {diagnostics.length===0
       ?<p className="rk-merge-validation-ok"><Icon name="check" size="sm"/> 未发现明显的围栏或容器闭合问题</p>
       :<><Banner status={structuralErrors?'warning':'info'} container="section"
          title={structuralErrors?'发现可能导致渲染异常的结构问题':'有需要人工检查的语法'}
          description={structuralErrors?'该结果只能载入源码编辑器，不能在本窗口直接保存。':'部分语法无法静态确认，请核对渲染结果。'}/>
        <ul>{diagnostics.slice(0,12).map(issue=><li key={issue.line+':'+issue.code}>
         第 {issue.line} 行：{issue.message}
        </li>)}</ul>
        {diagnostics.length>12&&<p className="muted">还有 {diagnostics.length-12} 处需要检查。</p>}
       </>}
     </section>
     <section className="rk-merge-output">
      <div className="rk-merge-preview-head">
       <h3>合并结果预览 <span className="muted">相对于服务器 R{review.remoteRevision}</span></h3>
       <ButtonGroup label="预览方式" size="sm">
        <Button label="差异" variant={view==='diff'?'secondary':'ghost'} onClick={()=>setView('diff')}/>
        <Button label="渲染" variant={view==='render'?'secondary':'ghost'} onClick={()=>setView('render')}/>
       </ButtonGroup>
      </div>
      {view==='diff'
       ?<><pre>{preview?.text}</pre>
        {preview?.truncated&&<p className="muted">差异预览已截断；完整结果将在源码编辑器中审核。</p>}</>
       :output.length>MAX_RENDER_CHARS
        ?<p className="muted">内容超过 {MAX_RENDER_CHARS} 字符，请载入文档预览模式完整检查。</p>
        :<div className="rk-merge-render record-main" data-merge-render>
         <React.Suspense fallback={<p className="muted">正在准备 RMD 渲染预览…</p>}>
          <MarkdownPreview content={output}/>
         </React.Suspense>
        </div>}
     </section>
    </>}
   </div>
   <footer className="rk-merge-footer">
    <Button label="返回编辑" variant="secondary" onClick={onClose} isDisabled={busy}/>
    <Button label={stageOnly?'载入源码审核（不保存）':'确认合并并保存'} variant="primary"
     isDisabled={output===null||busy} isLoading={busy}
     onClick={()=>{if(output!==null)onApply(output,stageOnly?'stage':'save');}}/>
   </footer>
  </div>
 </Dialog>;
}
