import test from 'node:test';
import assert from 'node:assert/strict';
import {activeDocumentHeading,documentOutline,parseDocumentHeadings} from '../web/src/document-outline';

test('document outline includes draft Markdown headings and ignores metadata and code examples',()=>{
 const content=['---','title: Hidden','---','# Overview','```md','# Also hidden','```','    ## Indented','# Overview ###','Detail','---'].join('\n');
 const headings=parseDocumentHeadings(content);
 assert.deepEqual(headings.map(({key,title,level,line})=>[key,title,level,line]),[
  ['markdown:3','Overview',1,3],['markdown:8','Overview',1,8],['markdown:9','Detail',2,9]
 ]);
 assert.equal(activeDocumentHeading(headings,9),'markdown:9');
 assert.deepEqual(documentOutline(headings,'markdown:8'),{
  headings:[{key:'markdown:3',title:'Overview',level:1},{key:'markdown:8',title:'Overview',level:1},{key:'markdown:9',title:'Detail',level:2}],
  totalHeadings:3,activeKey:'markdown:8'
 });
});

test('document outline recognizes tilde fences and Setext headings',()=>{
 const headings=parseDocumentHeadings('Title\n=====\n\n~~~\n## Hidden\n~~~\n\n### Detail ###\n');
 assert.deepEqual(headings.map(({title,level,line})=>[title,level,line]),[['Title',1,0],['Detail',3,7]]);
});

test('document outline ignores TOML frontmatter and empty headings',()=>{
 const headings=parseDocumentHeadings('\uFEFF+++\ntitle = "Hidden"\n+++\n#\n# Visible');
 assert.deepEqual(headings.map(({title,line})=>[title,line]),[['Visible',4]]);
});
