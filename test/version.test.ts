import test from 'node:test';
import assert from 'node:assert/strict';
import {TextVersion} from 'text-version';
import {initialVersion,nextVersion,historicalVersion,applyLineChanges,editContent,sha256} from '../src/version.js';

test('text-version preserves exact historical text with separated latest snapshot',()=>{
  let data=initialVersion('# 计划\n- [ ] 实现认证\n');
  data=nextVersion(data,'# 计划\n- [x] 实现认证\n',2);
  data=nextVersion(data,'# 计划\n- [x] 实现认证\n- [ ] 完成搜索\n',3);
  assert.equal(historicalVersion(data,1),'# 计划\n- [ ] 实现认证\n');
  assert.equal(historicalVersion(data,2),'# 计划\n- [x] 实现认证\n');
  assert.equal(historicalVersion(data,3),'# 计划\n- [x] 实现认证\n- [ ] 完成搜索\n');
});
test('text-version 2.2 preserves LaTeX and JS replacement markers without duplicate history',()=>{
  const marker=String.fromCharCode(36,96);
  const samples=[
    '# Formula\n\n$$\nE=mc^2\n$$',
    'A literal '+marker+' marker must never duplicate the metadata prefix',
    'A $& or $\' marker must remain literal source text',
    'Finally, the answer is $x^2$.'
  ];
  let state=initialVersion(samples[0]!);
  for(let i=1;i<samples.length;i++){
    state=nextVersion(state,samples[i]!,i+1);
    for(let revision=1;revision<=i+1;revision++){
      assert.equal(historicalVersion(state,revision),samples[revision-1]);
    }
  }
  const versioned=new TextVersion(state.metadata,state.content) as unknown as {getParsedData():{versions:string[]}};
  assert.deepEqual(versioned.getParsedData().versions,['1','2','3','4']);
  assert.equal((new TextVersion() as unknown as {optimizeDiffStorage:boolean}).optimizeDiffStorage,false);
});
test('a repaired document may retain revision 12 as its only historical baseline',()=>{
  const source='# Current verified document\n\n$$\nE=mc^2\n$$';
  const baseline=new TextVersion();
  baseline.commit(source,'12');
  let version={content:source,metadata:baseline.export('separate').metadata};
  assert.equal(historicalVersion(version,12),source);
  version=nextVersion(version,source+'\n\nNext',13);
  version=nextVersion(version,source+'\n\nNext\nMore',14);
  assert.equal(historicalVersion(version,12),source);
  assert.equal(historicalVersion(version,13),source+'\n\nNext');
  assert.equal(historicalVersion(version,14),version.content);
  assert.deepEqual((new TextVersion(version.metadata,version.content) as unknown as {getParsedData():{versions:string[]}}).getParsedData().versions,['12','13','14']);
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
