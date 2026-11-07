import React,{useState} from 'react';

/** A purely presentational cloze reveal; opening the answer does not write to
 * the Markdown document, expose a hidden comment, or grade the user.
 */
export default function ClozeReveal({hint,children}:{hint?:string;children?:React.ReactNode}){
 const [revealed,setRevealed]=useState(false);
 const prompt=String(hint??'').trim().slice(0,120)||'显示挖空答案';
 return <span className={'rk-cloze-read'+(revealed?' rk-cloze-open':'')}>
  <button type="button" className="rk-cloze-reveal" aria-expanded={revealed}
   aria-label={revealed?'隐藏挖空答案':'显示挖空答案：'+prompt} onClick={()=>setRevealed(!revealed)}>
   {revealed?children:prompt}
  </button>
 </span>;
}
