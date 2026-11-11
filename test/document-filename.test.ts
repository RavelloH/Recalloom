import test from 'node:test';
import assert from 'node:assert/strict';
import {documentDisplayName,filenameFromDocumentTitle} from '../web/src/document-filename.js';

test('document header strips only the final Markdown extension',()=>{
 assert.equal(documentDisplayName('Knowledge.md'),'Knowledge');
 assert.equal(documentDisplayName('Knowledge.MD'),'Knowledge');
 assert.equal(documentDisplayName('design.md.archive'),'design.md.archive');
 assert.equal(documentDisplayName('Knowledge'),'Knowledge');
});

test('inline rename preserves existing explicit extension convention',()=>{
 assert.equal(filenameFromDocumentTitle('Knowledge.md','Updated'),'Updated.md');
 assert.equal(filenameFromDocumentTitle('Knowledge.MD','Updated.md'),'Updated.MD');
 assert.equal(filenameFromDocumentTitle('Knowledge','Updated'),'Updated');
 assert.equal(filenameFromDocumentTitle('Knowledge.md','Updated.md'),'Updated.md');
});
