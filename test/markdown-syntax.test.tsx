import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {RawMarkdown,RawInline} from '../web/src/tiptap/raw-markdown';
import {RichContainer,RichTooltip,RichKbd,RichBadge} from '../web/src/tiptap/rich-directives';
import {HighlightWithMarkdown} from '../web/src/tiptap/colored-highlight';
import {VisibleComment} from '../web/src/tiptap/comment-mark';
import {normalizeKnownMarkdown} from '../web/src/markdown-normalize';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {parseCriticAt} from '../web/src/critic-syntax';
import {extractWikiReferences} from '../src/wiki-syntax.js';
import type {JSONContent} from '@tiptap/core';

const manager=new MarkdownManager({extensions:[
 StarterKit.configure({heading:false,paragraph:false,underline:false}),
 CustomHeading,CustomParagraph,Markdown,RawMarkdown,RawInline,
 RichContainer,RichTooltip,RichKbd,RichBadge,HighlightWithMarkdown,VisibleComment
]});
const walk=(node:JSONContent,type:string):JSONContent[]=>[
 ...(node.type===type?[node]:[]),...(node.content??[]).flatMap(child=>walk(child,type))
];
describe('Rich Markdown finalized syntax and parser boundaries',()=>{
 it('does not reinterpret equality comparisons or ==x== as highlighters',()=>{
  const source='a == b 且 c == d，==x==，<mark>重点</mark>。';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(walk(doc,'paragraph').length,1);
  assert.equal(walk(doc,'text').filter(x=>x.marks?.some(m=>m.type==='highlight')).length,1);
  assert.ok(manager.serialize(doc).includes('a == b 且 c == d'));
  assert.ok(manager.serialize(doc).includes('==x=='));
 });
 it('uses single-line comments consistently, retaining multiline source as ordinary content',()=>{
  const source='可见 %%单行注释%% 继续。\n\n%%第一行\n第二行%%';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(walk(doc,'text').filter(node=>node.marks?.some(m=>m.type==='visibleComment')).length,1);
  assert.ok(manager.serialize(doc).includes('%%单行注释%%'));
  assert.ok(manager.serialize(doc).includes('%%第一行'));
 });
 it('converts familiar GitHub blockquote alerts into editable callouts',()=>{
  const md='> [!WARNING]\n> **请注意**这里。\n>\n> - 备份';
  assert.ok(normalizeKnownMarkdown(md).startsWith(':::warning'));
  const doc=buildVisualMarkdown(md,manager);
  assert.equal(walk(doc,'richContainer')[0]?.attrs?.kind,'warning',JSON.stringify(doc));
  assert.match(manager.serialize(doc),/:::warning/);
  assert.ok(walk(doc,'text').some(n=>n.marks?.some(m=>m.type==='bold')));
  assert.equal(normalizeKnownMarkdown('~~~markdown\n> [!WARNING]\n~~~'),'~~~markdown\n> [!WARNING]\n~~~');
 });
 it('recognizes ordinary HTML details and inline kbd, but never normalizes fenced code',()=>{
  const source='<details>\n<summary>设置 [v2]</summary>\n\n可以 **继续编辑**。\n</details>\n\n按 <kbd>Ctrl</kbd> + <kbd>S</kbd>。';
  const visual=buildVisualMarkdown(source,manager);
  const details=walk(visual,'richContainer');
  assert.equal(details.length,1,JSON.stringify(visual));
  assert.equal(details[0]?.attrs?.kind,'details');
  assert.equal(details[0]?.attrs?.title,'设置 [v2]');
  assert.equal(walk(visual,'richKbd').length,2);
  const saved=manager.serialize(visual);
  assert.ok(saved.includes('设置 \\[v2\\]'),saved);
  assert.ok(saved.includes(':kbd[Ctrl] + :kbd[S]'));
  const fenced='~~~html\n<details><summary>secret</summary>x</details>\n<kbd>X</kbd>\n~~~';
  assert.equal(normalizeKnownMarkdown(fenced),fenced);
 });
 it('supports <br/> as a known harmless line break',()=>{
  const doc=buildVisualMarkdown('第一行<br/>第二行',manager);
  assert.equal(walk(doc,'rawMarkdown').length,0,JSON.stringify(doc));
  assert.ok(walk(doc,'paragraph').length>=1);
 });
 it('preserves unknown inline syntax while keeping adjacent strong formatting rich',()=>{
  const source='Before **bold** <unknown-tag value="1"/> after :smile[unknown] and **last**.';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(walk(doc,'rawMarkdown').length,0,JSON.stringify(doc));
  assert.ok(walk(doc,'rawInline').length>=2,JSON.stringify(doc));
  assert.ok(walk(doc,'text').some(n=>n.marks?.some(m=>m.type==='bold')));
  const saved=manager.serialize(doc);
  assert.ok(saved.includes('<unknown-tag value="1"/>'),saved);
  assert.ok(saved.includes(':smile[unknown]'),saved);
 });
 it('does not promote invalid orphan nested containers into rich components',()=>{
  for(const type of ['tab','front','back','message','definition']){
   const source=':::'+type+'[独立]\n\n示例\n\n:::';
   const doc=buildVisualMarkdown(source,manager);
   assert.equal(walk(doc,'richContainer').length,0,type+JSON.stringify(doc));
   assert.ok(manager.serialize(doc).includes(':::'+type),type);
  }
  assert.equal(walk(buildVisualMarkdown(':::question[问题]\n\n内容\n\n:::',manager),'richContainer').length,1);
 });
 it('accepts only the finalized :tooltip inline directive, not the removed :tip alias',()=>{
  const source='无效 :tip[不再支持]{content="不识别"}。\n\n有效 :tooltip[提示]{content="备注"}。';
  const doc=buildVisualMarkdown(source,manager);
  assert.equal(walk(doc,'richTooltip').length,1,JSON.stringify(doc));
  const result=manager.serialize(doc);
  assert.ok(result.includes(':tooltip[提示]{content="备注"}'),result);
  assert.ok(result.includes(':tip[不再支持]'),result);
 });
 it('permits balanced braces in CriticMarkup but forbids nested review syntax',()=>{
  assert.equal(parseCriticAt('{++{"a": {"b": 2}}++}')?.text,'{"a": {"b": 2}}');
  assert.equal(parseCriticAt('{~~{"a": 1}~>{"a": 2}~~}')?.before,'{"a": 1}');
  assert.equal(parseCriticAt('{>>检查 {{variable}} 的值<<}')?.kind,'comment');
  assert.equal(parseCriticAt('{++a {--b--}++}'),null);
  assert.equal(parseCriticAt('{++{"a": 1++}'),null);
 });
 it('accepts escaped Wiki alias separators inside a GFM table',()=>{
  const uuid='550e8400-e29b-41d4-a716-446655440000';
  const md='| 位置 | 引用 |\n| --- | --- |\n| A | [[id:'+uuid+'\\|别名]] |';
  const refs=extractWikiReferences(md);
  assert.equal(refs.length,1,JSON.stringify(refs));
  assert.equal(refs[0]?.alias,'别名');
  assert.equal(refs[0]?.target,'id:'+uuid);
 });
});
