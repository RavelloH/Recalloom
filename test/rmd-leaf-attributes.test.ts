import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLeafFields} from '../web/src/tiptap/rmd-leaf-attributes';
describe('RMD link-card and wiki embed fields',()=>{
 it('accepts only safe public HTTP(S) link card URLs without losing their query/hash',()=>{
  for(const address of ['https://github.com/RavelloH/Recalloom?ref=notes#readme','http://example.com/info']){
   assert.deepEqual(normalizeLeafFields('richLinkCard','url',address),{ok:true,attrs:{url:address}});
  }
  for(const address of ['https://localhost/test','http://127.0.0.1/admin','javascript:alert(1)','file:///etc/passwd','http://a.local','http://test.invalid','http://evil.com @b','', 'https://example.com:8080','https://example.com/path|title=malformed'])
   assert.equal(normalizeLeafFields('richLinkCard','url',address).ok,false,address);
 });
 it('allows an empty card title and rejects unroundtrippable delimiter/newlines',()=>{
  assert.deepEqual(normalizeLeafFields('richLinkCard','title','  Notes  '),{ok:true,attrs:{title:'Notes'}});
  assert.deepEqual(normalizeLeafFields('richLinkCard','title',''),{ok:true,attrs:{title:''}});
  for(const title of ['first|second','line\nbreak','a'.repeat(241)])
   assert.equal(normalizeLeafFields('richLinkCard','title',title).ok,false);
 });
 it('parses UUID and absolute-path wiki references, with optional anchors',()=>{
  assert.deepEqual(normalizeLeafFields('wikiEmbed','target','id:550e8400-e29b-41d4-a716-446655440000#chapter'),
   {ok:true,attrs:{target:'id:550e8400-e29b-41d4-a716-446655440000',anchor:'chapter'}});
  assert.deepEqual(normalizeLeafFields('wikiEmbed','target','/Projects/Recalloom/README.md'),
   {ok:true,attrs:{target:'/Projects/Recalloom/README.md',anchor:null}});
  for(const target of ['My document','/','/parent/../private.md','id:not-a-uuid','/doc.md#^legacy','/doc|title=broken.md',''])
   assert.equal(normalizeLeafFields('wikiEmbed','target',target).ok,false,target);
 });
 it('never accepts fields outside a node type',()=>{
  assert.equal(normalizeLeafFields('wikiEmbed','title','foo').ok,false);
  assert.equal(normalizeLeafFields('richLinkCard','target','/path').ok,false);
 });
});