import {getMarkRange} from '@tiptap/core';
import {TableMap} from '@tiptap/pm/tables';
import type {Editor} from '@tiptap/core';

export const validLink=(value:string)=>{
 const url=value.trim();
 if(!url||/\s/.test(url))return false;
 if(/^(https?:\/\/)/i.test(url)){try{const parsed=new URL(url);return /^https?:$/.test(parsed.protocol)&&!!parsed.hostname;}catch{return false;}}
 if(/^mailto:[^\s@]+@[^\s@]+$/i.test(url))return true;
 if(/^tel:\+?[\d()\-]+$/i.test(url))return true;
 return /^\/(?!\/)[^\s]*$/.test(url)||/^#[^\s]+$/.test(url);
};
export const validImage=(value:string)=>{
 const url=value.trim();
 if(!url||/\s/.test(url))return false;
 if(/^https?:\/\//i.test(url)){try{const parsed=new URL(url);return /^https?:$/.test(parsed.protocol)&&!!parsed.hostname;}catch{return false;}}
 return /^\/(?!\/)[^\s]+$/.test(url);
};
export function selectedLink(editor:Editor){
 const {from,to,$from}=editor.state.selection;
 const markType=editor.schema.marks.link;
 const range=markType?getMarkRange($from,markType):undefined;
 const href=editor.getAttributes('link').href as string|undefined;
 const start=range?.from??from,end=range?.to??to;
 return {from:start,to:end,text:editor.state.doc.textBetween(start,end),href:href||''};
}
/** Adapted from NeutralPress's column-wide table formatting; handles merged cells. */
export function alignTableColumn(editor:Editor,alignment:'left'|'center'|'right',selectedColumn?:number){
 const {$from}=editor.state.selection;
 let tableDepth=-1,cellDepth=-1;
 for(let depth=$from.depth;depth>0;depth--){
  const name=$from.node(depth).type.name;
  if(cellDepth<0&&(name==='tableCell'||name==='tableHeader'))cellDepth=depth;
  if(name==='table'){tableDepth=depth;break;}
 }
 if(tableDepth<0||cellDepth<0||editor.state.selection.constructor.name==='CellSelection')return false;
 const table=$from.node(tableDepth),map=TableMap.get(table),start=$from.start(tableDepth);
 const cellOffset=$from.before(cellDepth)-start;
 let column=selectedColumn!==undefined&&selectedColumn>=0&&selectedColumn<map.width?selectedColumn:map.findCell(cellOffset).left;
 const anchor=window.getSelection()?.anchorNode;
 const element=anchor instanceof Element?anchor:anchor?.parentElement;
 const focusedCell=element?.closest('td,th') as HTMLTableCellElement|null;
 if(selectedColumn===undefined&&focusedCell&&editor.view.dom.contains(focusedCell)){
  const row=focusedCell.parentElement as HTMLTableRowElement;
  if(row?.cells)column=Array.from(row.cells).slice(0,focusedCell.cellIndex).reduce((n,cell)=>n+Math.max(1,cell.colSpan),0);
 }
 const tr=editor.state.tr;const updated=new Set<number>();
 for(let row=0;row<map.height;row++){
  const offset=map.map[row*map.width+column];
  if(offset===undefined||updated.has(offset))continue;
  updated.add(offset);
  const pos=start+offset,node=tr.doc.nodeAt(pos);
  if(node&&(node.type.name==='tableCell'||node.type.name==='tableHeader')){
   tr.setNodeMarkup(pos,undefined,{...node.attrs,textAlign:alignment});
  }
 }
 if(!tr.docChanged)return false;
 editor.view.dispatch(tr);
 return true;
}
