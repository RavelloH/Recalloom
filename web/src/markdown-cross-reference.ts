import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import {parseFigureSuffix} from './figure-syntax';
import {parseTableCaption} from './table-caption';
import {collectCrossRefs,parseEquationId,shieldEquationIdClosers,validCrossRefId,type CrossRefIndex} from './cross-reference';
import type {JSONContent} from '@tiptap/core';

type MdNode={
 type:string;value?:string;children?:MdNode[];
 position?:{start?:{offset?:number};end?:{offset?:number}};
};
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective);
const at=(node:MdNode,source:string)=>{
 const start=node.position?.start?.offset,end=node.position?.end?.offset;
 return start===undefined||end===undefined?'':source.slice(start,end);
};
function figureId(node:MdNode):string|null{
 if(node.type!=='paragraph'||node.children?.length!==2)return null;
 const [image,tail]=node.children;
 if(image?.type!=='image'||tail?.type!=='text')return null;
 const attrs=parseFigureSuffix(tail.value??'');
 return attrs?.id&&validCrossRefId(attrs.id,'fig')?attrs.id:null;
}
/** Parse Markdown only when a projection is requested. IDs remain in source,
 * and no table/index/cache invalidation job is needed. */
export function collectPreviewRefs(source:string):CrossRefIndex{
 const ast=parser.parse(shieldEquationIdClosers(source)) as MdNode;
 const refs:JSONContent[]=[];
 const walk=(nodes:MdNode[])=>{
  for(let i=0;i<nodes.length;i++){
   const node=nodes[i]!;
   const image=figureId(node);
   if(image)refs.push({type:'image',attrs:{figureId:image}});
   if(node.type==='math'){
    const equation=parseEquationId(at(node,source));
    if(equation)refs.push({type:'blockMath',attrs:{equationId:equation.id}});
   }
   if(node.type==='table'&&nodes[i+1]?.type==='paragraph'){
    const caption=parseTableCaption(at(nodes[i+1]!,source));
    if(caption)refs.push({type:'table',attrs:{tableId:caption.id}});
   }
   if(node.children)walk(node.children);
  }
 };
 walk(ast.children??[]);
 return collectCrossRefs({type:'doc',content:refs});
}
function escapeHtml(source:string):string{
 return source.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const token=/(^|[^a-zA-Z0-9_.-])@((?:fig|eq|tbl)-[a-z][a-z0-9-]{0,63})(?![a-z0-9-])/gi;
/** Render math IDs and inline @references without changing Markdown or
 * executing arbitrary HTML/JS. All generated attribute values are bounded. */
export function remarkCrossRefDisplay(source:string){
 return (root:MdNode)=>{
  const walk=(parent:MdNode)=>{
   if(!parent.children)return;
   for(let i=0;i<parent.children.length;i++){
    const child=parent.children[i]!;
    if(child.type==='math'){
     const eq=parseEquationId(at(child,source));
     if(eq){
      parent.children[i]={type:'html',value:
       '<rk-numbered-math data-id="'+eq.id+'"><pre><code class="language-math">'+escapeHtml(eq.latex)+'</code></pre></rk-numbered-math>'};
      continue;
     }
    }
    if(child.type==='text'&&child.value?.includes('@')){
     const value=child.value;
     // remark decodes Markdown escapes and HTML entities before reaching text
     // nodes. Only recognize @references explicitly present and unescaped in
     // the original source, never a decoded \\@id or &#64;id. If the parser
     // transformed a token in a way we cannot align safely, leave this text
     // plain rather than inventing a reference.
     const original=at(child,source);
     const sourceMatches=[...original.matchAll(token)];
     const textMatches=[...value.matchAll(token)];
     const aligned=sourceMatches.length===textMatches.length&&sourceMatches.every(
      (match,n)=>match[2]!.toLowerCase()===textMatches[n]![2]!.toLowerCase());
     const converted:MdNode[]=[];
     let offset=0,found=false;
     if(!aligned)continue;
     for(const [n,m] of textMatches.entries()){
      const raw=sourceMatches[n]!;
      const rawAt=(raw.index??0)+raw[1]!.length;
      let backslashes=0;
      for(let i=rawAt-1;i>=0&&original[i]==='\\';i--)backslashes++;
      if(backslashes%2)continue;
      const before=(m.index??0)+m[1]!.length,id=m[2]!.toLowerCase();
      if(!validCrossRefId(id))continue;
      const segment=value.slice(offset,before);
      if(segment)converted.push({type:'text',value:segment});
      converted.push({type:'html',value:'<rk-cross-ref data-id="'+id+'"></rk-cross-ref>'});
      offset=before+1+m[2]!.length;
      found=true;
     }
     if(found){
      if(offset<value.length)converted.push({type:'text',value:value.slice(offset)});
      parent.children.splice(i,1,...converted);
      i+=converted.length-1;
      continue;
     }
    }
    if(child.type!=='link'&&child.type!=='linkReference'&&child.type!=='code'&&child.type!=='inlineCode'&&child.children)walk(child);
   }
  };
  walk(root);
 };
}
