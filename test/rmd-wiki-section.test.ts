import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {extractWikiSection} from '../web/src/wiki-section';
import {extractWikiReferences} from '../src/wiki-syntax';
const id='550e8400-e29b-41d4-a716-446655440000';
describe('RMD 1.0 readonly Wiki graph and section resolution',()=>{
 it('recognizes only the standalone canonical ::: embed target ::: as a graph edge',()=>{
  const src=[
   '一个普通 [[id:'+id+']] 引用。',
   '',
   '::: embed id:'+id+'#stable-heading :::',
   '',
   '这里是正文 ::: embed id:'+id+' :::，不是块级嵌入。',
   '',
   '{{embed:id:'+id+'}}',
   '',
   '~~~markdown',
   '::: embed id:'+id+' :::',
   '~~~',
   '',
   '::: embed 无效目标 :::'
  ].join('\n');
  const refs=extractWikiReferences(src);
  assert.deepEqual(refs.map(x=>x.kind),['link','embed'],JSON.stringify(refs));
  assert.equal(refs[1]?.anchor,'stable-heading');
  assert.ok(refs.every(r=>src.slice(r.offset,r.offset+r.raw.length)===r.raw));
 });
 it('selects a heading section by canonical RMD ID and stops at sibling heading',()=>{
  const source=['## 标题一 @ attrs stable-heading @',
   '',
   '第一节内容。',
   '',
   '### 子标题',
   '',
   '子节内容。',
   '',
   '## 第二节',
   '',
   '不得包含此正文。'
  ].join('\n');
  const result=extractWikiSection(source,'stable-heading');
  assert.ok(result.startsWith('## 标题一 @ attrs stable-heading @'));
  assert.ok(result.includes('子节内容。'));
  assert.ok(!result.includes('不得包含此正文。'));
  assert.equal(extractWikiSection(source,'标题一'),result);
 });
 it('finds ID on a separate @ attrs line after a heading',()=>{
  const source='## 章节\n@ attrs stable-section @\n\n正文。\n\n## 下一节\n\n其他内容。';
  const result=extractWikiSection(source,'stable-section');
  assert.ok(result.includes('正文。'),result);
  assert.ok(!result.includes('其他内容。'),result);
 });
 it('selects one paragraph by RMD block ID without the old ^id suffix',()=>{
  const source=['## 开头','','前一段。','','这是段落的第一行。','仍然属于同一段。 @ attrs important-block @','','后续段落。'].join('\n');
  const selected=extractWikiSection(source,'^important-block');
  assert.equal(selected,'这是段落的第一行。\n仍然属于同一段。 @ attrs important-block @');
  assert.equal(extractWikiSection(source,'^missing'),'');
 });
 it('does not treat fenced Markdown heading examples as real anchors',()=>{
  const source='~~~markdown\n## 伪标题\n~~~\n\n## 真实标题 @ attrs real-heading @\n\n有效内容。';
  assert.equal(extractWikiSection(source,'伪标题'),'');
  assert.ok(extractWikiSection(source,'real-heading').includes('有效内容。'));
 });
});
