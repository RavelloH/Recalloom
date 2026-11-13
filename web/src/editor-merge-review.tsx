import React,{useMemo} from 'react';
import {createTwoFilesPatch} from 'diff';
import {Dialog} from '@astryxdesign/core/Dialog';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Icon} from './icon';
import {
 resolveThreeWayMerge,type MergeChoice,type MergePlan
} from './three-way-merge';

export type MergeReview={
 fromRevision:number;remoteRevision:number;remote:string;local:string;
 plan:MergePlan;choices:Record<number,MergeChoice>;
};
/** Controlled review; no write is performed until the parent revalidates CAS. */
export function EditorMergeReview({review,busy,onChoose,onClose,onApply}:{
 review:MergeReview;busy:boolean;
 onChoose:(id:number,choice:MergeChoice)=>void;
 onClose:()=>void;
 onApply:(output:string,mode:'save'|'stage')=>void;
}){
 const conflicts=review.plan.pieces.filter(piece=>piece.kind==='conflict');
 const output=resolveThreeWayMerge(review.plan,review.choices);
 const manual=conflicts.length>0;
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
       description={manual?'同一区域被修改或涉及 RMD 结构。逐处选择保留哪一方，结果将载入源码编辑器继续审核，不会立即写入服务器。':'修改位于互不重叠的普通 Markdown 行。请预览对服务器版本的增量，再确认保存。'}/>}
    {manual&&conflicts.map((piece,i)=><section className="rk-merge-conflict" data-merge-conflict={piece.id} key={piece.id}>
     <div className="rk-merge-conflict-head"><strong>冲突 {i+1}</strong>
      <span className="muted">{piece.reason==='structured'?'RMD / 结构性修改':'同一位置的不同修改'} · 基线第 {piece.baseStart+1} 行</span></div>
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
      <span className="muted">{review.choices[piece.id]?'已选择':'尚未选择'}</span>
     </div>
    </section>)}
    {preview&&<section className="rk-merge-output">
     <h3>合并结果预览 <span className="muted">相对于服务器 R{review.remoteRevision}</span></h3>
     <pre>{preview.text}</pre>
     {preview.truncated&&<p className="muted">预览已截断；完整内容只在源码编辑器中审核。</p>}
    </section>}
   </div>
   <footer className="rk-merge-footer">
    <Button label="返回编辑" variant="secondary" onClick={onClose} isDisabled={busy}/>
    <Button label={manual?'载入源码审核（不保存）':'确认合并并保存'} variant="primary"
     isDisabled={output===null||busy} isLoading={busy}
     onClick={()=>{if(output!==null)onApply(output,manual?'stage':'save');}}/>
   </footer>
  </div>
 </Dialog>;
}
