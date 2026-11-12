import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resourceViewTransitionIdentity,sharedViewTransitionName,sharedTitleAttributes,candidateForRoutes} from '../web/src/shared-view-transition.js';

test('resource names are deterministic, safe CSS identifiers',()=>{
 const record=resourceViewTransitionIdentity('record','1234-abcd-5678');
 const folder=resourceViewTransitionIdentity('folder','1234-abcd-5678');
 assert.match(record,/^rk-record-[a-zA-Z0-9_-]+$/);
 assert.notEqual(record,folder,'different resource kinds must not share a snapshot identity');
 assert.equal(record,resourceViewTransitionIdentity('record','1234-abcd-5678'));
 assert.notEqual(record,resourceViewTransitionIdentity('record','1234-abcd-5679'));
});

test('a rename does not affect identity, and punctuation is escaped',()=>{
 const pathLike=resourceViewTransitionIdentity('record','note/a.md');
 assert.equal(pathLike,resourceViewTransitionIdentity('record','note/a.md'));
 assert.ok(!pathLike.includes('/'));
 assert.ok(!pathLike.includes('.'));
 assert.notEqual(pathLike,resourceViewTransitionIdentity('record','note-a-md'));
});

test('unpaired text stays inside the route snapshot',()=>{
 assert.equal(sharedViewTransitionName('record','1234-abcd-5678'),undefined);
 assert.equal(sharedViewTransitionName('folder','1234-abcd-5678'),undefined);
 assert.deepEqual(sharedTitleAttributes('record','1234'),{
  'data-rk-vt-kind':'record','data-rk-vt-id':'1234','data-rk-vt-active':undefined
 });
});

test('pair candidates come only from knowledge-base list/detail navigation',()=>{
 assert.deepEqual(candidateForRoutes('/library','/records/abc'),{kind:'record',id:'abc',direction:'forward'});
 assert.deepEqual(candidateForRoutes('/library/parent','/records/abc'),{kind:'record',id:'abc',direction:'forward'});
 assert.deepEqual(candidateForRoutes('/records/abc','/library/parent'),{kind:'record',id:'abc',direction:'back'});
 assert.deepEqual(candidateForRoutes('/library','/library/folder'),{kind:'folder',id:'folder',direction:'forward'});
 assert.deepEqual(candidateForRoutes('/library/parent','/library/child'),{kind:'folder',id:'child',direction:'forward'});
 assert.deepEqual(candidateForRoutes('/library/child','/library'),{kind:'folder',id:'child',direction:'back'});
 assert.equal(candidateForRoutes('/search?q=abc','/records/abc'),null);
 assert.equal(candidateForRoutes('/','/records/abc'),null);
 assert.equal(candidateForRoutes('/archive','/records/abc'),null);
 assert.equal(candidateForRoutes('/records/abc','/records/def'),null);
});
