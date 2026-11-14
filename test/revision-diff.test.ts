import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {buildRevisionDiff,revisionSourcePage,type RevisionDiffRow} from '../web/src/revision-diff';

const changedRows=(rows:RevisionDiffRow[])=>rows.filter(row=>row.kind!=='unchanged');

describe('source-preserving RMD revision diff',()=>{
 it('keeps nested containers and fences as complete top-level blocks',()=>{
  const before=[
   ':::: details 说明','','::: note 内层','','内层正文。','',':::',
   '~~~md','::: fake','~~~','','::::'
  ].join('\n');
  const after=before.replace('内层正文。','内层正文已修改。');
  const result=buildRevisionDiff(before,after);
  const edits=changedRows(result.rows);
  assert.equal(edits.length,2,JSON.stringify(result.rows));
  assert.deepEqual(edits.map(row=>row.kind),['removed','added']);
  assert.equal(edits[0]?.block.kind,'rmd:block:details');
  assert.equal(edits[0]?.block.startLine,1);
  assert.equal(edits[0]?.block.endLine,12);
  assert.ok(edits[0]?.block.content.startsWith(':::: details'));
  assert.ok(edits[0]?.block.content.endsWith('::::'));
  assert.ok(edits[0]?.block.content.includes('::: fake'));
  assert.equal(edits[0]?.compareContent,after);
  assert.equal(result.limited,false);
 });

 it('attaches table, code and math attrs lines to their source blocks',()=>{
  const before=[
   '| A | B |','| --- | --- |','| 1 | 2 |','@ attrs tbl-old | caption=Old @','',
   '~~~ts','const x = 1;','~~~','@ attrs code-old | file=old.ts @','',
   '$$','E = mc^2','$$','@ attrs eq-old @'
  ].join('\n');
  const after=before.replace('tbl-old','tbl-new').replace('old.ts','new.ts').replace('eq-old','eq-new');
  const result=buildRevisionDiff(before,after);
  const edits=changedRows(result.rows);
  assert.equal(edits.length,6,JSON.stringify(result.rows));
  const removed=edits.filter(row=>row.kind==='removed');
  assert.deepEqual(removed.map(row=>row.block.kind),['table','code','math']);
  assert.ok(removed[0]?.block.content.endsWith('@ attrs tbl-old | caption=Old @'));
  assert.equal(removed[0]?.block.endLine,4);
  assert.ok(removed[1]?.block.content.endsWith('@ attrs code-old | file=old.ts @'));
  assert.equal(removed[1]?.block.endLine,9);
  assert.ok(removed[2]?.block.content.endsWith('@ attrs eq-old @'));
  assert.equal(removed[2]?.block.endLine,14);
  assert.ok(removed.every(row=>row.compareContent));
 });

 it('pairs small paragraph edits and preserves formatting and URL syntax',()=>{
  const before='A **bold phrase** links to [docs](https://old.example/path) and $x=1$.';
  const after='A *bold phrase* links to [docs](https://new.example/path) and $x=2$.';
  const result=buildRevisionDiff(before,after);
  const edits=changedRows(result.rows);
  assert.equal(edits.length,2,JSON.stringify(result.rows));
  assert.equal(edits[0]?.block.kind,'paragraph');
  assert.equal(edits[0]?.compareContent,after);
  assert.ok(edits[0]?.block.content.includes('**bold phrase**'));
  assert.ok(edits[0]?.block.content.includes('https://old.example/path'));
  assert.ok(edits[0]?.block.content.includes('$x=1$'));
  assert.ok(edits[1]?.block.content.includes('*bold phrase*'));
  assert.ok(edits[1]?.block.content.includes('https://new.example/path'));
  assert.ok(edits[1]?.block.content.includes('$x=2$'));
  assert.ok(result.sourceRows.some(row=>row.kind==='removed'&&row.text===before));
  assert.ok(result.sourceRows.some(row=>row.kind==='added'&&row.text===after));
 });

 it('keeps standalone attrs with ordinary target blocks and collects definitions',()=>{
  const before=[
   '# Heading','','A paragraph.','@ attrs para-id @','',
   '[guide]: https://old.example','',
   '[^note]: Footnote text.'
  ].join('\n');
  const after=before.replace('para-id','paragraph-id').replace('https://old.example','https://new.example');
  const result=buildRevisionDiff(before,after);
  const edits=changedRows(result.rows);
  assert.deepEqual(edits.filter(row=>row.kind==='removed').map(row=>row.block.kind),['paragraph','definition']);
  assert.ok(edits.find(row=>row.kind==='removed'&&row.block.kind==='paragraph')?.block.content.endsWith('@ attrs para-id @'));
  assert.equal(result.definitionsBefore,'[guide]: https://old.example\n\n[^note]: Footnote text.');
  assert.equal(result.definitionsAfter,'[guide]: https://new.example\n\n[^note]: Footnote text.');
 });

 it('reports line ranges and keeps blank-line and CRLF-only changes visible',()=>{
  const before='## Title\n\nParagraph';
  const after='## Title\n\n\nParagraph';
  const result=buildRevisionDiff(before,after);
  assert.equal(result.changed,true);
  assert.ok(result.rows.every(row=>row.kind==='unchanged'));
  assert.ok(result.sourceRows.some(row=>row.kind==='added'&&row.text===''));
  assert.equal(result.rows[0]?.block.startLine,1);
  assert.equal(result.rows[1]?.block.startLine,3);
  const crlf=buildRevisionDiff('One\r\n\r\nTwo','One\n\nTwo');
  assert.equal(crlf.changed,true);
  assert.ok(crlf.rows.every(row=>row.kind==='unchanged'));
  assert.deepEqual(crlf.sourceRows.filter(row=>row.kind!=='unchanged').map(row=>[row.kind,row.text,row.ending]),[
   ['removed','One','CRLF'],['added','One','LF'],['removed','','CRLF'],['added','','LF']
  ]);
  assert.equal(crlf.addedLines,2);
  assert.equal(crlf.removedLines,2);
 });

 it('locates a mixed-EOL change on the matching source line',()=>{
  const result=buildRevisionDiff('first\r\nsecond\r\nthird\n','first\r\nsecond\nthird\n');
  assert.deepEqual(result.sourceRows.filter(row=>row.kind!=='unchanged').map(row=>[
   row.kind,row.text,row.oldLine,row.newLine,row.ending
  ]),[
   ['removed','second',2,null,'CRLF'],['added','second',null,2,'LF']
  ]);
  assert.equal(result.addedLines,1);
  assert.equal(result.removedLines,1);
 });

 it('shows a final newline change even when line text is identical',()=>{
  const result=buildRevisionDiff('same','same\n');
  assert.deepEqual(result.sourceRows.map(row=>[row.kind,row.text,row.oldLine,row.newLine,row.ending]),[
   ['removed','same',1,null,'none'],['added','same',null,1,'LF']
  ]);
  assert.equal(result.addedLines,1);
  assert.equal(result.removedLines,1);
 });

 it('retains unchanged blocks and represents additions, deletions and moves',()=>{
  const result=buildRevisionDiff('A\n\nB\n\nC','C\n\nA\n\nD');
  assert.equal(result.changed,true);
  assert.ok(result.rows.some(row=>row.kind==='unchanged'&&row.block.content==='C'));
  assert.ok(result.rows.some(row=>row.kind==='removed'&&row.block.content==='B'));
  assert.ok(result.rows.some(row=>row.kind==='added'&&row.block.content==='D'));
  assert.ok(result.rows.some(row=>row.kind==='removed'&&row.block.content==='A'));
  assert.ok(result.rows.some(row=>row.kind==='added'&&row.block.content==='A'));
 });

 it('uses a complete, explicit replacement when document limits are exceeded',()=>{
  const before='a'.repeat(300_001),after='b'.repeat(300_002);
  const result=buildRevisionDiff(before,after);
  assert.equal(result.limited,true);
  assert.deepEqual(result.rows.map(row=>row.kind),['removed','added']);
  assert.equal(result.rows[0]?.block.content,before);
  assert.equal(result.rows[1]?.block.content,after);
  assert.deepEqual(result.sourceRows.map(row=>row.kind),['removed','added']);
  assert.equal(result.sourceRows[0]?.text,before);
  assert.equal(result.sourceRows[1]?.text,after);
  const manyLines=Array.from({length:6001},()=>'-').join('\n');
  assert.equal(buildRevisionDiff(manyLines,'').limited,true);
 });

 it('keeps statistics clean for identical oversized documents',()=>{
  const document='large line\n'.repeat(30_001);
  const result=buildRevisionDiff(document,document);
  assert.equal(result.limited,true);
  assert.equal(result.changed,false);
  assert.equal(result.addedLines,0);
  assert.equal(result.removedLines,0);
  assert.ok(result.sourceRows.every(row=>row.kind==='unchanged'));
 });

 it('pages replacement source without losing mixed endings or scanning later lines',()=>{
  const row={kind:'removed' as const,text:'first\r\nsecond\nthird',oldLine:7,newLine:null};
  const first=revisionSourcePage(row,2);
  assert.equal(first.hasMore,true);
  assert.deepEqual(first.values.map(line=>[line.text,line.oldLine,line.newLine,line.ending,line.endingChanged]),[
   ['first',7,null,'CRLF',true],['second',8,null,'LF',true]
  ]);
  const complete=revisionSourcePage(row,300);
  assert.equal(complete.hasMore,false);
  assert.deepEqual(complete.values.at(-1),{kind:'removed',text:'third',oldLine:9,newLine:null,ending:'none',endingChanged:true});
  const terminated=revisionSourcePage({...row,text:'last\r\n'},300);
  assert.equal(terminated.values.length,1);
  assert.equal(terminated.hasMore,false);
 });

 it('keeps a verbatim document header intact instead of turning its delimiters into headings',()=>{
  const before='---\ntitle: Old\n---\n\nBody',after=before.replace('Old','New');
  const result=buildRevisionDiff(before,after);
  const removed=result.rows.find(row=>row.kind==='removed');
  assert.equal(removed?.block.kind,'frontmatter');
  assert.equal(removed?.block.content,'---\ntitle: Old\n---');
  assert.equal(removed?.block.startLine,1);
  assert.equal(removed?.block.endLine,3);
  assert.ok(result.rows.some(row=>row.kind==='unchanged'&&row.block.content==='Body'));
 });

 it('returns bounded analyses for reference-index reuse',()=>{
  const result=buildRevisionDiff('# Heading\n\nBody','## Heading\n\nBody');
  assert.equal(result.limited,false);
  assert.equal(result.analysisBefore?.source,'# Heading\n\nBody');
  assert.equal(result.analysisAfter?.source,'## Heading\n\nBody');
  assert.equal(buildRevisionDiff('x'.repeat(300_001),'').analysisBefore,undefined);
 });
});
