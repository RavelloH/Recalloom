import React,{useEffect,useRef,useState} from 'react';
import type {Components} from 'react-markdown';

/** Use the production, sanitized RMD preview rather than a separate demo renderer. */
const RmdPreview=React.lazy(()=>import('./markdown-preview'));

function RmdLiveExample({markdown}:{markdown:string}){
 const anchor=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  const element=anchor.current;
  if(!element)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting))setVisible(true);
  },{rootMargin:'240px 0px'});
  observer.observe(element);
  return()=>observer.disconnect();
 },[]);
 return <section ref={anchor} className="rk-help-live-example" aria-label="RMD 示例实际渲染效果">
  <div className="rk-help-live-heading">实际渲染效果</div>
  <div className="rk-help-live-surface record-main">
   {visible?<React.Suspense fallback={<p className="rk-help-live-pending" role="status">正在加载示例…</p>}>
     <RmdPreview content={markdown}/>
    </React.Suspense>:<p className="rk-help-live-pending">滚动到此处后显示实际渲染效果</p>}
  </div>
 </section>;
}

/** Only generated "complete example" fences are live. Syntax templates and
 * other code examples remain literal; no automatic execution of code blocks.
 */
export const RmdHelpPre:NonNullable<Components['pre']>=({node,children,...props})=>{
 const candidate=node?.children.find(child=>child.type==='element'&&child.tagName==='code');
 const element=candidate?.type==='element'?candidate:null;
 const language=element?.properties.className;
 const isLive=Array.isArray(language)&&language.includes('language-rmd-example');
 const text=isLive?element?.children.filter(child=>child.type==='text').map(child=>child.value).join('').trimEnd():null;
 return <>
  <pre {...props}>{children}</pre>
  {typeof text==='string'&&text.length>0&&<RmdLiveExample markdown={text}/>}
 </>;
};
