import remarkDirective from 'remark-directive';
import {richContainerKinds,richInlineKinds} from './tiptap/rich-schema';

type RichAst={type:string;name?:string;value?:string;attributes?:Record<string,string|null>;
 children?:RichAst[];data?:{hName?:string;hProperties?:Record<string,string> ;directiveLabel?:boolean};
 position?:{start?:{offset?:number};end?:{offset?:number}}};
const supported=(kind:string)=>kind==='badge'||kind==='abbr'||kind==='tip';
const escapeText=(value:string)=>value;
const commentRx=/%%([\s\S]*?)%%/g;
export function remarkRichTransforms(source:string){
 return (root:RichAst)=>{
  function walk(node:RichAst){
   if(!node.children)return;
   const updated:RichAst[]=[];
   for(const child of node.children){
    if(child.type==='containerDirective'){
     const kind=String(child.name??'');
     if(richContainerKinds.has(kind)){
      const label=child.children?.find(item=>item.data?.directiveLabel===true);
      const title=(label?.children??[]).map(x=>x.value??'').join('');
      child.data={...(child.data??{}),hName:'rk-callout',hProperties:{dataKind:kind,dataTitle:title,...(kind==='message'?{dataSender:child.attributes?.sender??'assistant'}:{})}};
      child.children=(child.children??[]).filter(item=>!item.data?.directiveLabel);
      walk(child);
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
      child.data={...(child.data??{}),hName:'rk-'+kind,hProperties:{
       dataVariant:child.attributes?.variant??'neutral',
       dataTitle:child.attributes?.title??'',
       dataContent:child.attributes?.content??''
      }};
      walk(child); updated.push(child);
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
    walk(child);
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
