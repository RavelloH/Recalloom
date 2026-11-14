import {diffArrays} from 'diff';
import {previewComparisonTree,type PreviewHastNode} from './markdown-preview-pipeline';

type TextNode=PreviewHastNode&{value:string};
type Leaf={node:TextNode;parent:PreviewHastNode;start:number;end:number};
const opaqueTags=new Set(['pre','code','rk-numbered-math','rk-figure','wiki-embed']);

function prose(tree:PreviewHastNode){
 let text='';
 const leaves:Leaf[]=[];
 const visit=(parent:PreviewHastNode)=>{
  if(opaqueTags.has(parent.tagName??''))return;
  for(const node of parent.children??[]){
   if(node.type==='text'){
    const leaf=node as TextNode,start=text.length;
    text+=leaf.value;leaves.push({node:leaf,parent,start,end:text.length});
   }else visit(node);
  }
 };
 visit(tree);
 return {text,leaves};
}

/** Adds trusted spans after sanitization; source markup is never interpolated. */
export function revisionWordHighlight(otherContent:string,side:'added'|'removed'){
 // A block-level highlight remains sufficient for very large replacements.
 const other=otherContent.length<=12_000?prose(previewComparisonTree(otherContent)).text:null;
 return function rehypeRevisionWords(){
  return (tree:PreviewHastNode)=>{
   if(other===null)return;
   const current=prose(tree);
   if(current.text.length>12_000||current.text===other)return;
   const parts=diffArrays(Array.from(side==='added'?other:current.text),
    Array.from(side==='added'?current.text:other),{timeout:25,maxEditLength:1800});
   if(!parts)return;
   let offset=0;
   const ranges:Array<{start:number;end:number}>=[];
   for(const part of parts){
    const present=side==='added'?!part.removed:!part.added;
    if(!present)continue;
    const length=part.value.join('').length;
    if(side==='added'?part.added:part.removed)ranges.push({start:offset,end:offset+length});
    offset+=length;
   }
   for(const leaf of current.leaves){
    const matches=ranges.filter(range=>range.start<leaf.end&&range.end>leaf.start);
    if(!matches.length)continue;
    const children:PreviewHastNode[]=[];
    let cursor=0;
    const text=(value:string)=>({type:'text',value} as TextNode);
    for(const range of matches){
     const start=Math.max(0,range.start-leaf.start),end=Math.min(leaf.end-leaf.start,range.end-leaf.start);
     if(start>cursor)children.push(text(leaf.node.value.slice(cursor,start)));
     children.push({type:'element',tagName:'span',properties:{className:['rk-revision-word']},children:[text(leaf.node.value.slice(start,end))]});
     cursor=end;
    }
    if(cursor<leaf.node.value.length)children.push(text(leaf.node.value.slice(cursor)));
    const index=leaf.parent.children!.indexOf(leaf.node);
    leaf.parent.children!.splice(index,1,...children);
   }
  };
 };
}
