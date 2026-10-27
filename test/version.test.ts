import test from 'node:test';
import assert from 'node:assert/strict';
import {initialVersion,nextVersion,historicalVersion,applyLineChanges,editContent,sha256} from '../src/version.js';

test('text-version preserves exact historical text with separated latest snapshot',()=>{
  let data=initialVersion('# 计划\n- [ ] 实现认证\n');
  data=nextVersion(data,'# 计划\n- [x] 实现认证\n',2);
  data=nextVersion(data,'# 计划\n- [x] 实现认证\n- [ ] 完成搜索\n',3);
  assert.equal(historicalVersion(data,1),'# 计划\n- [ ] 实现认证\n');
  assert.equal(historicalVersion(data,2),'# 计划\n- [x] 实现认证\n');
  assert.equal(historicalVersion(data,3),'# 计划\n- [x] 实现认证\n- [ ] 完成搜索\n');
});
test('restoring older content appends a new revision',()=>{
  let data=initialVersion('alpha');
  data=nextVersion(data,'beta',2);
  data=nextVersion(data,'alpha',3);
  assert.equal(historicalVersion(data,1),'alpha');
  assert.equal(historicalVersion(data,2),'beta');
  assert.equal(historicalVersion(data,3),'alpha');
});
test('empty initial text can be versioned',()=>{
  let data=initialVersion('');
  assert.equal(historicalVersion(data,1),'');
  data=nextVersion(data,'hello',2);
  assert.equal(historicalVersion(data,1),'');
  assert.equal(historicalVersion(data,2),'hello');
});
test('strict replace refuses ambiguous repeated text',()=>{
  assert.throws(()=>editContent('same\nsame',{mode:'replace',oldText:'same',newText:'different'}),/REPLACEMENT_COUNT_MISMATCH/);
});
test('line edits apply positions relative to original content',()=>{
  const out=applyLineChanges('a\nb\nc\nd\n',[
    {action:'replace',start:2,end:2,content:'B'},
    {action:'delete',start:4,end:4},
    {action:'insert',start:3,content:'NEW'}
  ]);
  assert.equal(out,'a\nB\nNEW\nc\n');
});
test('line edits reject overlapping ranges',()=>{
  assert.throws(()=>applyLineChanges('a\nb\nc\n',[
    {action:'replace',start:1,end:2,content:'X'},
    {action:'delete',start:2,end:3}
  ]),/OVERLAPPING_LINE_RANGES/);
});
test('content SHA-256 is deterministic',async()=>{
  assert.equal(await sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
