import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeRmd,lexRmd,findRmdWikiSpans,protectedRmdRanges,shieldRmdTablePipes} from '../web/src/rmd-lexer';
import {normalizeKnownMarkdown} from '../web/src/markdown-normalize';
import {parseRmdVisual} from '../web/src/rmd-visual';

const fixtures=[
 ['ordinary','# Title\n\nA paragraph with **bold** and a [link](https://example.org).'],
 ['extensions',[
  '# Introduction @ attrs introduction @','',
  'Status :: badge Verified | success :: and :: mark $U=IR$ ::.','',
  '::: warning Attention','','Content with **bold** text.','',':::','',
  '~~~ts','const value = 1;','~~~','@ attrs code-entry | file=app.ts @'
 ].join('\n')],
 ['table and wiki',[
  '| Term | Reference |','| --- | --- |',
  '| Link | [[id:8adb5a57-9307-4691-ae91-feeb8b2624cc|Title \\| Alias]] |',
  '@ attrs tbl-parameters | caption=Parameters @','','[[#tbl-parameters]]'
 ].join('\n')],
 ['unknown and CRLF',[
  '::: unknown','Keep this raw.',':::','','%%','visible comment','%%',
  '','<unknown-widget data-id="x">','Unknown HTML','</unknown-widget>',
  '','~~~md',':: badge not interpreted ::','~~~'
 ].join('\r\n')],
 ['mathematics and nested',[
  ':::: tabs','','::: tab First','','$$','P=UI','$$','',':::','','::::','','[^note]: A footnote.'
 ].join('\n')]
] as const;

test('request-scoped analysis agrees with independent lexer and visual parsing',()=>{
 for(const [name,source] of fixtures){
  const normalized=normalizeKnownMarkdown(source.replace(/\r\n/g,'\n'));
  const analysis=analyzeRmd(normalized);
  assert.deepEqual(analysis.tokens,lexRmd(normalized),name+' lexer');
  assert.deepEqual(analysis.protectedRanges,protectedRmdRanges(normalized),name+' protected spans');
  assert.deepEqual(analysis.wikiSpans,findRmdWikiSpans(normalized),name+' wiki');
  assert.equal(shieldRmdTablePipes(normalized,analysis),shieldRmdTablePipes(normalized),name+' GFM shielding');
  assert.deepEqual(parseRmdVisual(normalized,analysis),parseRmdVisual(normalized),name+' visual AST');
  // The table-shielded reparse is the previous authoritative path. The
  // fast cloned MDAST path must produce precisely the same semantic JSON.
  assert.deepEqual(parseRmdVisual(normalized,analysis),
   parseRmdVisual(normalized,{...analysis,hasGfmTable:true}),name+' fast/reparse parity');
  assert.equal(analysis.hasGfmTable,name==='table and wiki',name+' table detection');
 }
});

test('an analysis of another source cannot be used to decode a new document',()=>{
 const original=analyzeRmd(':: badge OK | success ::');
 const other='## Changed\n\n[[#section-new]]';
 assert.deepEqual(parseRmdVisual(other,original),parseRmdVisual(other));
 assert.equal(shieldRmdTablePipes(other,original),shieldRmdTablePipes(other));
});
