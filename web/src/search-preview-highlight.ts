import {highlightedSegments} from './highlight';

type Node={type:string;value?:string;tagName?:string;properties?:Record<string,unknown>;children?:Node[]};

/** Highlight visible prose after sanitization, preserving formula and code nodes. */
export function searchPreviewHighlight(query:string){
 return (tree:Node)=>{
  const visit=(node:Node)=>{
   if(['code','pre','math','mark'].includes(node.tagName??''))return;
   node.children=node.children?.flatMap(child=>{
    if(child.type!=='text'){visit(child);return [child];}
    return highlightedSegments(child.value??'',query).map(part=>part.matched
     ?{type:'element',tagName:'mark',properties:{className:['search-highlight']},children:[{type:'text',value:part.text}]}
     :{type:'text',value:part.text});
   });
  };
  visit(tree);
 };
}
