import {unified} from 'unified';
import remarkParse from 'remark-parse';

const parser=unified().use(remarkParse);
type MarkdownNode={
 type:string;
 value?:string;
 alt?:string;
 children?:MarkdownNode[];
};

// An H1 stays inside the editable Markdown body, not in the filename header.
/** Counts visible Unicode characters, rather than whitespace or Markdown delimiters.
 * Unlike word segmentation, this treats Chinese and English content consistently. */
export function markdownCharacterCount(markdown:string):number{
 const root=parser.parse(markdown) as MarkdownNode;
 const fragments:string[]=[];
 const walk=(node:MarkdownNode)=>{
  if(node.type==='text'||node.type==='inlineCode'||node.type==='code'||node.type==='math'||node.type==='inlineMath'){
   fragments.push(node.value??'');return;
  }
  if(node.type==='image'){fragments.push(node.alt??'');return;}
  node.children?.forEach(walk);
 };
 root.children?.forEach(walk);
 return Array.from(fragments.join('').replace(/\s/gu,'')).length;
}
