import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkMergeStructure} from '../web/src/merge-structure-check.js';
import {planThreeWayMerge,resolveThreeWayMerge} from '../web/src/three-way-merge.js';

test('custom conflict text is preserved byte for byte, including empty deletions and CRLF',()=>{
 const base='First\r\nSecond\r\nThird\r\n';
 const plan=planThreeWayMerge(base,'First\r\nLocal\r\nThird\r\n','First\r\nRemote\r\nThird\r\n');
 const piece=plan.pieces.find(x=>x.kind==='conflict')!;
 assert.equal(resolveThreeWayMerge(plan,{[piece.id]:'custom'},{}),null);
 assert.equal(resolveThreeWayMerge(plan,{[piece.id]:'custom'},{[piece.id]:'Both\r\nCustom\r\n'}),
  'First\r\nBoth\r\nCustom\r\nThird\r\n');
 assert.equal(resolveThreeWayMerge(plan,{[piece.id]:'custom'},{[piece.id]:''}),'First\r\nThird\r\n');
 assert.equal(resolveThreeWayMerge(plan,{[piece.id]:'local'},{[piece.id]:'ignored'}),'First\r\nLocal\r\nThird\r\n');
 assert.equal(resolveThreeWayMerge(plan,{[piece.id]:'remote'},{[piece.id]:'ignored'}),'First\r\nRemote\r\nThird\r\n');
});
test('multiple manual edits do not discard independent remote changes',()=>{
 const base='Start\nAlpha\nMiddle\nBeta\nEnd\n';
 const local='Start\nMine\nMiddle\nMy Beta\nEnd\n';
 const remote='Start\nTheirs\nMiddle\nTheir Beta\nEnd remote\n';
 const plan=planThreeWayMerge(base,local,remote);
 assert.equal(plan.conflictCount,2);
 const ids=plan.pieces.filter(x=>x.kind==='conflict').map(x=>x.id);
 assert.equal(resolveThreeWayMerge(plan,{[ids[0]]:'custom',[ids[1]]:'custom'},
  {[ids[0]]:'Combined alpha\n',[ids[1]]:'Combined beta\n'}),
  'Start\nCombined alpha\nMiddle\nCombined beta\nEnd remote\n');
});
test('RMD preflight recognizes balanced containers and code fenced directives',()=>{
 const valid=[
  '# Heading\n\n::: tip 建议\nSafe\n:::\n\nTail\n',
  '~~~markdown\n::: callout warning\nNo closing tag inside code\n~~~\n',
  'Before\n\n$$\nx^2\n$$\n\nAfter\n',
  ':::: tabs\n::: tab First\nContent\n:::\n::::\n'
 ];
 for(const doc of valid){
  const errors=checkMergeStructure(doc).filter(x=>x.severity==='error');
  assert.deepEqual(errors,[],'unexpected structural errors: '+JSON.stringify(errors)+' in '+doc);
 }
});
test('RMD preflight reports unclosed directives, code fences, math and unexpected closes',()=>{
 const cases=[
  ['::: tip 建议\nNot closed\n','rmd-open'],
  ['~~~js\nconst value = 1;\n','code-fence'],
  ['$$\nx^2\n','math-fence'],
  ['Closing\n:::\n','rmd-close'],
  [':::: box\n:::: tip 建议\nNested\n:::\n::::\n','rmd-nesting']
 ];
 for(const [doc,code] of cases)
  assert.ok(checkMergeStructure(doc).some(x=>x.severity==='error'&&x.code===code),
   'missing '+code+' for '+doc);
});
test('unknown RMD syntax produces advisory warning without modifying Markdown',()=>{
 const unknown='Text\n::: custom-widget\nSome content\n';
 const snap=unknown.slice();
 assert.ok(checkMergeStructure(unknown).some(x=>x.severity==='warning'&&x.code==='rmd-unknown'));
 assert.equal(unknown,snap);
 assert.deepEqual(checkMergeStructure('Plain **Markdown** with $x^2$ and [[Wiki]]\n'),[]);
});
