import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {JSONContent} from '@tiptap/core';
import {parseRmdVisual} from '../web/src/rmd-visual';
const walk=(n:JSONContent,type:string):JSONContent[]=>[
 ...(n.type===type?[n]:[]),...(n.content??[]).flatMap(c=>walk(c,type))
];
describe('Shared RMD AST to Tiptap adapter',()=>{
 it('parses standard formatting as structured nodes, not raw fallbacks',()=>{
  const doc=parseRmdVisual('# 标题\n\n文字 **粗体**、*斜体*。');
  assert.equal(walk(doc,'heading').length,1);
  assert.equal(walk(doc,'rawMarkdown').length,0,JSON.stringify(doc));
  assert.ok(walk(doc,'text').some(t=>t.marks?.some(m=>m.type==='bold')));
  assert.ok(walk(doc,'text').some(t=>t.marks?.some(m=>m.type==='italic')));
 });
 it('represents Mark and colored Highlight as separate Tiptap marks, including math atoms',()=>{
  const doc=parseRmdVisual('一个 :: mark $E=mc^2$ ::，一个 :: highlight 黄色文字 | yellow ::。');
  const math=walk(doc,'inlineMath');
  assert.equal(math.length,1,JSON.stringify(doc));
  assert.ok(math[0]?.marks?.some(m=>m.type==='rmdMark'),JSON.stringify(doc));
  assert.ok(walk(doc,'text').some(n=>n.marks?.some(m=>m.type==='highlight'&&m.attrs?.color==='yellow')));
 });
 it('converts valid inline components and leaves invalid ones as original prose',()=>{
  const src='这里有 :: badge 已完成 | success ::，以及 :: badge 无效 | unknown ::。';
  const doc=parseRmdVisual(src);
  assert.equal(walk(doc,'richBadge').length,1,JSON.stringify(doc));
  assert.ok(walk(doc,'text').some(t=>t.text?.includes(':: badge 无效 | unknown ::')),JSON.stringify(doc));
 });
 it('preserves inline and multiline comments as editable annotations',()=>{
  const doc=parseRmdVisual('保留 %%校对注释%%。\n\n%%\n多行备注\n仍在进行\n%%');
  assert.ok(walk(doc,'text').some(n=>n.marks?.some(m=>m.type==='visibleComment')),JSON.stringify(doc));
  assert.equal(walk(doc,'richContainer').filter(n=>n.attrs?.kind==='comment').length,1,JSON.stringify(doc));
 });
 it('builds full block Mark/Highlight with independent colors and centered math',()=>{
  const doc=parseRmdVisual(['::: mark','','$$','P=UI','$$','',':::','','::: highlight | yellow','','这里是重点。','',':::'].join('\n'));
  const blocks=walk(doc,'richContainer');
  assert.equal(blocks.length,2,JSON.stringify(doc));
  assert.equal(blocks[0]?.attrs?.kind,'mark');
  assert.equal(blocks[0]?.attrs?.color,null);
  assert.equal(blocks[1]?.attrs?.kind,'highlight');
  assert.equal(blocks[1]?.attrs?.color,'yellow');
  assert.equal(walk(blocks[0]!,'blockMath').length,1);
 });
 it('turns explicit heading/paragraph/image/table attrs into Tiptap node attributes',()=>{
  const src=['## 标题 @ attrs heading-id @','','结论。 @ attrs conclusion @','','![设备](device.png) @ attrs fig-device | width=480 | caption=示意图 @','','| 名称 | 值 |','| --- | --- |','| A | 1 |','@ attrs tbl-data | caption=实验数据 @'].join('\n');
  const doc=parseRmdVisual(src);
  assert.equal(walk(doc,'heading')[0]?.attrs?.id,'heading-id',JSON.stringify(doc));
  assert.equal(walk(doc,'paragraph').find(x=>x.attrs?.blockId==='conclusion')?.attrs?.blockId,'conclusion');
  assert.equal(walk(doc,'image')[0]?.attrs?.figureId,'fig-device');
  assert.equal(walk(doc,'image')[0]?.attrs?.width,480);
  assert.equal(walk(doc,'table')[0]?.attrs?.tableId,'tbl-data',JSON.stringify(doc));
  assert.equal(walk(doc,'table')[0]?.attrs?.caption,'实验数据');
 });
 it('builds nested tabs and valid children from semantic AST',()=>{
  const doc=parseRmdVisual([':::: tabs','','::: tab 概览','','**重点**。','',':::','','::::'].join('\n'));
  const blocks=walk(doc,'richContainer');
  assert.deepEqual(blocks.map(n=>n.attrs?.kind),['tabs','tab']);
  assert.ok(walk(doc,'text').some(n=>n.marks?.some(m=>m.type==='bold')));
 });
 it('handles table pipes inside valid RMD inline components before GFM splitting',()=>{
  const src=['| 项目 | 状态 |','| --- | --- |','| A | :: badge 已完成 | success :: |'].join('\n');
  const doc=parseRmdVisual(src);
  const row=walk(doc,'tableRow')[1];
  assert.equal(row?.content?.length,2,JSON.stringify(doc));
  assert.equal(walk(row!,'richBadge').length,1,JSON.stringify(doc));
 });
 it('recognizes Wiki embed and link-card as true block components',()=>{
  const src='::: embed id:550e8400-e29b-41d4-a716-446655440000 :::\n\n::: link-card https://example.com | title=示例 :::';
  const doc=parseRmdVisual(src);
  assert.equal(walk(doc,'wikiEmbed').length,1,JSON.stringify(doc));
  assert.equal(walk(doc,'richLinkCard').length,1,JSON.stringify(doc));
 });
});
