import {Button} from '@astryxdesign/core/Button';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {Table,TableHeader,TableBody,TableRow,TableHeaderCell,TableCell} from '@astryxdesign/core/Table';
import {Icon} from '../icon';
import type {ArchivedRecord} from '../queries';
import {documentDisplayName} from '../document-filename';
import {fmt} from '../pages/shared';
import {originalFolder} from './panels';

export function ArchiveList({items,selected,onSelect,onPreview,onRestore,onRestoreTo,onDelete,busy}:{
 items:ArchivedRecord[];selected:Set<string>;onSelect:(ids:string[],selected:boolean)=>void;onPreview:(item:ArchivedRecord)=>void;
 onRestore:(item:ArchivedRecord)=>void;onRestoreTo:(item:ArchivedRecord)=>void;onDelete:(item:ArchivedRecord)=>void;busy:boolean;
}){
 const count=items.filter(item=>selected.has(item.id)).length;
 return <Table className="archive-table" aria-label="归档内容" dividers="rows" density="compact" verticalAlign="middle" textOverflow="wrap" hasHover>
  <TableHeader><TableRow isHeaderRow>
   <TableHeaderCell scope="col"><div className="archive-select-all"><CheckboxInput label="选择本组已加载内容" isLabelHidden value={count===items.length?true:count?'indeterminate':false} isDisabled={busy} onChange={value=>onSelect(items.map(item=>item.id),value)}/><span className="archive-mobile-select-label muted small">选择已加载内容</span></div></TableHeaderCell>
   {['名称','原位置','归档时间','类型','操作'].map(label=><TableHeaderCell scope="col" key={label}>{label}</TableHeaderCell>)}
  </TableRow></TableHeader>
  <TableBody>{items.map(item=><TableRow key={item.id} className="archive-item">
   <TableCell><CheckboxInput label={'选择 '+item.name} isLabelHidden value={selected.has(item.id)} isDisabled={busy} onChange={value=>onSelect([item.id],value)}/></TableCell>
   <TableCell><Button className="archive-name" variant="ghost" label={item.kind==='document'?documentDisplayName(item.name):item.name} icon={<Icon name={item.kind==='document'?'document':'taskList'} size="sm"/>} onClick={()=>onPreview(item)}/><span className="archive-mobile-meta muted small"><span className="archive-mobile-path" title={item.archivedFromPath??undefined}>{originalFolder(item)}</span><time dateTime={item.archivedAt??undefined}>{fmt(item.archivedAt??undefined)}</time></span></TableCell>
   <TableCell><span className="archive-path muted small" title={item.archivedFromPath??undefined}>{originalFolder(item)}</span></TableCell>
   <TableCell><time className="muted small" dateTime={item.archivedAt??undefined}>{fmt(item.archivedAt??undefined)}</time></TableCell>
   <TableCell><span className="muted small">{item.kind==='document'?'文稿':'任务列表'}</span></TableCell>
   <TableCell><div className="archive-row-actions"><Button label="恢复" variant="ghost" size="sm" isDisabled={busy} onClick={()=>onRestore(item)}/><MoreMenu label={'更多操作：'+item.name} size="sm" isDisabled={busy} alignment="end" presentation="adaptive" items={[
    {label:'预览',icon:<Icon name="eye" size="sm"/>,onClick:()=>onPreview(item)},
    {label:'恢复到…',icon:<Icon name="restore" size="sm"/>,onClick:()=>onRestoreTo(item)},
    {type:'divider'},
    {label:'永久删除',variant:'destructive',icon:<Icon name="trash" size="sm"/>,onClick:()=>onDelete(item)}
   ]}/></div></TableCell>
  </TableRow>)}</TableBody>
 </Table>;
}
