import React,{useEffect,useRef,useState} from 'react';
import type {Components} from 'react-markdown';
import {Button} from '@astryxdesign/core/Button';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Icon} from './icon';
import {OverlayScroll} from './scrollbars';
import {AutoResizer,AutoTransition} from './motion-primitives';

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
   if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
  },{rootMargin:'240px 0px'});
  observer.observe(element);
  return()=>observer.disconnect();
 },[]);
 return <section ref={anchor} className="rk-help-live-example" aria-label="RMD 示例实际渲染效果">
  <div className="rk-help-live-heading">实际渲染效果</div>
  <AutoResizer><div className="rk-help-live-surface record-main">
   {visible?<React.Suspense fallback={<ExampleLoading/>}>
     <AutoTransition transitionKey={markdown} initial><RmdPreview content={markdown}/></AutoTransition>
    </React.Suspense>:<ExampleLoading/>}
  </div></AutoResizer>
 </section>;
}

function ExampleLoading(){
 return <div className="rk-help-live-pending" role="status" aria-label="正在加载示例"><Skeleton width="78%" height={14}/><Skeleton width="56%" height={14}/></div>;
}

/** Only generated "complete example" fences are live. Syntax templates and
 * other code examples remain literal; no automatic execution of code blocks.
 */
export const RmdHelpPre:NonNullable<Components['pre']>=({node,children,...props})=>{
 const [copyState,setCopyState]=useState<'idle'|'copied'|'error'>('idle');
 useEffect(()=>{
  if(copyState==='idle')return;
  const timer=setTimeout(()=>setCopyState('idle'),2000);
  return()=>clearTimeout(timer);
 },[copyState]);
 const candidate=node?.children.find(child=>child.type==='element'&&child.tagName==='code');
 const element=candidate?.type==='element'?candidate:null;
 const language=element?.properties.className;
 const isLive=Array.isArray(language)&&language.includes('language-rmd-example');
 const text=element?.children.filter(child=>child.type==='text').map(child=>child.value).join('').trimEnd()??'';
 const copy=async()=>{
  try{
   if(!navigator.clipboard)throw Error('Clipboard unavailable');
   await navigator.clipboard.writeText(text);setCopyState('copied');
  }catch{setCopyState('error');}
 };
 const format=Array.isArray(language)?String(language[0]??'').replace(/^language-/,''):'';
 return <>
  <div className="rk-help-code"><div className="rk-help-code-head"><span>{isLive?'RMD':format==='text'?'语法模板':format==='json'?'JSON':'Markdown'}</span><Button label={copyState==='copied'?'已复制':'复制代码'} variant="ghost" size="sm" icon={<Icon name={copyState==='copied'?'check':'copy'} size="sm"/>} onClick={()=>void copy()}><AutoTransition as="span" transitionKey={copyState==='copied'?'copied':'copy'} duration={.12}>{copyState==='copied'?'已复制':'复制代码'}</AutoTransition></Button></div><OverlayScroll axis="x" edges><pre {...props}>{children}</pre></OverlayScroll>
   <AutoResizer><AutoTransition transitionKey={copyState==='error'?'error':'none'}>{copyState==='error'&&<p className="rk-help-copy-error" role="status">复制失败，可以选中代码后手动复制。</p>}</AutoTransition></AutoResizer>
  </div>
  {isLive&&text.length>0&&<RmdLiveExample markdown={text}/>}
 </>;
};
