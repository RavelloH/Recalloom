import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {parseRmdVisual} from '../web/src/rmd-visual';
import {serializeRmdVisual} from '../web/src/rmd-serialize';
import type {JSONContent} from '@tiptap/core';
const walk=(node:JSONContent,type:string):JSONContent[]=>[
 ...(node.type===type?[node]:[]),...(node.content??[]).flatMap(x=>walk(x,type))
];
const semantic=(source:string)=>{
 const doc=parseRmdVisual(source);
 return {
  types:['heading','paragraph','richContainer','image','table','wikiEmbed','richBadge','richTooltip','inlineMath','blockMath']
   .map(type=>[type,walk(doc,type).length]),
  ids:walk(doc,'heading').map(n=>n.attrs?.id),
  images:walk(doc,'image').map(n=>[n.attrs?.figureId,n.attrs?.width,n.attrs?.caption]),
  tables:walk(doc,'table').map(n=>[n.attrs?.tableId,n.attrs?.caption]),
  containers:walk(doc,'richContainer').map(n=>[n.attrs?.kind,n.attrs?.title,n.attrs?.color]),
  badges:walk(doc,'richBadge').map(n=>n.attrs?.variant),
  marks:walk(doc,'text').flatMap(n=>(n.marks??[]).filter(m=>['rmdMark','highlight','visibleComment'].includes(m.type)).map(m=>[m.type,m.attrs?.color??null])),
 };
};
const check=(source:string)=>{
 const output=serializeRmdVisual(parseRmdVisual(source));
 const second=serializeRmdVisual(parseRmdVisual(output));
 assert.deepEqual(semantic(output),semantic(source),'RMD semantic drift after serialization\n'+output);
 assert.equal(second,output,'canonical serializer must be idempotent\n'+output+'\nSECOND\n'+second);
 return output;
};
describe('RMD visual parser and canonical serializer',()=>{
 it('roundtrips inline marks, notes, badge, tooltip, comments and math',()=>{
  const input='这是 :: mark 重要 ::，:: highlight 红色 | red ::，:: badge 完成 | success ::。';
  const output=check(input);
  assert.ok(output.includes(':: mark 重要 ::'));
  assert.ok(output.includes(':: highlight 红色 | color=red ::'));
  assert.ok(output.includes(':: badge 完成 | variant=success ::'));
 });
 it('roundtrips a nested callout with markdown bold',()=>{
  const input='::: info 注意\n\n这段包含 **加粗**。\n\n:::';
  const output=check(input);
  assert.match(output,/::: info 注意/);
  assert.ok(output.includes('**加粗**'));
 });
 it('roundtrips multiline and inline %% comments',()=>{
  const input='文中 %%注释%%。'+'\n\n%%\n多行正文。\n%%';
  const output=check(input);
  assert.ok(output.includes('%%注释%%'));
  assert.ok(output.includes('%%\n多行正文。\n%%'));
 });
 it('roundtrips heading, figure, table and equation block attributes',()=>{
  const input=[
   '## 标题 @ attrs heading-id @','','![装置](device.png) @ attrs fig-device | width=480 | caption=实验装置 @',
   '',
   '$$','P=UI','$$','@ attrs eq-power @','','| 名称 | 值 |','| --- | --- |','| A | 1 |',
   '@ attrs tbl-data | caption=实验数据 @'
  ].join('\n');
  const output=check(input);
  assert.ok(output.includes('## 标题 @ attrs heading-id @'));
  assert.ok(output.includes('@ attrs fig-device | width=480 | caption=实验装置 @'));
  assert.ok(output.includes('@ attrs eq-power @'));
  assert.ok(output.includes('@ attrs tbl-data | caption=实验数据 @'));
 });
 it('roundtrips Mark and Highlight blocks with math and text',()=>{
  const input=['::: mark','','$$','E=mc^2','$$','',':::','','::: highlight | color=yellow','','正文','', ':::'].join('\n');
  const output=check(input);
  assert.ok(output.includes('::: mark'));
  assert.ok(output.includes('::: highlight | color=yellow'));
 });
 it('roundtrips Wiki embed and link card as block-only components',()=>{
  const input='::: embed id:550e8400-e29b-41d4-a716-446655440000 :::\n\n::: link-card https://example.com | title=示例 :::';
  const output=check(input);
  assert.ok(output.includes('::: embed id:550e8400-e29b-41d4-a716-446655440000 :::'));
  assert.ok(output.includes('::: link-card https://example.com | title=示例 :::'));
 });
 it('preserves malformed custom syntax as plaintext instead of silently discarding it',()=>{
  const input=':: badge 失败 | unknown ::。';
  const output=check(input);
  assert.equal(output,input);
 });
});
