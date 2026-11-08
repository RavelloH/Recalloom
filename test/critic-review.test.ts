import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {resolveCriticSuggestion} from '../web/src/critic-review';
describe('explicit CriticMarkup review decisions',()=>{
 it('accepts additions, rejects deletions, and switches substitution branches',()=>{
  assert.deepEqual(resolveCriticSuggestion('addition','new','','accept'),{text:'new',highlight:false});
  assert.deepEqual(resolveCriticSuggestion('addition','new','','reject'),{text:'',highlight:false});
  assert.deepEqual(resolveCriticSuggestion('deletion','old','','accept'),{text:'',highlight:false});
  assert.deepEqual(resolveCriticSuggestion('deletion','old','','reject'),{text:'old',highlight:false});
  assert.deepEqual(resolveCriticSuggestion('substitution','new','old','accept'),{text:'new',highlight:false});
  assert.deepEqual(resolveCriticSuggestion('substitution','new','old','reject'),{text:'old',highlight:false});
 });
 it('accepts highlights to ordinary marks and rejects to plain text',()=>{
  assert.deepEqual(resolveCriticSuggestion('highlight','important','','accept'),{text:'important',highlight:true});
  assert.deepEqual(resolveCriticSuggestion('highlight','important','','reject'),{text:'important',highlight:false});
 });
 it('comments can only be explicitly resolved and never implicitly accepted',()=>{
  assert.equal(resolveCriticSuggestion('comment','review','','accept'),null);
  assert.equal(resolveCriticSuggestion('comment','review','','reject'),null);
  assert.deepEqual(resolveCriticSuggestion('comment','review','','resolve'),{text:'',highlight:false});
 });
});
