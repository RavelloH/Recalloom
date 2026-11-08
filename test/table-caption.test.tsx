import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {TableWithMarkdown,TableRowWithMarkdown,TableCellWithMarkdown,TableHeaderWithMarkdown} from '../web/src/tiptap/table-with-markdown';
import {RawMarkdown} from '../web/src/tiptap/raw-markdown';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {safeTableId,parseTableCaption,serializeTableCaption} from '../web/src/table-caption';
import type {JSONContent} from '@tiptap/core';
const manager=new MarkdownManager({extensions:[
 StarterKit,Markdown,TableWithMarkdown,TableRowWithMarkdown,TableCellWithMarkdown,TableHeaderWithMarkdown,RawMarkdown
]});
const tables=(doc:JSONContent):JSONContent[]=>(doc.content??[]).filter(node=>node.type==='table');
const base='| 参数 | 数值 |\n| :--- | ---: |\n| 电压 | 220 V |';
describe('Markdown-only GFM table captions',()=>{
 it('validates bounded captions and stable tbl- IDs',()=>{
  assert.deepEqual(parseTableCaption(': 系统参数 {#tbl-params}'),{caption:'系统参数',id:'tbl-params'});
  assert.ok(safeTableId('tbl-a'));
  for(const text of [': {#tbl-a}',': Hi {#fig-a}',': Hi {#tbl-}',': Hi {#tbl-123}',': Hi {#tbl-x}\nNext',': Hi {#tbl-x} and more']){
   assert.equal(parseTableCaption(text),null,text);
  }
  assert.equal(serializeTableCaption({caption:'系统参数',tableId:'tbl-params'}),': 系统参数 {#tbl-params}');
  assert.equal(serializeTableCaption({caption:'系统参数',tableId:'fig-invalid'}),'');
 });
 it('maps a caption immediately after GFM table into one editable table node',()=>{
  const source=base+'\n\n: 系统参数 {#tbl-params}\n\n下面是计算说明。';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(tables(doc).length,1,JSON.stringify(doc));
  assert.equal(tables(doc)[0]?.attrs?.tableId,'tbl-params');
  assert.equal(tables(doc)[0]?.attrs?.caption,'系统参数');
  assert.equal(doc.content?.filter(x=>x.type==='paragraph').length,1,JSON.stringify(doc));
  const out=manager.serialize(doc);
  assert.ok(out.includes(': 系统参数 {#tbl-params}'),out);
  assert.ok(out.includes('下面是计算说明'),out);
  assert.equal(tables(buildVisualMarkdown(out,manager))[0]?.attrs?.tableId,'tbl-params');
 });
 it('preserves plain tables without captions and prose resembling invalid captions',()=>{
  const bare=buildVisualMarkdown(base,manager);
  assert.equal(tables(bare).length,1);
  assert.ok(!tables(bare)[0]?.attrs?.tableId);
  const invalid=buildVisualMarkdown(base+'\n\n: 普通文本不含 ID\n\n后续正文',manager);
  assert.equal(tables(invalid).length,1);
  assert.equal(invalid.content?.[1]?.type,'paragraph',JSON.stringify(invalid));
  assert.ok(manager.serialize(invalid).includes(': 普通文本不含 ID'));
 });
 it('does not promote an apparent caption in code or after another block',()=>{
  const code='~~~markdown\n'+base+'\n\n: 伪标题 {#tbl-fake}\n~~~';
  assert.ok(!tables(buildVisualMarkdown(code,manager)).length);
  const other=buildVisualMarkdown('先有段落。\n\n: 错误位置 {#tbl-fake}',manager);
  assert.ok(!tables(other).length);
 });
});
