import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planThreeWayMerge,resolveThreeWayMerge,preserveUnchangedVisualTerminator} from '../web/src/three-way-merge.js';

test('disjoint Markdown paragraphs merge without changing source whitespace',()=>{
 const base='# Title\r\n\r\nAlpha\r\n\r\nBeta\r\n\r\nGamma\r\n';
 const local='# Title\r\n\r\nAlpha local\r\n\r\nBeta\r\n\r\nGamma\r\n';
 const remote='# Title\r\n\r\nAlpha\r\n\r\nBeta\r\n\r\nGamma remote\r\n';
 const p=planThreeWayMerge(base,local,remote);
 assert.equal(p.conflictCount,0);
 assert.equal(p.autoContent,'# Title\r\n\r\nAlpha local\r\n\r\nBeta\r\n\r\nGamma remote\r\n');
});
test('same line changes are never silently overwritten',()=>{
 const p=planThreeWayMerge('A\nB\nC\n','A\nmine\nC\n','A\ntheirs\nC\n');
 assert.equal(p.conflictCount,1);
 assert.equal(p.autoContent,null);
 const choice=p.pieces.find(x=>x.kind==='conflict')!;
 assert.equal(resolveThreeWayMerge(p,{[choice.id]:'local'}),'A\nmine\nC\n');
 assert.equal(resolveThreeWayMerge(p,{[choice.id]:'remote'}),'A\ntheirs\nC\n');
 assert.equal(resolveThreeWayMerge(p,{}),null);
});
test('identical concurrent modifications never falsely conflict',()=>{
 const p=planThreeWayMerge('A\nB\n','A\nsame\n','A\nsame\n');
 assert.equal(p.autoContent,'A\nsame\n');
 assert.equal(p.conflictCount,0);
});
test('adjacent independent replacements, multiple inserts and deletion',()=>{
 const cases=[
  ['a\nb\nc\nd\n','A\nb\nc\nd\n','a\nb\nc\nD\n','A\nb\nc\nD\n'],
  ['a\nb\nc\n','a\nLOCAL\nb\nc\n','a\nb\nc\nREMOTE\n','a\nLOCAL\nb\nc\nREMOTE\n'],
  ['a\nb\nc\nd\n','a\nc\nd\n','a\nb\nc\nD\n','a\nc\nD\n'],
  ['a\nb\nc\n','A\nb\nc\n','a\nB\nc\n','A\nB\nc\n']
 ];
 for(const [base,local,remote,want] of cases)assert.equal(planThreeWayMerge(base,local,remote).autoContent,want);
});
test('two inserts at same location require explicit choice',()=>{
 assert.equal(planThreeWayMerge('a\nb\n','a\nmine\nb\n','a\ntheirs\nb\n').conflictCount,1);
});
test('insertion at replaced boundary is conservative',()=>{
 assert.ok(planThreeWayMerge('a\nb\nc\n','a\nx\nb\nc\n','a\nB\nc\n').conflictCount>=1);
});
test('RMD edits are never implicitly joined with other changes',()=>{
 const base='# H\n\n::: callout info\nold text\n:::\n\nTail\n';
 const local='# H\n\n::: callout info\nlocal text\n:::\n\nTail\n';
 const remote='# H\n\n::: callout info\nold text\n:::\n\nRemote tail\n';
 const plan=planThreeWayMerge(base,local,remote);
 assert.equal(plan.autoContent,null);
 assert.ok(plan.pieces.some(p=>p.reason==='structured'));
});
test('fences, math, table and attrs require review',()=>{
 const docs=[
  ['before\n\n~~~ts\ncode\n~~~\n','before\n\n~~~ts\nnewcode\n~~~\n'],
  ['before\n\n$$\nx^2\n$$\n','before\n\n$$\nx^3\n$$\n'],
  ['before\n\n| A | B |\n|---|---|\n|1|2|\n','before\n\n| A | B |\n|---|---|\n|1|3|\n'],
  ['before\n\nTitle @ attrs | key=x @\n','before\n\nTitle @ attrs | key=y @\n']
 ];
 for(const [base,local] of docs)assert.equal(
  planThreeWayMerge(base,local,base.replace('before','BEFORE')).autoContent,null);
});
test('inline RMD marks, wiki links and math are treated as structure-sensitive',()=>{
 const examples=[
  ['a\n\nText :badge note | variant=info :\n\nz\n','a\n\nText :badge modified | variant=info :\n\nz\n'],
  ['a\n\nSee [[Wiki]]\n\nz\n','a\n\nSee [[Other]]\n\nz\n'],
  ['a\n\nFormula $x^2$\n\nz\n','a\n\nFormula $x^3$\n\nz\n']
 ];
 for(const [base,local] of examples){
  const remote=base.replace('a\n','A\n');
  assert.equal(planThreeWayMerge(base,local,remote).autoContent,null);
 }
});
test('unrelated plain paragraph changes still merge beside untouched RMD',()=>{
 const base='First\n\n::: callout tip\nuntouched\n:::\n\nLast\n';
 const local='FIRST\n\n::: callout tip\nuntouched\n:::\n\nLast\n';
 const remote='First\n\n::: callout tip\nuntouched\n:::\n\nLAST\n';
 assert.equal(planThreeWayMerge(base,local,remote).autoContent,
  'FIRST\n\n::: callout tip\nuntouched\n:::\n\nLAST\n');
});
test('visual serializer single trailing newline is only restored if final source line is unchanged',()=>{
 assert.equal(preserveUnchangedVisualTerminator('one\n\ntwo\n','ONE\n\ntwo'),'ONE\n\ntwo\n');
 assert.equal(preserveUnchangedVisualTerminator('one\r\n\r\ntwo\r\n','ONE\r\n\r\ntwo'),'ONE\r\n\r\ntwo\r\n');
 assert.equal(preserveUnchangedVisualTerminator('one\n\ntwo\n','one\n\nTWO'),'one\n\nTWO');
 assert.equal(preserveUnchangedVisualTerminator('one\n\ntwo\n\n','ONE\n\ntwo'),'ONE\n\ntwo');
 assert.equal(preserveUnchangedVisualTerminator('one\n\ntwo\n','one\n\ntwo\n'),'one\n\ntwo\n');
 const original='# H\n\nFirst\n\nThird\n';
 const visual='# H\n\nFirst local\n\nThird';
 const remote='# H\n\nFirst\n\nThird remote\n';
 assert.equal(planThreeWayMerge(original,preserveUnchangedVisualTerminator(original,visual),remote).autoContent,
  '# H\n\nFirst local\n\nThird remote\n');
});
test('preserve endings, empty docs, no-op and limits',()=>{
 assert.equal(planThreeWayMerge('','mine','').autoContent,'mine');
 assert.equal(planThreeWayMerge('base','base','theirs').autoContent,'theirs');
 assert.equal(planThreeWayMerge('a\n','a\n','a').autoContent,'a');
 assert.equal(planThreeWayMerge('a\n','a\n','a\n').autoContent,'a\n');
 assert.equal(planThreeWayMerge('x'.repeat(300001),'a','b').reason,'limit');
});
test('every conflicting hunk requires a choice and chosen variants are exact',()=>{
 const p=planThreeWayMerge('a\nb\nc\nd\n','A\nb\nC\nd\n','other-a\nb\nother-c\nd\n');
 assert.equal(p.conflictCount,2);
 assert.equal(resolveThreeWayMerge(p,{}),null);
 const ids=p.pieces.filter(x=>x.kind==='conflict').map(x=>x.id);
 assert.equal(resolveThreeWayMerge(p,{[ids[0]]:'local',[ids[1]]:'remote'}),'A\nb\nother-c\nd\n');
});
