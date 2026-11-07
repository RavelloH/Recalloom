import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {prepareWikiMarkdown} from '../web/src/wiki-remark';

const id='11111111-1111-4111-8111-111111111111';
describe('read-only Wiki tokens are protected before Markdown directive parsing',()=>{
 it('converts only recognized Wiki refs with encoded safe attributes',()=>{
  const body='See [[id:'+id+'#stable-title|Label]] and [[/Projects/文档.md]].';
  const output=prepareWikiMarkdown(body);
  assert.match(output,/<wiki-ref data-target="id%3A11111111/);
  assert.match(output,/data-alias="Label"/);
  assert.match(output,/data-anchor="stable-title"/);
  assert.ok(!output.includes('[[id:'));
  assert.ok(!output.includes('[[/Projects/'));
 });
 it('converts standalone embeds including block IDs without losing surrounding markdown',()=>{
  const body='# Heading\n\n{{embed:id:'+id+'#^important-block}}\n\nText **bold**.';
  const output=prepareWikiMarkdown(body);
  assert.match(output,/<wiki-embed data-target="id%3A11111111/);
  assert.match(output,/data-anchor="%5Eimportant-block"/);
  assert.ok(output.includes('Text **bold**.'));
 });
 it('leaves code and invalid bare-name references literal',()=>{
  const body='@@[[id:'+id+']]@@ and [[Only A Name]]\n\n~~~text\n{{embed:id:'+id+'}}\n~~~';
  const original=body.replaceAll('@@',String.fromCharCode(96));
  const output=prepareWikiMarkdown(original);
  assert.equal(output,original,'the entire fenced and inline code sample must remain untouched');
 });
});
