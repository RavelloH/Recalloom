import React,{useEffect,useState} from 'react';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Copy,WrapText,ChevronDown,ChevronUp,FileCode2} from 'lucide-react';
import type {CodeMeta} from './code-meta';
import MermaidDiagram from './mermaid-diagram';
import {isRmdId} from './rmd-schema';
import {headingAnchor} from './wiki-slug';

export default function ShikiCodePreview({code,language,id,filename,wrap:defaultWrap,expand:alwaysExpand}:{
 code:string;language:string|null;id?:string;filename?:string;wrap?:boolean;expand?:boolean;
}){
 const [html,setHtml]=useState<string|null>(null);
 const [wrap,setWrap]=useState(!!defaultWrap);
 const [expanded,setExpanded]=useState(false);
 const count=code.split('\n').length;
 const fold=count>20&&!alwaysExpand&&!expanded;
 useEffect(()=>{
  let alive=true;
  setHtml(null);
  (async()=>{
   try{
    const shiki=await import('shiki');
    const lang=(language&&Object.prototype.hasOwnProperty.call(shiki.bundledLanguages,language))?language:'plaintext';
    const output=await shiki.codeToHtml(code,{lang,themes:{light:'github-light-high-contrast',dark:'github-dark-high-contrast'}});
    if(alive)setHtml(output);
   }catch{if(alive)setHtml(null);}
  })();
  return()=>{alive=false;};
 },[code,language]);
 return <div id={id&&isRmdId(id)?headingAnchor(id):undefined} className={'rk-code-block rk-code-preview'+(wrap?' rk-code-wrap':'')+(fold?' rk-code-folded':'')}>
  <div className="rk-code-header">
   <div className="rk-code-title"><FileCode2 size={15} aria-hidden="true"/><span>{filename||language||'Text'}</span></div>
   <div className="rk-code-actions">
    <IconButton label={wrap?'关闭自动换行':'开启自动换行'} icon={<WrapText size={16}/>} variant="ghost" size="sm" onClick={()=>setWrap(!wrap)}/>
    <IconButton label="复制代码" icon={<Copy size={16}/>} variant="ghost" size="sm"
      onClick={()=>{if(typeof navigator!=='undefined'&&navigator.clipboard)void navigator.clipboard.writeText(code);}}/>
   </div>
  </div>
  {language?.toLowerCase()==='mermaid'&&<MermaidDiagram code={code}/>}
  <div className="rk-code-viewport">
   {html?<div className="rk-shiki-html" dangerouslySetInnerHTML={{__html:html}}/>
   :<pre><code>{code}</code></pre>}
  </div>
  {count>20&&!alwaysExpand&&<div className="rk-code-fold-button">
    <IconButton label={fold?'展开全部代码':'收起长代码'} size="sm" variant="ghost"
      icon={fold?<ChevronDown size={16}/>:<ChevronUp size={16}/>} onClick={()=>setExpanded(!expanded)}/>
   </div>}
 </div>;
}
export function codePropsFromElement(child:unknown):CodeMeta&{code:string}{
 if(!React.isValidElement(child))return {language:null,filename:'',wrap:false,expand:false,code:''};
 const props=child.props as Record<string,unknown>;
 const cls=String(props.className??'');
 return {
  language:/language-([a-z0-9_+.#-]+)/i.exec(cls)?.[1]??null,
  // rehype-sanitize already prefixes id to prevent DOM clobbering; the
  // Shiki wrapper applies exactly one canonical prefix of its own.
  id:String(props.id??'').replace(/^user-content-/,''),
  filename:String(props['data-file']??''),
  wrap:String(props['data-wrap']??'')==='true',
  expand:String(props['data-expand']??'')==='true',
  code:React.Children.toArray(props.children as React.ReactNode).map(x=>typeof x==='string'?x:'').join('').replace(/\n$/,'')
 };
}
