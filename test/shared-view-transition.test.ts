import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resourceViewTransitionIdentity,sharedViewTransitionName} from '../web/src/shared-view-transition.js';

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
});
