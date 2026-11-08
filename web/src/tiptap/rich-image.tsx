import React,{useEffect,useState} from 'react';
import Image from '@tiptap/extension-image';
import {ReactNodeViewRenderer,NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {TextInput} from '@astryxdesign/core/TextInput';
import {serializeFigureSuffix,safeFigureImageSrc} from '../figure-syntax';
import {validCrossRefId} from '../cross-reference';
import {useReferenceIndex} from './cross-reference';
import {headingAnchor} from '../wiki-slug';

function sizeAttr(value:unknown):number|null{
 const n=typeof value==='number'?value:Number(value);
 return Number.isInteger(n)&&n>=40&&n<=1800?n:null;
}
function cleanText(value:unknown,max=240):string{
 return String(value??'').replace(/[\r\n]/g,' ').slice(0,max);
}
function FigureNodeView({node,updateAttributes,selected,editor}:NodeViewProps){
 const attrs=node.attrs as {src?:string;alt?:string;title?:string;width?:number;height?:number;caption?:string;figureId?:string};
 const [caption,setCaption]=useState(cleanText(attrs.caption));
 const [width,setWidth]=useState(attrs.width?String(attrs.width):'');
 const [height,setHeight]=useState(attrs.height?String(attrs.height):'');
 const [figureId,setFigureId]=useState(String(attrs.figureId??''));
 const index=useReferenceIndex(editor);
 const id=validCrossRefId(attrs.figureId,'fig')?attrs.figureId!:null;
 const number=id?index.get(id)?.label:null;
 useEffect(()=>setCaption(cleanText(attrs.caption)),[attrs.caption]);
 useEffect(()=>setWidth(attrs.width?String(attrs.width):''),[attrs.width]);
 useEffect(()=>setHeight(attrs.height?String(attrs.height):''),[attrs.height]);
 useEffect(()=>setFigureId(String(attrs.figureId??'')),[attrs.figureId]);
 const commitCaption=()=>{const next=cleanText(caption);if(next!==cleanText(attrs.caption))updateAttributes({caption:next});};
 const commitSize=(field:'width'|'height',draft:string)=>{
  const next=draft.trim()?sizeAttr(draft):null;
  if(draft.trim()&&next===null)return;
  if(next!==sizeAttr(attrs[field]))updateAttributes({[field]:next});
 };
 const src=String(attrs.src??'');
 const widthValue=sizeAttr(attrs.width);
 const heightValue=sizeAttr(attrs.height);
 const commitId=()=>{const value=figureId.trim().toLowerCase();if(value&&!validCrossRefId(value,'fig'))return;
  if((value||null)!==(id??null))updateAttributes({figureId:value||null});};
 return <NodeViewWrapper as="figure" id={id?headingAnchor(id):undefined} data-rk-figure-id={id??undefined} className={'rk-rich-figure'+(selected?' rk-rich-figure-selected':'')} data-rk-rich-figure="">
  {safeFigureImageSrc(src)
   ?<img src={src} alt={cleanText(attrs.alt)} title={cleanText(attrs.title)||undefined} loading="lazy"
     draggable={false} referrerPolicy="no-referrer"
     style={{width:widthValue?widthValue+'px':undefined,height:heightValue?heightValue+'px':undefined,objectFit:'contain'}}/>
   :<div className="rk-rich-figure-invalid">图片地址不可用</div>}
  {(attrs.caption||number)&&<figcaption className="rk-rich-figcaption">{number&&<strong className="rk-cross-caption-number">{number}{attrs.caption?'：':''}</strong>}{cleanText(attrs.caption)}</figcaption>}
  {selected&&<div className="rk-rich-figure-controls" contentEditable={false}>
   <TextInput label="图注（可选）" width="100%" value={caption} onChange={setCaption} onBlur={commitCaption}
     placeholder="为这张图片添加说明"/>
   <TextInput label="宽度 px" value={width} onChange={setWidth} onBlur={()=>commitSize('width',width)}
     placeholder="自动"/>
   <TextInput label="高度 px" value={height} onChange={setHeight} onBlur={()=>commitSize('height',height)}
     placeholder="自动"/>
   <TextInput label="图 ID（fig-...）" value={figureId} onChange={setFigureId} onBlur={commitId}
     placeholder="fig-diagram"/>
  </div>}
 </NodeViewWrapper>;
}

export const RichImage=Image.extend({
 name:'image',
 addAttributes(){
  return {...this.parent?.(),caption:{default:''},figureId:{default:null}};
 },
 renderHTML({HTMLAttributes}){
  const {caption:_caption,figureId:_figureId,...attrs}=HTMLAttributes;
  return ['img',attrs];
 },
 renderMarkdown(node){
  const attrs=node.attrs??{};
  const alt=String(attrs.alt??'').replace(/\\/g,'\\\\').replace(/\]/g,'\\]');
  const src=String(attrs.src??'').replace(/\s/g,'%20');
  const title=String(attrs.title??'');
  const image='!['+alt+']('+src+(title?' "'+title.replace(/"/g,'\\"')+'"':'')+')';
  const suffix=serializeFigureSuffix({
   width:sizeAttr(attrs.width),
   height:sizeAttr(attrs.height),
   caption:cleanText(attrs.caption),id:validCrossRefId(attrs.figureId,'fig')?attrs.figureId:undefined
  });
  return image+suffix;
 },
 addNodeView(){return ReactNodeViewRenderer(FigureNodeView);}
});
