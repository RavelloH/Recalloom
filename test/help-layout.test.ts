import test from 'node:test';
import assert from 'node:assert/strict';
import {helpSections} from '../web/src/rmd-help-content';
import {getHelp} from '../src/help/index';
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

test('web and MCP syntax guides share user-facing content without development records',()=>{
 for(const [topic,guide] of [['markdown',HELP_SYNTAX_GUIDES.intro],['math',HELP_SYNTAX_GUIDES.math],['wiki',HELP_SYNTAX_GUIDES.wiki]] as const){
  assert.ok(getHelp(topic).content.startsWith(guide));
  assert.doesNotMatch(guide,/用户确认|重构时|回归清单|src\/rmd\/registry|Schema|Tiptap|源码级|Wiki 引用索引补建|旧版工具参数/);
 }
 assert.ok(getHelp('markdown').content.endsWith(HELP_RMD_REFERENCE));
 assert.match(HELP_SYNTAX_GUIDES.math,/默认黄色/);
 assert.doesNotMatch(HELP_RMD_REFERENCE,/请勿直接手改|历史的.*文档仍可解析/);
});
