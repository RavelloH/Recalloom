import React,{useMemo,useState} from 'react';
import {Dialog} from '@astryxdesign/core/Dialog';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Button} from '@astryxdesign/core/Button';
import {Selector} from '@astryxdesign/core/Selector';
import {Link2,Image as ImageIcon,Sigma} from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {validLink,validImage} from './editor-actions';

export type InsertDialogState=
 |{kind:'link';from:number;to:number;text:string;url:string;existing:boolean}
 |{kind:'image';src:string;alt:string;title:string;existing:boolean}
 |{kind:'math';latex:string;type:'inline'|'block';position?:number;existing:boolean};

export function EditorInsertDialog({value,onClose,onApply,onRemove}:{value:InsertDialogState;onClose:()=>void;onApply:(state:InsertDialogState)=>void;onRemove:()=>void}){
 const [draft,setDraft]=useState<InsertDialogState>(value);
 const update=(fields:Record<string,unknown>)=>setDraft(prev=>({...prev,...fields}) as InsertDialogState);
 const valid=draft.kind==='link'?validLink(draft.url):draft.kind==='image'?validImage(draft.src):!!draft.latex.trim();
 const mathPreview=useMemo(()=>{
  if(draft.kind!=='math'||!draft.latex.trim())return '';
  try{return katex.renderToString(draft.latex,{throwOnError:false,trust:false,strict:'warn',displayMode:draft.type==='block'});}
  catch{return '';}
 },[draft]);
 const title=draft.kind==='link'?'链接':draft.kind==='image'?'图片':'数学公式';
 return <Dialog isOpen onOpenChange={open=>{if(!open)onClose();}} purpose="form" width={480} padding={4} aria-label={(draft.existing?'编辑':'插入')+title}>
  <form className="editor-insert-form" onSubmit={event=>{event.preventDefault();if(valid)onApply(draft);}}>
   <header className="editor-insert-heading"><span className="editor-insert-icon">{draft.kind==='link'?<Link2 size={18}/>:draft.kind==='image'?<ImageIcon size={18}/>:<Sigma size={18}/>}</span><div><h2>{draft.existing?'编辑':'插入'}{title}</h2><p className="muted small">{draft.kind==='link'?'添加或修改 Markdown 超链接':draft.kind==='image'?'使用网络图片地址并添加替代文本':'支持行内公式和独立块级 LaTeX'}</p></div></header>
   {draft.kind==='link'&&<>
    <TextInput label="链接文字" width="100%" value={draft.text} onChange={text=>update({text})} placeholder="可选，默认使用选中文本"/>
    <TextInput label="链接地址" width="100%" value={draft.url} onChange={url=>update({url})} placeholder="https://example.com 或 /path、#anchor" hasAutoFocus/>
   </>}
   {draft.kind==='image'&&<>
    <TextInput label="图片地址" width="100%" value={draft.src} onChange={src=>update({src})} placeholder="https://example.com/image.png" hasAutoFocus/>
    <TextInput label="替代文本（Alt）" width="100%" value={draft.alt} onChange={alt=>update({alt})} placeholder="描述图片内容"/>
    <TextInput label="图片标题（可选）" width="100%" value={draft.title} onChange={title=>update({title})}/>
    {validImage(draft.src)&&<div className="editor-image-preview"><img src={draft.src} alt={draft.alt||'图片预览'} loading="lazy"/></div>}
   </>}
   {draft.kind==='math'&&<>
    <Selector label="公式类型" width="100%" value={draft.type} options={[{value:'inline',label:'行内公式 $…$'},{value:'block',label:'块级公式 $$…$$'}]} onChange={type=>update({type})}/>
    <TextArea label="LaTeX 公式" width="100%" rows={4} value={draft.latex} onChange={latex=>update({latex})} placeholder="例如：\\frac{a}{b}" hasAutoFocus/>
    <div className="editor-math-preview" aria-label="数学公式预览">{mathPreview?<div dangerouslySetInnerHTML={{__html:mathPreview}}/>:<span className="muted small">输入 LaTeX 后实时显示预览</span>}</div>
   </>}
   {!valid&&((draft.kind==='link'&&draft.url)||(draft.kind==='image'&&draft.src))&&<p className="muted small" role="status">仅支持安全的 HTTP(S) 地址，以及适用的相对路径或协议。</p>}
   <footer className="editor-insert-actions">{draft.existing&&<Button label={'删除'+title} variant="destructive" size="sm" onClick={onRemove}/>}<span className="editor-insert-spacer"/><Button label="取消" variant="secondary" size="sm" onClick={onClose}/><Button label={draft.existing?'更新':'插入'} type="submit" variant="primary" size="sm" isDisabled={!valid}/></footer>
  </form>
 </Dialog>;
}
