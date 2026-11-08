import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {JSONContent} from '@tiptap/core';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
const nodes=(root:JSONContent,name:string):JSONContent[]=>[
 ...(root.type===name?[root]:[]),...(root.content??[]).flatMap(node=>nodes(node,name))
];
describe('RMD Wiki / Critic / GFM and editor lossless semantics',()=>{
 it('keeps a valid UUID WikiLink and alias without treating it as text',()=>{
  const source='参见 [[id:550e8400-e29b-41d4-a716-446655440000|文档链接]]。';
  const doc=parseRmdVisual(source);
  const link=nodes(doc,'wikiLink')[0];
  assert.equal(link?.attrs?.target,'id:550e8400-e29b-41d4-a716-446655440000',JSON.stringify(doc));
  assert.equal(link?.attrs?.alias,'文档链接');
  assert.equal(serializeRmdVisual(doc),source);
 });
 it('keeps a Wiki alias pipe inside a GFM cell, with no manual backslash',()=>{
  const source='| 项目 | 引用 |\n| --- | --- |\n| A | [[id:550e8400-e29b-41d4-a716-446655440000|别名]] |';
  const doc=parseRmdVisual(source);
  const table=nodes(doc,'table')[0]!;
  assert.equal(table.content?.[1]?.content?.length,2,JSON.stringify(doc));
  const link=nodes(table,'wikiLink')[0];
  assert.equal(link?.attrs?.alias,'别名',JSON.stringify(doc));
  const saved=serializeRmdVisual(doc);
  assert.ok(saved.includes('别名'),saved);
  assert.equal(nodes(parseRmdVisual(saved),'wikiLink').length,1);
 });
 it('supports one bounded local cross-reference without requiring URL',()=>{
  const source='公式见 [[#eq-power]]。';
  const doc=parseRmdVisual(source);
  assert.equal(nodes(doc,'crossReference')[0]?.attrs?.id,'eq-power',JSON.stringify(doc));
  assert.equal(serializeRmdVisual(doc),source);
 });
 it('does not apply pending CriticMarkup during visual parsing and round-trip',()=>{
  const source='增加 {++新文字++}，删掉 {--旧文字--}，替换 {~~旧词~>新词~~}，强调 {==重点==}，批注 {>>需要核实<<}。';
  const doc=parseRmdVisual(source);
  const items=nodes(doc,'richCritic');
  assert.equal(items.length,5,JSON.stringify(doc));
  assert.deepEqual(items.map(x=>x.attrs?.kind),['addition','deletion','substitution','highlight','comment']);
  assert.equal(items[2]?.attrs?.before,'旧词');
  const serialized=serializeRmdVisual(doc);
  for(const fragment of ['{++新文字++}','{--旧文字--}','{~~旧词~>新词~~}','{==重点==}','{>>需要核实<<}'])
   assert.ok(serialized.includes(fragment),serialized);
 });
 it('supports GFM footnotes without dropping body or ref',()=>{
  const source='请参考脚注[^a]。\n\n[^a]: 这是 **原始来源**。';
  const doc=parseRmdVisual(source);
  assert.equal(nodes(doc,'richFootnoteRef').length,1,JSON.stringify(doc));
  assert.equal(nodes(doc,'richFootnoteDefinition').length,1,JSON.stringify(doc));
  const saved=serializeRmdVisual(doc);
  assert.ok(saved.includes('[^a]: 这是 **原始来源**。'),saved);
 });
 it('does not reinterpret wiki-like or Critic markers inside code',()=>{
  const tick=String.fromCharCode(96);
  const source='代码 '+tick+'[[#eq-x]] {++不通过++}'+tick+'。';
  const doc=parseRmdVisual(source);
  assert.equal(nodes(doc,'wikiLink').length,0);
  assert.equal(nodes(doc,'richCritic').length,0);
  assert.equal(serializeRmdVisual(doc),source);
 });
});
