import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import {CustomHeading} from '../web/src/tiptap/custom-heading';
import {CustomParagraph} from '../web/src/tiptap/custom-paragraph';
import {HighlightWithMarkdown,UnderlineWithMarkdown} from '../web/src/tiptap/markdown-extensions';
import {buildVisualMarkdown} from '../web/src/tiptap/visual-markdown';
import {markdownRoundTripSafe} from '../web/src/tiptap/fidelity';
import type {JSONContent} from '@tiptap/core';

const manager=new MarkdownManager({extensions:[
 StarterKit.configure({heading:false,paragraph:false,underline:false,codeBlock:false}),
 CustomHeading,CustomParagraph,CodeBlock,Markdown,
 HighlightWithMarkdown,UnderlineWithMarkdown,
]});
const walk=(node:JSONContent,fn:(node:JSONContent)=>void)=>{
 fn(node);for(const child of node.content??[])walk(child,fn);
};
describe('visual-first Markdown import',()=>{
 it('renders inline HTML mark as highlight with nested inline code',()=>{
  const source=[
   '# Markdown 高亮与公式格式测试',
   '',
   '- 频率：<mark>50 Hz</mark>。',
   '- 电压：<mark>`1.05 U_N`</mark>。',
   '- 参数：<mark>短路试验参数 `R_T、X_T`</mark>。',
   '- 原始公式：<mark>`R_T = ΔP_s·U_N²/S_N² × 1000` Ω</mark>'
  ].join('\n');
  const doc=buildVisualMarkdown(source,manager);
  let highlights=0,codeWithinHighlight=0,rawNodes=0;
  walk(doc,node=>{
   if(node.type==='rawMarkdown')rawNodes++;
   if(node.marks?.some(mark=>mark.type==='highlight'))highlights++;
   if(node.marks?.some(mark=>mark.type==='highlight')&&node.marks?.some(mark=>mark.type==='code'))codeWithinHighlight++;
  });
  assert.equal(rawNodes,0);
  assert.ok(highlights>=4);
  assert.ok(codeWithinHighlight>=3,'highlight must preserve nested inline code');
  const exported=manager.serialize(doc);
  assert.ok(markdownRoundTripSafe(source,exported),'valid highlight Markdown is semantically preserved');
  assert.ok(exported.includes('<mark>')&&exported.includes('`1.05 U_N`'));
 });
 it('converts unknown HTML and incomplete highlight into editable normal text',()=>{
  const source='<div class="note">Unsupported HTML</div>\n\nA detail[^footnote].\n\n[^footnote]: footnote text.\n\n<mark> incomplete.';
  const doc=buildVisualMarkdown(source,manager);
  let contents='',blocks=0;
  walk(doc,node=>{if(node.type==='rawMarkdown')throw Error('must not have raw nodes');if(node.type==='paragraph')blocks++;if(node.type==='text')contents+=node.text??'';});
  assert.ok(blocks>=2);
  assert.ok(contents.includes('<div class="note">Unsupported HTML</div>'));
  assert.ok(contents.includes('[^footnote]'));
  assert.ok(contents.includes('<mark> incomplete'));
 });
 it('displays unsupported YAML front matter as plain text and still renders the heading afterward',()=>{
  const doc=buildVisualMarkdown('---\ntitle: Note\ncategory: 学习\n---\n\n# Rich Heading\n\nMore **content**.',manager);
  assert.equal(doc.content?.[0]?.type,'paragraph','YAML must not be misinterpreted as markdown layout');
  assert.equal(doc.content?.[1]?.type,'heading');
  const first=doc.content?.[0]?.content??[];
  assert.ok(first.some(node=>node.type==='text'&&node.text==='title: Note'));
  assert.ok(first.some(node=>node.type==='hardBreak'));
  assert.ok(doc.content?.some(node=>node.type==='paragraph'&&node.content?.some(n=>n.marks?.some(m=>m.type==='bold'))));
 });
 it('keeps text editable when the Markdown parser throws',()=>{
  const source='unsupported syntax\n<future-component>alpha</future-component>';
  const doc=buildVisualMarkdown(source,{parse:()=>{throw Error('parser failure')}});
  assert.equal(doc.content?.[0]?.type,'paragraph');
  assert.ok(doc.content?.[0]?.content?.some(n=>n.type==='hardBreak'));
  assert.ok(doc.content?.[0]?.content?.every(n=>n.type==='text'||n.type==='hardBreak'));
 });
});
