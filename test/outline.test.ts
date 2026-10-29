import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdownOutline} from '../src/outline.js';

test('Markdown outline preserves nested heading ranges and ignores frontmatter and code fences',()=>{
  const content=['---','title: Example','---','# Overview','Text','## Architecture','\`\`\`md','# Hidden heading','\`\`\`','Architecture text','### Components','~~~','## Also hidden','~~~','## Decisions','Final paragraph'].join('\n');
  const out=parseMarkdownOutline(content);
  assert.deepEqual(out.headings.map(h=>[h.level,h.title,h.lineStart,h.lineEnd]),[
    [1,'Overview',4,16],
    [2,'Architecture',6,14],
    [3,'Components',11,14],
    [2,'Decisions',15,16]
  ]);
  assert.equal(out.totalHeadings,4);
  assert.equal(out.page.nextCursor,null);
});
test('Markdown outline supports Setext and closing ATX markers',()=>{
  const out=parseMarkdownOutline('Title\n=====\n\nSubtitle\n--------\n\n### Detail ###\n');
  assert.deepEqual(out.headings.map(h=>[h.level,h.title,h.lineStart]),[[1,'Title',1],[2,'Subtitle',4],[3,'Detail',7]]);
});
test('Markdown outline pagination has no duplicates and rejects invalid cursors',()=>{
  const content=Array.from({length:8},(_,i)=>'## Section '+i).join('\n');
  const first=parseMarkdownOutline(content,3);
  const next=parseMarkdownOutline(content,3,first.page.nextCursor!);
  assert.deepEqual(first.headings.map(h=>h.title),['Section 0','Section 1','Section 2']);
  assert.deepEqual(next.headings.map(h=>h.title),['Section 3','Section 4','Section 5']);
  assert.equal(next.page.nextCursor,6);
  assert.throws(()=>parseMarkdownOutline(content,3,9),/INVALID_CURSOR/);
});
