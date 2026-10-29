import type { JSONContent } from '@tiptap/core';

/**
 * Adapted from NeutralPress's TiptapEditor table-alignment postprocessor.
 * The stock Markdown parser does not populate the tableCell textAlign attribute,
 * so this repairs the document JSON before first render/serialization.
 */
export function postProcessTableAlignment(json: JSONContent, markdown: string): JSONContent {
 const lines=markdown.replace(/\r\n/g,'\n').split('\n');
 const tableAlignments: Array<Array<'left'|'center'|'right'|null>>=[];
 let inFence=false, marker='';
 for(const line of lines){
  const trimmed=line.trim();
  const fence=/^(\x60{3,}|~{3,})/.exec(trimmed);
  if(fence){if(!inFence){inFence=true;marker=fence[1]![0];}else if(fence[1]![0]===marker)inFence=false;continue;}
  if(inFence)continue;
  if(!trimmed.includes('|'))continue;
  const clean=trimmed.replace(/^\|/,'').replace(/\|$/,'');
  const cells=clean.split(/(?<!\\)\|/).map(c=>c.trim());
  if(cells.length===0||!cells.every(c=>/^:?-{3,}:?$/.test(c)))continue;
  tableAlignments.push(cells.map(c=>c.startsWith(':')&&c.endsWith(':')?'center':c.endsWith(':')?'right':c.startsWith(':')?'left':null));
 }
 let index=0;
 const visit=(node:JSONContent):JSONContent=>{
  if(node.type==='table'){
   const columns=tableAlignments[index++]??[];
   return {...node,content:node.content?.map(row=>({...row,content:row.content?.map((cell,i)=>({
    ...cell, attrs:{...cell.attrs,textAlign:columns[i]??null}
   }))}))};
  }
  return node.content?{...node,content:node.content.map(visit)}:node;
 };
 return visit(json);
}
