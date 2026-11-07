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
 it('permits exact 链接卡片 and 新的 标签页',()=>{
  assert.equal(filterSlashCommands(editor,'链接卡片')[0]?.id,'link-card');
  assert.equal(filterSlashCommands(editor,'标签页')[0]?.id,'tabs');
 });
});
