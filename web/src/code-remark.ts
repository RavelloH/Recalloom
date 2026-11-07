import {parseCodeFenceMeta} from './code-meta';
type MarkdownCodeNode={type:string;lang?:string;meta?:string;children?:MarkdownCodeNode[];data?:{hProperties?:Record<string,string>}};
export function remarkCodeMetadata(){
 return (tree:MarkdownCodeNode)=>{
  const walk=(node:MarkdownCodeNode)=>{
   if(node.type==='code'){
    const attrs=parseCodeFenceMeta([node.lang??'',node.meta??''].join(' ').trim());
    node.data={...(node.data??{}),hProperties:{
     ...(node.data?.hProperties??{}),dataFile:attrs.filename,
     dataWrap:String(attrs.wrap),dataExpand:String(attrs.expand)
    }};
   }
   node.children?.forEach(walk);
  };
  walk(tree);
 };
}
