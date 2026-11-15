import assert from 'node:assert/strict';
import test from 'node:test';
import {hasActiveEditorDirty,setActiveEditorDirty} from '../web/src/session-drafts.js';

const reset=()=>{
 setActiveEditorDirty(false);
 setActiveEditorDirty(false,'task:first');
 setActiveEditorDirty(false,'task:second');
 setActiveEditorDirty(false,'task:clean');
};

test('closing one clean or dirty editor does not clear another dirty source',()=>{
 reset();
 setActiveEditorDirty(true,'task:first');
 setActiveEditorDirty(false,'task:clean');
 assert.equal(hasActiveEditorDirty(),true);
 setActiveEditorDirty(true,'task:second');
 setActiveEditorDirty(false,'task:first');
 assert.equal(hasActiveEditorDirty(),true);
 setActiveEditorDirty(false,'task:second');
 assert.equal(hasActiveEditorDirty(),false);
});

test('legacy callers share a separate default source',()=>{
 reset();
 setActiveEditorDirty(true);
 setActiveEditorDirty(true,'task:first');
 setActiveEditorDirty(false);
 assert.equal(hasActiveEditorDirty(),true);
 setActiveEditorDirty(false,'task:first');
 assert.equal(hasActiveEditorDirty(),false);
});
