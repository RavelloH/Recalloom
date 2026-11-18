import test from 'node:test';
import assert from 'node:assert/strict';
import {helpSections} from '../web/src/rmd-help-content';
import {HELP_SYNTAX_GUIDES,HELP_RMD_REFERENCE} from '../src/help/catalog.generated';

test('help section navigation excludes fenced examples and keeps stable source-line IDs',()=>{
 const source='# Guide\n\n## Basics\n\n~~~~markdown\n## Example heading\n~~~\n~~~~\n\n## `badge` ###\n\n```text\n## Hidden\n```';
 assert.deepEqual(helpSections(source),[{id:'help-heading-3',label:'Basics'},{id:'help-heading-10',label:'badge'}]);
 assert.deepEqual(helpSections('# badge\n\n### 参数\n\n## 多行写法\n### 示例',true),[
  {id:'help-heading-3',label:'参数'},
  {id:'help-heading-5',label:'多行写法'},
  {id:'help-heading-6',label:'多行写法 · 示例'}
 ]);
});

test('web syntax guides stay in Chinese and exclude development records',()=>{
 for(const guide of Object.values(HELP_SYNTAX_GUIDES)){
  assert.match(guide,/^# .*\p{Script=Han}/u);
  assert.doesNotMatch(guide,/用户确认|重构时|回归清单|src\/rmd\/registry|Schema|Tiptap|源码级|Wiki 引用索引补建|旧版工具参数/);
 }
 assert.match(HELP_SYNTAX_GUIDES.math,/默认黄色/);
 assert.doesNotMatch(HELP_RMD_REFERENCE,/请勿直接手改|历史的.*文档仍可解析/);
});
