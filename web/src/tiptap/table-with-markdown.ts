import {Table} from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import {safeTableId} from '../table-caption';

/** Native ProseMirror GFM table model and content editing. The shared RMD
 * serializer owns the only table Markdown output and @ attrs caption syntax.
 */
export const TableWithMarkdown=Table.extend({
 addAttributes(){
  return {...this.parent?.(),
   tableId:{
    default:null,
    parseHTML:(el:HTMLElement)=>el.getAttribute('data-rk-table-id')||null,
    renderHTML:(attrs:Record<string,unknown>)=>safeTableId(attrs.tableId)
     ?{'data-rk-table-id':attrs.tableId}:{}
   },
   caption:{
    default:'',
    parseHTML:(el:HTMLElement)=>el.getAttribute('data-rk-table-caption')||'',
    renderHTML:()=>({})
   }
  };
 }
});
const cellAlignment={
 default:null,
 parseHTML:(element:HTMLElement)=>element.style.textAlign||null,
 renderHTML:(attributes:{textAlign?:string|null})=>attributes.textAlign
  ?{style:'text-align: '+attributes.textAlign}:{}
};
/** Alignment must remain attached to cells, not to the generated text. */
export const TableCellWithMarkdown=TableCell.extend({
 addAttributes(){return {...this.parent?.(),textAlign:cellAlignment};}
});
export const TableHeaderWithMarkdown=TableHeader.extend({
 addAttributes(){return {...this.parent?.(),textAlign:cellAlignment};}
});
export const TableRowWithMarkdown=TableRow;
