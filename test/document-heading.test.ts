import assert from 'node:assert/strict';
import {test} from 'node:test';
import {markdownCharacterCount} from '../web/src/document-heading.js';

test('count renders CJK and Unicode characters without Markdown formatting delimiters',()=>{
 assert.equal(markdownCharacterCount('# 你好 A\n\n**world**'),8);
 assert.equal(markdownCharacterCount('hello [link](https://example.org)'),9);
 assert.equal(markdownCharacterCount('```ts\nlet x=1\n```'),6);
});

test('first and later H1 text contribute equally to document character counts',()=>{
 assert.equal(markdownCharacterCount('# Header\n\nBody'),10);
 assert.equal(markdownCharacterCount('Body\n\n# Header'),10);
});
