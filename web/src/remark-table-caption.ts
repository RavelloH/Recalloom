import {parseTableCaption} from './table-caption';
type MdNode={type:string;value?:string;children?:MdNode[]};
type MdRoot={children?:MdNode[]};

/**
 * Convert a plain caption *following* a GFM table to a narrowly scoped safe
 * presentation node. GFM table data stays in its ordinary editable AST.
 * No stored HTML, no extra D1 table, no arbitrary element attributes.
 */
export function remarkTableCaptions(){
 return (root:MdRoot)=>{
  const walk=(node:MdRoot)=>{
   const children=node.children;
   if(!children)return;
   for(let i=0;i<children.length-1;i++){
    const table=children[i],next=children[i+1];
    if(table?.type==='table'&&next?.type==='paragraph'&&next.children?.length===1&&next.children[0]?.type==='text'){
     const attrs=parseTableCaption(String(next.children[0].value??''));
     if(attrs){
      const id=encodeURIComponent(attrs.id),caption=encodeURIComponent(attrs.caption);
      children[i+1]={type:'html',value:'<rk-table-caption data-id="'+id+'" data-caption="'+caption+'"></rk-table-caption>'};
      i++;continue;
     }
    }
   }
   for(const child of children)if(child.children)walk(child);
  };
  walk(root);
 };
}
