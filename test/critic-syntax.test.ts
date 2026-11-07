import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {parseCriticAt,findCriticMarkup,prepareCriticMarkdown} from '../web/src/critic-syntax';

const examples=[
 ['addition','{++新增内容++}','新增内容',''],
 ['deletion','{--待删除内容--}','待删除内容',''],
 ['substitution','{~~旧版本~>新版本~~}','新版本','旧版本'],
 ['comment','{>>请核对来源<<}','请核对来源',''],
 ['highlight','{==重点段落==}','重点段落','']
] as const;
describe('CriticMarkup syntax and safe read-only preprocessing',()=>{
 it('recognizes five standard forms as review proposals, not accepted edits',()=>{
  for(const [kind,source,text,before] of examples){
   const parsed=parseCriticAt(source);
   assert.equal(parsed?.kind,kind);
   assert.equal(parsed?.raw,source);
   assert.equal(parsed?.text,text);
   assert.equal(parsed?.before,before);
  }
 });
 it('keeps substitution old and new sides separate, including one-sided edits',()=>{
  assert.deepEqual(parseCriticAt('{~~旧~>~~}')?.before,'旧');
  assert.equal(parseCriticAt('{~~~>新~~}')?.text,'新');
  assert.equal(parseCriticAt('{~~~>~~}'),null);
 });
 it('allows adjacent highlight-plus-comment and preserves all text elsewhere',()=>{
  const source='结论 {==可能有误==}{>>需要引用<<}，并 {++补充说明++}。';
  const marks=findCriticMarkup(source);
  assert.equal(marks.length,3);
  assert.deepEqual(marks.map(x=>x.match.kind),['highlight','comment','addition']);
  const transformed=prepareCriticMarkdown(source);
  assert.equal((transformed.match(/<rk-critic /g)??[]).length,3);
  assert.ok(transformed.includes('结论 '));
  assert.ok(transformed.endsWith('。'));
 });
 it('never transforms code, existing Markdown links, escaped syntax or unsupported nested syntax',()=>{
  const backtick=String.fromCharCode(96);
  const source=[
   backtick+'{++行内代码++}'+backtick,
   '~~~markdown',
   '{--代码围栏--}',
   '~~~',
   '[{++链接文字++}](https://example.org)',
   '\\{++转义文字++}',
   '{++不能嵌套 {--另一个标记--}++}',
   '<span>{++HTML 内部++}</span>'
  ].join('\n\n');
  const replaced=prepareCriticMarkdown(source);
  assert.ok(replaced.includes('{--代码围栏--}'));
  assert.ok(replaced.includes(backtick+'{++行内代码++}'+backtick));
  assert.ok(replaced.includes('\\{++转义文字++}'));
  assert.ok(replaced.includes('{++不能嵌套 {--另一个标记--}++}'));
  assert.ok(!replaced.includes('data-value="%E4%BB%A3%E7%A0%81'));
 });
 it('encodes unsafe strings as data attributes and never emits user HTML as tags',()=>{
  const source='{>>review "quote" & <not-script><<}';
  const transformed=prepareCriticMarkdown(source);
  // Angle brackets in Critic annotation text are data, not rendered markup.
  assert.equal(transformed,source,'ambiguous inline HTML must be kept as source, not converted to a synthetic review component');
  const safe=prepareCriticMarkdown('{>>review "quote" & note<<}');
  assert.ok(safe.includes('data-kind="comment"'));
  assert.ok(safe.includes('%22quote%22'));
  assert.ok(safe.includes('%26'));
 });
});
