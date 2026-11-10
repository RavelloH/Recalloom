import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {Editor} from '@tiptap/core';
import {filterSlashCommands} from '../web/src/tiptap/slash-commands';
const editor={isActive:()=>false} as unknown as Editor;
describe('Rich Markdown slash commands do not shadow existing actions',()=>{
 it('prefers exact 链接 over fuzzy 链接卡片',()=>{
  const found=filterSlashCommands(editor,'链接');
  assert.equal(found[0]?.id,'link');
  assert.ok(found.some(cmd=>cmd.id==='link-card'));
 });
 it('inserts new study syntax without displacing existing link and tab commands',()=>{
  assert.equal(filterSlashCommands(editor,'学习闪卡')[0]?.id,'flashcard');
  assert.equal(filterSlashCommands(editor,'术语定义列表')[0]?.id,'glossary');
  assert.equal(filterSlashCommands(editor,'复习挖空')[0]?.id,'cloze');
  assert.equal(filterSlashCommands(editor,'快捷键键帽')[0]?.id,'kbd');
  assert.equal(filterSlashCommands(editor,'链接')[0]?.id,'link');
  assert.equal(filterSlashCommands(editor,'标签页')[0]?.id,'tabs');
 });
 it('permits exact 链接卡片 and 新的 标签页',()=>{
  assert.equal(filterSlashCommands(editor,'链接卡片')[0]?.id,'link-card');
  assert.equal(filterSlashCommands(editor,'标签页')[0]?.id,'tabs');
 });
 it('reserves slash for insertion rather than paragraph/heading state switches',()=>{
  for(const id of ['text','h1','h2','h3','h4','h5','h6','bullet','ordered','todo','quote','align-left','align-center','align-right'])
   assert.ok(!filterSlashCommands(editor,'').some(c=>c.id===id),id+' must be controlled by the formatting toolbar');
  assert.equal(filterSlashCommands(editor,'脚注定义')[0]?.id,'footnote-definition');
 });
});
