import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {findRmdComments,projectRmdComments} from '../web/src/rmd-comment';
import {projectConfirmedCriticMarkup,projectRmdPreview} from '../web/src/rmd-preview';

describe('RMD unified read-only projection',()=>{
 it('recognizes closed inline and standalone block comments using the same lexer',()=>{
  const source=['第一段 %%内部说明%% 结尾。','','%%','第一行','第二行','%%','','最后一段'].join('\n');
  const comments=findRmdComments(source);
  assert.deepEqual(comments.map(c=>c.kind),['inline','block']);
  assert.equal(comments[0]?.body,'内部说明');
  assert.ok(comments[1]?.body.includes('第一行\n第二行'));
  const rendered=projectRmdComments(source);
  assert.equal(rendered.includes('内部说明'),false);
  assert.equal(rendered.includes('第一行'),false);
  assert.equal(rendered.includes('第二行'),false);
  assert.ok(rendered.includes('第一段  结尾。'));
  assert.ok(rendered.includes('最后一段'));
 });
 it('never hides malformed, escaped or code-fenced comment syntax',()=>{
  const source=['%%未闭合','','\\%%转义%%','','~~~markdown','%%只在代码中%%','%%','代码块','%%','~~~','','公式 $%%test%%$'].join('\n');
  assert.deepEqual(findRmdComments(source),[]);
  assert.equal(projectRmdComments(source),source);
 });
 it('does not hide comments inside inline code or URL targets',()=>{
  const tick=String.fromCharCode(96);
  const src='代码 '+tick+'%%literal%%'+tick+' 和 [链接](https://example.com/%%path%%) 以及 %%有效%%。';
  assert.deepEqual(findRmdComments(src).map(c=>c.body),['有效']);
  const rendered=projectRmdComments(src);
  assert.ok(rendered.includes(tick+'%%literal%%'+tick));
  assert.ok(rendered.includes('/%%path%%'));
  assert.ok(!rendered.includes('有效'));
 });
 it('projects pending CriticMarkup as the approved base, not speculative edits',()=>{
  const src='A {++新增++} B {--删除--} C {~~旧版~>新版~~} D {==重点==} E {>>批注<<}';
  const result=projectConfirmedCriticMarkup(src);
  assert.ok(!result.includes('新增'));
  assert.ok(result.includes('删除'));
  assert.ok(result.includes('旧版'));
  assert.ok(!result.includes('新版'));
  assert.ok(result.includes('重点'));
  assert.ok(!result.includes('批注'));
  assert.ok(result.includes('A'));
 });
 it('never applies CriticMarkup inside inline or display mathematics, code, or Markdown links',()=>{
  const tick=String.fromCharCode(96);
  const src=[
   '公式 $\\operatorname{note}{++math++}$ 与 {++真正建议++}。',
   '',
   '$$',
   '\\text{literal {++display++}}',
   '$$',
   '',
   tick+'{++code++}'+tick,
   '',
   '[label {++inside-link++}](https://example.com/{++url++})'
  ].join('\n');
  const rendered=projectRmdPreview(src);
  for(const fragment of ['{++math++}','{++display++}','{++code++}','{++inside-link++}','{++url++}'])
   assert.ok(rendered.includes(fragment),'must preserve '+fragment+' in '+rendered);
  assert.ok(!rendered.includes('真正建议'),rendered);
 });
 it('does not let void HTML tags suppress later independent CriticMarkup reviews',()=>{
  const src=['<img src=x onerror=alert(1)>','',
   '<br>','',
   '基础 {--原文--} 和 {++待批准++}，以及 {~~旧文~>新文~~}。'].join('\n');
  const out=projectRmdPreview(src);
  assert.ok(out.includes('原文')&&out.includes('旧文'),out);
  assert.ok(!out.includes('待批准')&&!out.includes('新文'),out);
 });
 it('projects both comments and reviews without hiding malformed syntax',()=>{
  const result=projectRmdPreview('保留 %%备注%% {++新增++} {--原文--} ::unknown 内容');
  assert.ok(result.includes('原文'));
  assert.ok(result.includes('::unknown 内容'));
  assert.ok(!result.includes('备注'));
  assert.ok(!result.includes('新增'));
 });
});
