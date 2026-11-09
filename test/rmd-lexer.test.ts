import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {lexRmd,parseRmdArguments,splitRmdArguments} from '../web/src/rmd-lexer';
import {getRmdSchema} from '../web/src/rmd-schema';

describe('RMD 1.0 shared lexer and schema',()=>{
 it('parses inline components using schema-driven positional and named arguments',()=>{
  const nodes=lexRmd('状态 :: badge 已完成 | success ::，解释 :: tooltip DO | description=Durable Objects ::。');
  assert.deepEqual(nodes.map(x=>x.name),['badge','tooltip']);
  assert.deepEqual(nodes[0]?.attributes,{variant:'success'});
  assert.deepEqual(nodes[1]?.attributes,{description:'Durable Objects'});
  assert.equal(nodes[0]?.main,'已完成');
 });
 it('keeps Mark and explicitly colored Highlight as independent token types',()=>{
  const nodes=lexRmd(':: mark $E=mc^2$ :: 与 :: highlight 重点 | yellow ::');
  assert.deepEqual(nodes.map(x=>x.name),['mark','highlight']);
  assert.equal(nodes[0]?.main,'$E=mc^2$');
  assert.equal(nodes[1]?.attributes.color,'yellow');
  assert.equal(lexRmd(':: highlight 没有颜色 ::')[0]?.name,'highlight');
  assert.deepEqual(lexRmd(':: mark 内容 | yellow ::'),[]);
 });
 it('rejects missing main value, duplicate values and invalid enum without swallowing source',()=>{
  for(const fragment of [
   ':: badge | value=已完成 | variant=success ::',
   ':: badge 已完成 | unknown ::',
   ':: badge 已完成 | success | variant=warning ::',
   ':: badge 已完成 | variant=success | green ::',
   ':: badge 已完成 | variant=success | color=red ::'
  ])assert.deepEqual(lexRmd(fragment),[],fragment);
 });
 it('accepts spaces and equals in unquoted values; quotes protect pipes',()=>{
  const src=':: tooltip 这里 | description="A | B 与 x=y" ::';
  assert.equal(lexRmd(src)[0]?.attributes.description,'A | B 与 x=y');
  assert.equal(lexRmd(':: tooltip 这里 | description=结果为 x=y ::')[0]?.attributes.description,'结果为 x=y');
  assert.deepEqual(splitRmdArguments('主内容 | "A | B" | c=d'),['主内容','"A | B"','c=d']);
 });
 it('parses block leaf and multiline containers with strict fence nesting',()=>{
  const md=[':::: tabs','','::: tab 概览','','内容','',':::','','::::','','::: embed id:550e8400-e29b-41d4-a716-446655440000 :::'].join('\n');
  const result=lexRmd(md);
  assert.deepEqual(result.map(x=>x.name),['tabs','embed']);
  assert.equal(result[0]?.children?.[0]?.name,'tab');
  assert.ok(result[0]?.raw.includes('内容'));
  assert.equal(result[1]?.type,'leaf');
 });
 it('rejects invalid nested container parents and unclosed block syntax',()=>{
  assert.deepEqual(lexRmd('::: tab 孤立\n\n内容\n\n:::'),[]);
  assert.deepEqual(lexRmd('::: warning 未闭合\n内容'),[]);
  assert.deepEqual(lexRmd(':::: flashcard\n\n::: front\n\n问题\n\n:::\n\n::::'),[]);
 });
 it('attributes attach only to complete adjacent Markdown blocks; ID may be omitted',()=>{
  const src=[
   '## 标题 @ attrs heading-id @',
   '',
   '![实验图](device.png) @ attrs | width=480 | caption=实验装置 @',
   '',
   '$$','E=mc^2','$$','@ attrs eq-energy @',
   '',
   '普通正文。 @ attrs | id=paragraph-id @'
  ].join('\n');
  const attrs=lexRmd(src).filter(x=>x.type==='attrs');
  assert.deepEqual(attrs.map(x=>x.name),['heading','image','math','paragraph']);
  assert.equal(attrs[1]?.attributes.width,'480');
  assert.equal(attrs[1]?.attributes.id,undefined);
  assert.equal(attrs[2]?.attributes.id,'eq-energy');
  assert.equal(attrs[3]?.attributes.id,'paragraph-id');
 });
 it('does not let an invalid quoted modifier suppress later valid modifiers',()=>{
  const src=[
   '## 无效标题 @ attrs | caption="没有结束 @',
   '',
   '## 有效标题 @ attrs second-heading @',
   '',
   '$$','P=UI','$$','@ attrs eq-power @'
  ].join('\n');
  const attrs=lexRmd(src).filter(n=>n.type==='attrs');
  assert.deepEqual(attrs.map(n=>n.attributes.id),['second-heading','eq-power']);
 });
 it('does not claim unsupported list IDs as valid modifiers',()=>{
  const src='- First\n- Second\n@ attrs list-foo @';
  assert.equal(lexRmd(src).filter(n=>n.type==='attrs').length,0);
 });
 it('does not reinterpret invalid attrs, code, inline code or link targets',()=>{
  const bad=['## 标题 @ attrs | width=480 @','![图](a.png) @ attrs 123 @','图片'];
  assert.deepEqual(lexRmd(bad.join('\n\n')).filter(x=>x.type==='attrs'),[]);
  const src=['~~~md',':: badge 完成 | success ::','~~~','',String.fromCharCode(96)+':: badge 代码 | success ::'+String.fromCharCode(96),'','[链接](https://x.com/::%20badge%20foo)'].join('\n');
  assert.deepEqual(lexRmd(src).filter(x=>x.type==='inline'),[]);
 });
 it('lexes closed multiline and inline comments without treating code syntax as comments',()=>{
  const src=['前文 %%注释%%','','%%','多行','注释','%%','','~~~markdown','%%代码%%','~~~'].join('\n');
  assert.deepEqual(lexRmd(src).filter(x=>x.type==='comment').map(x=>x.name),['comment','comment']);
 });
 it('leaves invalid and unknown symbols untouched for lossless fallback',()=>{
  const src='今天 10:30，网址 http://localhost:8787；:: unknown xxx ::';
  assert.deepEqual(lexRmd(src),[]);
  assert.equal(parseRmdArguments('内容 | red',getRmdSchema('inline','highlight')!)?.attributes.color,'red');
 });
});
