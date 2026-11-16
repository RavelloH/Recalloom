import type {ReactNode} from 'react';
import {Table,TableBody,TableRow,TableHeaderCell,TableCell} from '@astryxdesign/core/Table';
import {AutoResizer,AutoTransition} from './motion-primitives';

/** Shared label/value presentation for indexing and storage details. */
export function SettingsPropertyTable({label,rows}:{label:string;rows:Array<{label:string;value:ReactNode;transitionKey:string}>}){
 return <Table aria-label={label} className="settings-property-table" dividers="rows" density="balanced" verticalAlign="top" textOverflow="wrap">
  <TableBody>{rows.map(row=><TableRow key={row.label}>
   <TableHeaderCell scope="row">{row.label}</TableHeaderCell>
   <TableCell><AutoResizer><AutoTransition transitionKey={row.transitionKey}>{row.value}</AutoTransition></AutoResizer></TableCell>
  </TableRow>)}</TableBody>
 </Table>;
}
