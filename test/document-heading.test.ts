import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 leadingDocumentHeading,displayedDocumentBody,withDocumentBody,
 renameDocumentHeading,markdownCharacterCount
} from '../web/src/document-heading.js';

test('only the first top-level H1 qualifies as the document title',()=>{
 for(const markdown of [
  'Paragraph first.\n\n# Later H1',
  '> # Nested quote heading',
  '- # Nested list heading',
  '```md\n# Heading in fence\n```\n# Later',
  '## First H2\n\n# Later H1'
 ])assert.equal(leadingDocumentHeading(markdown),null,markdown);
 assert.equal(leadingDocumentHeading('  \n# First title\n\nBody')?.title,'First title');
 assert.equal(leadingDocumentHeading('# **Bold** and `Code`\n\nBody')?.title,'Bold and Code');
 assert.equal(leadingDocumentHeading('Setext title\n============\n\nBody')?.title,'Setext title');
});

test('promoted headings are hidden only in the presentation, never removed from source',()=>{
 const original='# Top title\r\n\r\nBody with # literal\r\n\r\n## Secondary';
 const first=leadingDocumentHeading(original);
 assert.ok(first);
 assert.equal(displayedDocumentBody(original,first),'Body with # literal\r\n\r\n## Secondary');
 assert.equal(withDocumentBody(first,'Changed body'), '# Top title\r\n\r\nChanged body');
 const renamed=renameDocumentHeading(first,'A/B and 中文');
 assert.equal(withDocumentBody(renamed,'Changed body'),'# A/B and 中文\r\n\r\nChanged body');
 assert.equal(displayedDocumentBody(withDocumentBody(renamed,'Changed body'),renamed),'Changed body');
});

test('first content insertion after a title-only Markdown document keeps a blank separator',()=>{
 const first=leadingDocumentHeading('# Title');
 assert.ok(first);
 const updated=withDocumentBody(first,'Paragraph');
 assert.equal(updated,'# Title\n\nParagraph');
 assert.equal(displayedDocumentBody(updated,first),'Paragraph');
});

test('count renders CJK and Unicode characters without Markdown formatting delimiters',()=>{
 assert.equal(markdownCharacterCount('# 你好 A\n\n**world**'),8);
 assert.equal(markdownCharacterCount('hello [link](https://example.org)'),9);
 assert.equal(markdownCharacterCount('```ts\nlet x=1\n```'),6);
});
