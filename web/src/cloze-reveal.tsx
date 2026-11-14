import React,{useId,useState} from 'react';
import {Button} from '@astryxdesign/core/Button';

/** A purely presentational cloze reveal; opening the answer does not write to
 * the Markdown document, expose a hidden comment, or grade the user.
 */
export default function ClozeReveal({hint,children}:{hint?:string;children?:React.ReactNode}){
 const [revealed,setRevealed]=useState(false);
 const answerId=useId();
 const prompt=String(hint??'').trim().slice(0,120)||'显示挖空答案';
 return <span className={'rk-cloze-read'+(revealed?' rk-cloze-open':'')}>
  <Button className="rk-cloze-reveal" variant="ghost" size="sm" aria-expanded={revealed} aria-controls={answerId}
   label={revealed?'隐藏挖空答案':'显示挖空答案：'+prompt} onClick={()=>setRevealed(open=>!open)}>
   <span className="rk-cloze-trigger-label">{revealed?'隐藏':prompt}</span>
  </Button>
  <span id={answerId} className="rk-cloze-read-answer" hidden={!revealed}>{children}</span>
 </span>;
}
