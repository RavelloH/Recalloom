import remarkDirective from 'remark-directive';
import {richContainerKinds,richInlineKinds,validContainerParent} from './tiptap/rich-schema';
import {parseInlineDirectiveSource} from './markdown-attrs';

type RichAst={type:string;name?:string;value?:string;attributes?:Record<string,string|null>;
 children?:RichAst[];data?:{hName?:string;hProperties?:Record<string,string> ;directiveLabel?:boolean};
 position?:{start?:{offset?:number};end?:{offset?:number}}};
const supported=(kind:string)=>kind==='badge'||kind==='abbr'||kind==='tooltip'||kind==='kbd'||kind==='cloze';
const escapeText=(value:string)=>value;
// Align with the visual editor: comments are single-line, visible annotations.
const commentRx=/%%((?:[^%\r\n]|%(?!%))+)%%/g;
export function remarkRichTransforms(source:string){
 return (root:RichAst)=>{
  function walk(node:RichAst,parentKind?:string){
   if(!node.children)return;
   const updated:RichAst[]=[];
   for(let i=0;i<node.children.length;i++){
    const child=node.children[i]!;
    if(child.type==='containerDirective'){
     const kind=String(child.name??'');
     if(richContainerKinds.has(kind)&&validContainerParent(kind,parentKind)){
      const label=child.children?.find(item=>item.data?.directiveLabel===true);
      const title=(label?.children??[]).map(x=>x.value??'').join('');
      child.data={...(child.data??{}),hName:'rk-callout',hProperties:{dataKind:kind,dataTitle:title,...(kind==='message'?{dataSender:child.attributes?.sender??'assistant'}:{})}};
      child.children=(child.children??[]).filter(item=>!item.data?.directiveLabel);
      walk(child,kind);
      updated.push(child);
     }else updated.push(asLiteral(child,source));
     continue;
    }
    if(child.type==='leafDirective'&&child.name==='link-card'&&child.attributes?.url){
     child.data={...(child.data??{}),hName:'rk-link-card',hProperties:{dataUrl:child.attributes.url,dataTitle:(child.children??[]).map(x=>x.value??'').join('')}};
     child.children=[];updated.push(child);continue;
    }
    if(child.type==='textDirective'||child.type==='leafDirective'){
     const kind=String(child.name??'');
     if(kind==='highlight'&&child.type==='textDirective'&&['red','orange','yellow','green','blue','purple','pink','cyan','teal'].includes(String(child.attributes?.color??''))){
      child.data={...(child.data??{}),hName:'mark',hProperties:{dataRkColor:String(child.attributes?.color)}};
      walk(child);updated.push(child);
     }else if(supported(kind)&&richInlineKinds.has(kind)&&child.type==='textDirective'){
      const start=child.position?.start?.offset,end=child.position?.end?.offset;
      const explicit=start!==undefined?parseInlineDirectiveSource(source.slice(start),kind):null;
      // remark-directive does not parse JSON-escaped quotes in {...} and
      // leaves that attribute suffix as the following text sibling. Consume
      // only the proven source suffix, not any ordinary text after it.
      if(explicit&&start!==undefined&&end!==undefined&&start+explicit.raw.length>end){
       const next=node.children[i+1],limit=next?.position?.end?.offset;
       if(next?.type==='text'&&next.position?.start?.offset===end&&
          limit!==undefined&&limit>=start+explicit.raw.length){
        const rest=source.slice(start+explicit.raw.length,limit);
        if(rest)next.value=rest;
        else i++;
       }else{updated.push(asLiteral(child,source));continue;}
      }
      const attrs=explicit?.attrs??child.attributes??{};
      child.data={...(child.data??{}),hName:'rk-'+kind,hProperties:{
       dataVariant:attrs.variant??'neutral',dataTitle:attrs.title??'',
       dataContent:attrs.content??'',dataHint:attrs.hint??''
      }};
      walk(child);updated.push(child);
     }else updated.push(asLiteral(child,source));
     continue;
    }
    if(child.type==='text'&&child.value?.includes('%%')){
     const sourceText=child.value;
     commentRx.lastIndex=0;
     let prev=0,m:RegExpExecArray|null;
     while((m=commentRx.exec(sourceText))!==null){
      if(m.index>prev)updated.push({type:'text',value:sourceText.slice(prev,m.index)});
      updated.push({type:'textDirective',name:'comment',children:[{type:'text',value:escapeText(m[1]??'')}],
       data:{hName:'rk-comment'}});
      prev=m.index+m[0].length;
     }
     if(prev===0)updated.push(child);
     else if(prev<sourceText.length)updated.push({type:'text',value:sourceText.slice(prev)});
     continue;
    }
    walk(child,parentKind);
    updated.push(child);
   }
   node.children=updated;
  }
  walk(root);
 };
}
function asLiteral(node:RichAst,source:string):RichAst{
 const start=node.position?.start?.offset,end=node.position?.end?.offset;
 return {type:'text',value:start!==undefined&&end!==undefined?source.slice(start,end):node.value??''};
}
export const richRemarkDirective=remarkDirective;
